# Tender Document Package Builder

Frontend-only web app. Office staff load `requirements.json`, attach up to 30 PDFs
(50 MB total), match each file to a required document, enter expiry dates, see a
live status per requirement, and download one combined PDF named
`<tender_id>_Package.pdf`.

Everything runs in the browser. No backend, no keys.

## Run

```bash
npm install
npm run dev
```

## Build (static, for Vercel)

```bash
npm run build
```

Vercel: import this repo, framework preset Vite, output `dist/`.

## How to use

1. Tender file — choose your `requirements.json`, or press Try demo data.
2. Upload PDFs — up to 30 PDF files, 50 MB total. Each is validated in-browser.
3. Match and dates — pick one PDF per requirement; enter expiry where asked.
   Live chip: Missing / Expiry date needed / Expired / Not provided / OK.
4. Review and download — enabled when nothing blocks; saves
   `<tender_id>_Package.pdf` (cover page + documents in order).