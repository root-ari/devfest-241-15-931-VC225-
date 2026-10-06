import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// --- import src/pdf.js in Node: neutralize the Vite-only "?url" import ---
let src = readFileSync('src/pdf.js', 'utf8');
src = src.replace(
  "import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';",
  "const workerUrl = '';"
);
writeFileSync('._pdf_check.mjs', src);
const { buildPackagePdf } = await import('./._pdf_check.mjs');
const { PDFDocument } = await import('pdf-lib');

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : `(got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// Two source docs: doc A = 1 page, doc B = 2 pages.
const a = await PDFDocument.create();
a.addPage([595.28, 841.89]).drawText('DOCA-MARKER', { x: 60, y: 700, size: 20 });
const aBytes = await a.save();
const b = await PDFDocument.create();
b.addPage([595.28, 841.89]).drawText('DOCB-MARKER-1', { x: 60, y: 700, size: 20 });
b.addPage([595.28, 841.89]).drawText('DOCB-MARKER-2', { x: 60, y: 700, size: 20 });
const bBytes = await b.save();

// Bangla in a tender field must NOT throw (WinAnsi sanitizer).
const tender = {
  tender_id: 'T-2024/01',
  title: 'Procurement of ল্যাপটপ (Laptops) — A4',
  procuring_entity: 'Entity',
  bidder: 'Bidder',
  submission_deadline: '2026-10-20',
};
const items = [
  { req: { title_en: 'Trade License' }, bytes: aBytes, expiry: '' },
  { req: { title_en: 'TIN Certificate' }, bytes: bBytes, expiry: '2026-10-20' },
];
const out = await buildPackagePdf(tender, items);
const doc = await PDFDocument.load(out);
eq('cover + 1 + 2 pages = 4', doc.getPageCount(), 4);

// Scan (and inflate) every content stream: footers + markers.
const buf = Buffer.from(out);
const found = new Set();
let cover = false, doca = false, docb = 0;
let idx = 0;
while ((idx = buf.indexOf('stream', idx)) !== -1) {
  let start = idx + 6;
  if (buf[start] === 0x0d) start++;
  if (buf[start] === 0x0a) start++;
  const end = buf.indexOf('endstream', start);
  if (end === -1) break;
  try {
    const raw = inflateSync(buf.subarray(start, end)).toString('latin1');
    // pdf-lib hex-encodes text: decode <48656C6C6F> -> Hello
    const txt = raw.replace(/<([0-9A-Fa-f\s]*)>/g, (m, hex) => {
      try { return Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('latin1'); } catch { return m; }
    });
    for (let i = 1; i <= 4; i++) if (txt.includes(`T-2024/01 | Page ${i} of 4`)) found.add(i);
    if (txt.includes('TENDER DOCUMENT PACKAGE')) cover = true;
    if (txt.includes('DOCA-MARKER')) doca = true;
    if (txt.includes('DOCB-MARKER-1') || txt.includes('DOCB-MARKER-2')) docb++;
  } catch { /* not a stream or not deflate */ }
  idx = end + 9;
}
eq('footer on every page (1..4)', found.size, 4);
eq('cover page content present (first)', cover, true);
eq('doc A page kept', doca, true);
eq('doc B pages kept', docb, 2);

// All-optional package: zero items -> cover only, footer "Page 1 of 1".
const empty = await buildPackagePdf(tender, []);
const emptyDoc = await PDFDocument.load(empty);
eq('zero-item package = cover only', emptyDoc.getPageCount(), 1);
{
  const ebuf = Buffer.from(empty);
  let hit = false, eidx = 0;
  while (!hit && (eidx = ebuf.indexOf('stream', eidx)) !== -1) {
    let start = eidx + 6;
    if (ebuf[start] === 0x0d) start++;
    if (ebuf[start] === 0x0a) start++;
    const end = ebuf.indexOf('endstream', start);
    if (end === -1) break;
    try {
      const raw = inflateSync(ebuf.subarray(start, end)).toString('latin1');
      const dec = raw.replace(/<([0-9A-Fa-f\s]*)>/g, (m, hex) => {
        try { return Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('latin1'); } catch { return m; }
      });
      if (dec.includes('T-2024/01 | Page 1 of 1')) hit = true;
    } catch { /* skip */ }
    eidx = end + 9;
  }
  eq('zero-item footer Page 1 of 1', hit, true);
}

// Alternative requirements.json: other IDs, all optional, fewer/more items.
const { parseRequirements, getPackageSummary } = await import('./src/logic.js');
const alt = JSON.stringify({
  tender: { tender_id: 'ALT-9', title: 'Alt', procuring_entity: 'PE', bidder: 'B', submission_deadline: '2026-12-31' },
  requirements: [
    { id: 'DOC-X', order: 1, title_en: 'A', title_bn: 'ক', mandatory: false, has_expiry: true },
    { id: 'OTHER-Y', order: 2, title_en: 'B', title_bn: 'খ', mandatory: false, has_expiry: false },
    { id: 'Z9', order: 3, title_en: 'C', title_bn: 'গ', mandatory: false, has_expiry: false },
  ],
});
const parsed = parseRequirements(alt);
const sum = getPackageSummary(parsed.requirements, {}, parsed.tender.submission_deadline);
eq('alt json: other IDs parse', parsed.requirements.map((r) => r.id), ['DOC-X', 'OTHER-Y', 'Z9']);
eq('alt json: all-optional + empty matches canDownload', sum.canDownload, true);
eq('alt json: all notProvided (non-blocking)', sum.blockingCount, 0);

unlinkSync('._pdf_check.mjs');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);