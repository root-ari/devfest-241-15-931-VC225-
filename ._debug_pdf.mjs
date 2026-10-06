import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

let src = readFileSync('src/pdf.js', 'utf8');
src = src.replace(
  "import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';",
  "const workerUrl = '';"
);
writeFileSync('._pdf_check.mjs', src);
const { buildPackagePdf } = await import('./._pdf_check.mjs');
const { PDFDocument } = await import('pdf-lib');

const tender = {
  tender_id: 'T-2024/01', title: 'T', procuring_entity: 'PE',
  bidder: 'B', submission_deadline: '2026-10-20',
};
const out = await buildPackagePdf(tender, []);
writeFileSync('._dbg.pdf', Buffer.from(out));
console.log('bytes:', out.length);
console.log('raw has TENDER:', Buffer.from(out).includes('TENDER DOCUMENT PACKAGE'));
console.log('raw has Page 1 of 1:', Buffer.from(out).includes('Page 1 of 1'));
console.log('count "stream":', Buffer.from(out).toString('latin1').split('stream').length - 1);

// manual scan with error reporting
const buf = Buffer.from(out);
let idx = 0, n = 0;
while ((idx = buf.indexOf('stream', idx)) !== -1) {
  let start = idx + 6;
  if (buf[start] === 0x0d) start++;
  if (buf[start] === 0x0a) start++;
  const end = buf.indexOf('endstream', start);
  if (end === -1) { console.log('no endstream at', idx); break; }
  const chunk = buf.subarray(start, end);
  try {
    const txt = inflateSync(chunk).toString('latin1');
    console.log(`stream#${n} inflated ${txt.length}: ${JSON.stringify(txt.slice(0, 90))}`);
  } catch (e) {
    console.log(`stream#${n} inflate FAILED (${chunk.length} bytes): ${e.message}`);
  }
  n++;
  idx = end + 9;
}
unlinkSync('._pdf_check.mjs');
unlinkSync('._dbg.pdf');