import { PDFDocument, degrees } from 'pdf-lib';
import { buildPackage } from './src/buildPackage.js';
import { writeFileSync } from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Landscape source with rotation + text at known positions.
const src = await PDFDocument.create();
const sp = src.addPage([400, 200]);
sp.drawText('AAA-TOP-EDGE', { x: 150, y: 175, size: 18 });
sp.drawText('ZZZ-BOTTOM', { x: 150, y: 10, size: 18 });
sp.setRotation(degrees(90));
const srcBytes = await src.save();

const out = await buildPackage({
  tender: {
    tender_id: 'VIS', title: 'Visual check', procuring_entity: 'E',
    bidder: 'B', submission_deadline: '2026-10-20',
  },
  items: [{
    requirement: { id: 'R1', order: 1, title_en: 'Rotated Doc' },
    fileBytes: srcBytes, fileName: 'rot.pdf', expiryDate: '',
  }],
  generatedDate: '2026-10-06',
});
writeFileSync('checkrot-out.pdf', out);

// Where did the markers land on output page 2? (transform coords in pdfjs space)
const doc = await pdfjs.getDocument({ data: out.slice() }).promise;
const page = await doc.getPage(2);
const tc = await page.getTextContent();
for (const it of tc.items) {
  if (/AAA|ZZZ|VIS \| Page/.test(it.str)) {
    console.log(JSON.stringify(it.str), 'at x=', it.transform[4].toFixed(1), 'y=', it.transform[5].toFixed(1));
  }
}
console.log('viewport:', JSON.stringify(page.getViewport({ scale: 1 }).width), 'x', JSON.stringify(page.getViewport({ scale: 1 }).height));
await doc.destroy();




