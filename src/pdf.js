// PDF work: validate with pdfjs-dist, merge with pdf-lib.
// Cover page uses English (pdf-lib standard fonts cannot render Bangla script).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Returns page count, throws if not a readable PDF.
export async function validatePdf(bytes) {
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  const pages = doc.numPages;
  await doc.destroy();
  return pages;
}

// items: [{ req, bytes, fileName, expiry }] in final order.
// Produces one PDF: cover page + each document's pages in order.
export async function buildPackagePdf(tender, items) {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const fontBold = await out.embedFont(StandardFonts.HelveticaBold);

  // --- cover page (A4) ---
  const W = 595.28, H = 841.89;
  const page = out.addPage([W, H]);
  let y = H - 60;
  const line = (text, size = 12, bold = false, gap = 20, color = rgb(0, 0, 0)) => {
    page.drawText(String(text).slice(0, 110), {
      x: 50, y, size, font: bold ? fontBold : font, color,
    });
    y -= gap;
  };
  line('TENDER DOCUMENT PACKAGE', 20, true, 30);
  line(tender.title, 14, true, 24);
  line(`Tender ID: ${tender.tender_id}`, 12, false, 18);
  line(`Procuring entity: ${tender.procuring_entity}`, 12, false, 18);
  line(`Bidder: ${tender.bidder}`, 12, false, 18);
  line(`Submission deadline: ${tender.submission_deadline}`, 12, false, 30);
  line('CONTENTS (in order)', 14, true, 24);
  items.forEach((it, i) => {
    const extra = it.expiry ? `  (expiry ${it.expiry})` : '';
    line(`${i + 1}. ${it.req.title_en}${extra}`, 11, false, 18);
  });
  line('', 10, false, 14);
  line(`Generated in browser on ${new Date().toISOString().slice(0, 10)}.`, 10, false, 18, rgb(0.3, 0.3, 0.3));

  // --- append each document's pages ---
  for (const it of items) {
    const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
}

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
