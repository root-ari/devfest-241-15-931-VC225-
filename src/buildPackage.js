// Package builder (pdf-lib only). Pure PDF work — no React, no DOM.
// buildPackage({ tender, items, generatedDate? }) -> Uint8Array of the package PDF.
//
// items: [{ requirement, fileBytes, fileName, expiryDate? }]
//   - sorted internally by requirement.order (tie: requirement.id)
//   - requirements with no fileBytes are skipped (optional with no file)
// Rules:
//  1. Page 1 = English A4 cover (StandardFonts only): tender ID, title,
//     procuring entity, bidder, submission deadline, generated date,
//     numbered list of included documents in order.
//  2. After cover: documents in requirement order, ALL pages, original order.
//  3. Every page incl. cover gets footer "<tender_id> | Page X of Y".
//  4. Footer never covers content: each source page is embedded (embedPage)
//     onto a new page taller by 36pt; footer drawn centered in that strip,
//     10pt dark text. Original size/orientation preserved, rotation handled.
//  5. Encrypted/corrupt PDFs throw an error naming the file.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

export const FOOTER_STRIP = 36;
export const FOOTER_SIZE = 10;

const A4 = [595.28, 841.89];

function safeText(s) {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

// Visible size of a source page after rotation (0/90/180/270).
function visibleSize(page) {
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const w = page.getWidth();
  const h = page.getHeight();
  return { w: rot === 90 || rot === 270 ? h : w, h: rot === 90 || rot === 270 ? w : h, rot };
}

// Draw one source page onto a new page that is FOOTER_STRIP taller at the
// bottom (original content untouched above the strip). Rotation handled:
// the embedded (unrotated) page is drawn with a rotate transform so it
// appears exactly as in the source, shifted up by the strip height.
async function appendSourcePage(out, srcPage) {
  const { w: W, h: H, rot } = visibleSize(srcPage);
  const page = out.addPage([W, H + FOOTER_STRIP]);
  const embedded = await out.embedPage(srcPage);
  // embedded.width/height are the UNROTATED MediaBox dims.
  const ew = embedded.width;
  const eh = embedded.height;
  const y0 = FOOTER_STRIP;
  if (rot === 0) {
    page.drawPage(embedded, { x: 0, y: y0 });
  } else if (rot === 90) {
    // (px,py) -> (x - py, y + px): full page lands in x:[x-eh,x], y:[y,y+ew]
    page.drawPage(embedded, { x: eh, y: y0, rotate: degrees(90) });
  } else if (rot === 180) {
    // (px,py) -> (x - px, y - py): lands in x:[x-ew,x], y:[y-eh,y]
    page.drawPage(embedded, { x: ew, y: y0 + eh, rotate: degrees(180) });
  } else {
    // rot === 270: (px,py) -> (x + py, y - px): lands in x:[x,x+eh], y:[y-ew,y]
    page.drawPage(embedded, { x: 0, y: y0 + ew, rotate: degrees(270) });
  }
  return page;
}

export async function buildPackage({ tender, items, generatedDate }) {
  if (!tender || typeof tender !== 'object') throw new Error('MISSING_TENDER');
  const included = (items || [])
    .filter((it) => it && it.requirement && it.fileBytes)
    .map((it) => ({ ...it }))
    .sort((a, b) =>
      a.requirement.order - b.requirement.order ||
      String(a.requirement.id).localeCompare(String(b.requirement.id)));

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.15, 0.15, 0.15);

  const genDate = generatedDate || new Date().toISOString().slice(0, 10);

  // ---- pass 1: cover page (A4 + 36pt footer strip, content above strip) ----
  const coverW = A4[0];
  const coverH = A4[1] + FOOTER_STRIP;
  const cover = out.addPage([coverW, coverH]);
  {
    let y = coverH - 60;
    const line = (text, size = 12, bold = false, gap = 20) => {
      cover.drawText(safeText(text).slice(0, 120), {
        x: 50, y, size, font: bold ? fontBold : font, color: rgb(0, 0, 0),
      });
      y -= gap;
    };
    line('TENDER DOCUMENT PACKAGE', 20, true, 32);
    line('Title: ' + safeText(tender.title), 14, true, 26);
    line('Tender ID: ' + safeText(tender.tender_id), 12, false, 19);
    line('Procuring entity: ' + safeText(tender.procuring_entity), 12, false, 19);
    line('Bidder: ' + safeText(tender.bidder), 12, false, 19);
    line('Submission deadline: ' + safeText(tender.submission_deadline), 12, false, 32);
    line('CONTENTS (in order)', 14, true, 24);
    included.forEach((it, i) => {
      const extra = it.expiryDate ? `  (expiry ${it.expiryDate})` : '';
      line(`${i + 1}. ${safeText(it.requirement.title_en)}${extra}`, 11, false, 18);
    });
    line(`Package generated: ${genDate}`, 10, false, 18);
  }

  // ---- pass 2: documents in requirement order, ALL pages each ----
  for (const it of included) {
    const label = it.fileName || it.requirement.id;
    let src;
    try {
      src = await PDFDocument.load(it.fileBytes, { ignoreEncryption: false });
    } catch (err) {
      throw new Error(`BAD_FILE:${label}:${err.message || 'unreadable PDF'}`);
    }
    const n = src.getPageCount();
    for (let i = 0; i < n; i++) {
      try {
        await appendSourcePage(out, src.getPage(i));
      } catch (err) {
        throw new Error(`BAD_FILE:${label}:${err.message || 'unreadable page'}`);
      }
    }
  }

  // ---- pass 3: footers on every page, "<tender_id> | Page X of Y" ----
  const pages = out.getPages();
  const total = pages.length;
  for (let i = 0; i < total; i++) {
    const p = pages[i];
    const footer = `${safeText(tender.tender_id)} | Page ${i + 1} of ${total}`;
    const tw = font.widthOfTextAtSize(footer, FOOTER_SIZE);
    p.drawText(footer, {
      x: (p.getWidth() - tw) / 2,
      y: (FOOTER_STRIP - FOOTER_SIZE) / 2 + 2,
      size: FOOTER_SIZE,
      font,
      color: dark,
    });
  }

  return out.save();
}

