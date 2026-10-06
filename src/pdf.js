// PDF work: validate with pdfjs-dist, merge with pdf-lib.
// Cover page uses English (pdf-lib standard fonts cannot render Bangla script).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Returns { ok:true, pages } or { ok:false, reason } — never throws.
// reason is 'locked' (password-protected) or 'damaged' (corrupt/unreadable).
export async function validatePdf(bytes) {
  let doc = null;
  try {
    const task = pdfjs.getDocument({ data: bytes });
    doc = await task.promise;
    const pages = doc.numPages;
    try { await doc.destroy(); } catch { /* ignore cleanup errors */ }
    return { ok: true, pages };
  } catch (err) {
    try { if (doc && doc.destroy) await doc.destroy(); } catch { /* ignore */ }
    const msg = String((err && (err.name || err.message)) || '');
    const locked = /password|encrypt|NeedPassword|IncorrectPassword/i.test(msg);
    return { ok: false, reason: locked ? 'locked' : 'damaged' };
  }
}

// Count pages of an in-memory PDF (for the success message). Throws on bad input.
export async function countPages(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice ? bytes.slice() : bytes });
  const doc = await task.promise;
  const pages = doc.numPages;
  await doc.destroy();
  return pages;
}

// Keep only characters pdf-lib's standard fonts (WinAnsi) can encode.
// Guarantees drawText never throws on Bangla/emoji/curly quotes in tender
// fields (a throw here would kill the whole download).
function ansi(s) {
  return String(s ?? '').replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '');
}

// items: [{ req, bytes, fileName, expiry }] in final order.
// Produces one PDF: cover page + each document's pages in order,
// with a "<tender_id> | Page X of Y" footer on EVERY page.
export async function buildPackagePdf(tender, items) {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const fontBold = await out.embedFont(StandardFonts.HelveticaBold);

  // --- cover page (A4) ---
  const W = 595.28, H = 841.89;
  const COVER_SAFE = 55; // cover content never enters the footer zone
  const page = out.addPage([W, H]);
  let y = H - 60;
  const line = (text, size = 12, bold = false, gap = 20, color = rgb(0, 0, 0)) => {
    if (y < COVER_SAFE) return; // never overlap the footer
    page.drawText(ansi(text).slice(0, 110), {
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
  // Fit any number of requirements: shrink the line gap, then truncate
  // with a "+N more" line so a long list can never reach the footer.
  const avail = Math.max(0, y - 90); // reserve room for the trailing note + footer
  let gap = items.length ? Math.min(18, avail / items.length) : 18;
  if (gap < 10) gap = 10;
  const room = Math.floor(avail / gap);
  let shown = Math.min(items.length, room);
  const truncating = shown < items.length;
  if (truncating) shown = Math.max(0, shown - 1); // reserve one line for "+N more"
  for (let i = 0; i < shown; i++) {
    const it = items[i];
    const extra = it.expiry ? `  (expiry ${it.expiry})` : '';
    line(`${i + 1}. ${it.req.title_en}${extra}`, 11, false, gap);
  }
  if (truncating) line(`... +${items.length - shown} more`, 11, true, gap);
  line('', 10, false, 14);
  line(`Generated in browser on ${new Date().toISOString().slice(0, 10)}.`, 10, false, 18, rgb(0.3, 0.3, 0.3));

  // --- append each document's pages (all pages kept, requirement order) ---
  for (const it of items) {
    const src = await PDFDocument.load(it.bytes, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }

  // --- footer on every page: "<tender_id> | Page X of Y" ---
  // Stamped in the bottom margin (y≈14pt), which is blank in normal PDFs;
  // the cover is additionally clamped above COVER_SAFE while drawing.
  const total = out.getPageCount();
  const tid = ansi(tender.tender_id);
  for (let i = 0; i < total; i++) {
    const pg = out.getPage(i);
    const pw = pg.getWidth();
    const ph = pg.getHeight();
    const size = ph >= 70 ? 8 : 6;
    const label = `${tid} | Page ${i + 1} of ${total}`;
    const tw = font.widthOfTextAtSize(label, size);
    pg.drawText(label, {
      x: Math.max(2, (pw - tw) / 2),
      y: ph >= 70 ? 14 : Math.max(2, ph * 0.03),
      size, font, color: rgb(0.4, 0.4, 0.4),
    });
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
