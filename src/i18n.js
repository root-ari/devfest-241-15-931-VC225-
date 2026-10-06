// UI strings for English + Bangla. Document titles always come from
// requirements.json (title_en / title_bn), never from here.
// Use the useLang() hook so the choice persists in localStorage and the
// <html lang> + document title follow the language.
import { useEffect, useState } from 'react';

const LANG_KEY = 'tender-package-lang';

export function useLang() {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem(LANG_KEY) === 'bn' ? 'bn' : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    document.documentElement.lang = lang === 'bn' ? 'bn' : 'en';
    document.title = STR[lang].docTitle;
  }, [lang]);
  const setLang = (l) => {
    const v = l === 'bn' ? 'bn' : 'en';
    setLangState(v);
    try {
      localStorage.setItem(LANG_KEY, v);
    } catch {
      /* private mode — language just won't persist */
    }
  };
  return [lang, setLang];
}

/** Replace {placeholders} in a template string. */
export function fill(template, vars) {
  let out = String(template ?? '');
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.split('{' + k + '}').join(String(v ?? ''));
  }
  return out;
}

/**
 * Localized message for an upload-limit rejection.
 * check = { ok:false, reason, fileName? } from checkUploadLimits.
 */
export function limitMsg(lang, check) {
  const t = STR[lang] || STR.en;
  if (!check || check.ok) return '';
  if (check.reason === 'NOT_PDF') {
    return fill(t.notPdfNamed, { file: check.fileName || t.unnamedFile });
  }
  return t.errors[check.reason] || t.unknownError;
}

/**
 * Resolve a thrown error key (e.g. "MISSING_TENDER" or "BAD_FILE:x.pdf:boom")
 * to a localized message. Never leaks raw keys to the UI.
 */
export function msgFor(lang, err) {
  const t = STR[lang] || STR.en;
  const key = err && err.message ? String(err.message) : String(err ?? '');
  if (t.errors[key]) return t.errors[key];
  // Parameterized keys from logic.js: PREFIX:detail
  const colon = key.indexOf(':');
  if (colon > 0) {
    const head = key.slice(0, colon);
    const rest = key.slice(colon + 1);
    if (head === 'MISSING_TENDER_FIELD') return `${t.errors.MISSING_TENDER} (${rest})`;
    if (head === 'BAD_REQUIREMENT_FIELD') return `${t.errors.BAD_REQUIREMENT} (${rest})`;
    if (head === 'BAD_REQUIREMENT') return t.errors.BAD_REQUIREMENT;
    if (head === 'DUPLICATE_ID') return t.errors.DUPLICATE_ID;
    if (head === 'BAD_FILE') {
      const i = rest.indexOf(':');
      const file = i >= 0 ? rest.slice(0, i) : rest;
      const reason = i >= 0 ? rest.slice(i + 1) : t.unknownError;
      return fill(t.corruptNamed, { file: file || t.unnamedFile, reason });
    }
  }
  // Network / JSON fetch failures, DOM errors, etc.
  return t.unknownError;
}

export const STR = {
  en: {
    appTitle: 'Tender Document Package Builder',
    docTitle: 'Tender Document Package Builder',
    appSub: 'Load requirements, attach PDFs, check status, download one package.',
    langName: 'EN',
    switchToBn: 'Switch to Bangla',
    switchToEn: 'Switch to English',
    step1: 'Tender file', step2: 'Upload PDFs', step3: 'Match & dates', step4: 'Review & download',
    loadJson: '1. Load requirements.json',
    loadJsonHelp: 'Pick the requirements.json file you received for this tender. Or try the demo.',
    chooseJson: 'Choose requirements.json',
    tryDemo: 'Try demo data',
    tender: 'Tender', deadline: 'Submission deadline', bidder: 'Bidder', entity: 'Procuring entity',
    upload: '2. Upload PDF files',
    uploadHelp: 'Up to 30 PDF files, 50 MB total. Files stay in your browser — nothing is uploaded.',
    choosePdfs: 'Choose PDF files',
    noFiles: 'No files yet. Choose PDFs to begin.',
    remove: 'Remove',
    pages: 'pages',
    dropJson: '…or drag & drop the file here',
    dropPdfs: '…or drag & drop PDFs here',
    mandatory: 'Mandatory', optional: 'Optional',
    clear: 'Clear',
    duplicateOf: 'Duplicate of',
    summaryBar: 'problems to fix',
    allGood: 'Nothing to fix — all requirements are satisfied.',
    blockingList: 'What is blocking:',
    dupBlocked: 'Those two files are identical copies. Use only one of them.',
    dupBlockedNamed: '{a} and {b} are identical copies. Use only one of them.',
    notPdfMagic: 'is not a real PDF file (missing %PDF header).',
    notPdfNamed: '{file}: only PDF files are allowed.',
    fileNotPdf: '{file} is not a real PDF file (missing %PDF header).',
    notRealPdf: 'Not a real PDF file (missing %PDF header)',
    badPdfNamed: '{file} could not be read as a PDF.',
    lockedPdf: 'Password-protected, cannot be used',
    damagedPdf: 'Damaged file, cannot be read',
    hashing: 'Reading files…',
    stepOf: 'Step {n} of 4',
    progressOk: '{ok} of {total} ready',
    reqListTitle: 'Requirements in this tender',
    match: '3. Match files to requirements & enter expiry dates',
    matchHelp: 'Pick one PDF for each requirement. Enter an expiry date wherever asked.',
    pickFile: '— pick a file —',
    expiry: 'Expiry date',
    status: '4. Live status & download',
    ready: 'ready', blocking: 'need attention',
    download: 'Download combined PDF',
    generate: 'Generate package',
    generating: 'Generating…',
    building: 'Building PDF…',
    blockedMsg: 'Fix the items marked below, then download.',
    okMsg: 'Everything is ready. You can download the package.',
    successMsg: 'Package downloaded: {file} — {pages} pages.',
    pagesCount: '{n} pages',
    unnamedFile: 'unnamed file',
    unknownError: 'Something went wrong.',
    corruptNamed: '{file} could not be used: {reason}',
    coverNote: 'The combined PDF starts with a cover page, then one requirement after another in order.',
    fileName: 'File name',
    unmatched: 'Unmatched files (not used in package)',
    newTender: 'Start over',
    footer: '100% in-browser — files never leave this computer.',
    removeTitle: 'Remove this file',
    clearTitle: 'Unmatch this file',
    langTitle: 'Language / ভাষা',
    statuses: {
      missing: 'Missing — required file not attached',
      expiryNeeded: 'Expiry date needed',
      expired: 'Expired — date is before the deadline',
      notProvided: 'Not provided (optional)',
      ok: 'OK',
    },
    errors: {
      INVALID_JSON: 'That file is not valid JSON.',
      INVALID_SHAPE: 'That file does not look like a requirements file.',
      MISSING_TENDER: 'Tender details are missing from the file.',
      BAD_DEADLINE: 'The submission deadline is not a valid date (YYYY-MM-DD).',
      MISSING_REQUIREMENTS: 'The requirements list is missing from the file.',
      EMPTY_REQUIREMENTS: 'The requirements list is empty.',
      BAD_REQUIREMENT: 'One requirement entry is invalid.',
      DUPLICATE_ID: 'Two requirements share the same id.',
      NOT_PDF: 'Only PDF files are allowed.',
      TOO_MANY_FILES: 'You can attach at most 30 files.',
      TOO_MANY_BYTES: 'Total file size must be under 50 MB.',
      BAD_PDF: 'This file could not be read as a PDF.',
    },
  },
  bn: {
    appTitle: 'দরপত্র নথি প্যাকেজ বিল্ডার',
    docTitle: 'দরপত্র নথি প্যাকেজ বিল্ডার',
    appSub: 'রিকোয়ারমেন্ট লোড করুন, পিডিএফ যুক্ত করুন, অবস্থা দেখুন, একটি প্যাকেজ ডাউনলোড করুন।',
    langName: 'বাংলা',
    switchToBn: 'বাংলায় বদলান',
    switchToEn: 'ইংরেজিতে বদলান',
    step1: 'দরপত্র ফাইল', step2: 'পিডিএফ আপলোড', step3: 'মিলানো ও তারিখ', step4: 'পর্যালোচনা ও ডাউনলোড',
    loadJson: '১. requirements.json লোড করুন',
    loadJsonHelp: 'এই দরপত্রের জন্য পাওয়া requirements.json ফাইলটি বেছে নিন। অথবা ডেমো চেষ্টা করুন।',
    chooseJson: 'requirements.json বেছে নিন',
    tryDemo: 'ডেমো ডেটা চেষ্টা করুন',
    tender: 'দরপত্র', deadline: 'জমার শেষ তারিখ', bidder: 'দরদাতা', entity: 'ক্রয়কারী প্রতিষ্ঠান',
    upload: '২. পিডিএফ ফাইল আপলোড করুন',
    uploadHelp: 'সর্বোচ্চ ৩০টি পিডিএফ, মোট ৫০ MB। ফাইল শুধু আপনার ব্রাউজারে থাকে — কোথাও আপলোড হয় না।',
    choosePdfs: 'পিডিএফ ফাইল বেছে নিন',
    noFiles: 'এখনো ফাইল নেই। শুরু করতে পিডিএফ বেছে নিন।',
    remove: 'মুছুন',
    pages: 'পৃষ্ঠা',
    dropJson: '…অথবা ফাইলটি এখানে টেনে আনুন',
    dropPdfs: '…অথবা পিডিএফ এখানে টেনে আনুন',
    mandatory: 'বাধ্যতামূলক', optional: 'ঐচ্ছিক',
    clear: 'মুছুন',
    duplicateOf: 'এর অনুলিপি',
    summaryBar: 'টি সমস্যা ঠিক করতে হবে',
    allGood: 'ঠিক করার কিছু নেই — সব প্রয়োজন মিটেছে।',
    blockingList: 'যা আটকে আছে:',
    dupBlocked: 'ফাইল দুটি একই। শুধু একটিই ব্যবহার করুন।',
    dupBlockedNamed: '{a} এবং {b} একই ফাইল। শুধু একটিই ব্যবহার করুন।',
    notPdfMagic: 'আসল পিডিএফ ফাইল নয় (%PDF হেডার নেই)।',
    notPdfNamed: '{file}: শুধু পিডিএফ ফাইল দেওয়া যাবে।',
    fileNotPdf: '{file} আসল পিডিএফ ফাইল নয় (%PDF হেডার নেই)।',
    notRealPdf: 'আসল পিডিএফ ফাইল নয় (%PDF হেডার নেই)',
    badPdfNamed: '{file} পিডিএফ হিসেবে পড়া যায়নি।',
    lockedPdf: 'পাসওয়ার্ড-সুরক্ষিত, ব্যবহার করা যাবে না',
    damagedPdf: 'ক্ষতিগ্রস্ত ফাইল, পড়া যাচ্ছে না',
    hashing: 'ফাইল পড়া হচ্ছে…',
    stepOf: '৪টির মধ্যে ধাপ {n}',
    progressOk: '{total}টির মধ্যে {ok}টি প্রস্তুত',
    reqListTitle: 'এই দরপত্রের প্রয়োজনসমূহ',
    match: '৩. ফাইল মিলান ও মেয়াদের তারিখ দিন',
    matchHelp: 'প্রতিটি প্রয়োজনের জন্য একটি পিডিএফ বেছে নিন। যেখানে চাওয়া হয়েছে মেয়াদের তারিখ দিন।',
    pickFile: '— ফাইল বেছে নিন —',
    expiry: 'মেয়াদের তারিখ',
    status: '৪. সরাসরি অবস্থা ও ডাউনলোড',
    ready: 'প্রস্তুত', blocking: 'মনোযোগ দরকার',
    download: 'একত্রিত পিডিএফ ডাউনলোড করুন',
    generate: 'প্যাকেজ তৈরি করুন',
    generating: 'তৈরি হচ্ছে…',
    building: 'পিডিএফ তৈরি হচ্ছে…',
    blockedMsg: 'নিচে চিহ্নিতগুলো ঠিক করুন, তারপর ডাউনলোড করুন।',
    okMsg: 'সব প্রস্তুত। এখন প্যাকেজ ডাউনলোড করতে পারেন।',
    successMsg: 'প্যাকেজ ডাউনলোড হয়েছে: {file} — {pages} পৃষ্ঠা।',
    pagesCount: '{n} পৃষ্ঠা',
    unnamedFile: 'নামহীন ফাইল',
    unknownError: 'কিছু একটা ভুল হয়েছে।',
    corruptNamed: '{file} ব্যবহার করা যায়নি: {reason}',
    coverNote: 'একত্রিত পিডিএফ একটি কভার পৃষ্ঠা দিয়ে শুরু হয়, তারপর ক্রমানুসারে প্রতিটি নথি থাকে।',
    fileName: 'ফাইলের নাম',
    unmatched: 'অমিলিত ফাইল (প্যাকেজে ব্যবহার হবে না)',
    newTender: 'নতুন করে শুরু',
    footer: '১০০% ব্রাউজারেই — ফাইল এই কম্পিউটার ছাড়ে না।',
    removeTitle: 'এই ফাইলটি সরান',
    clearTitle: 'এই ফাইলের মিল বাতিল করুন',
    langTitle: 'ভাষা / Language',
    statuses: {
      missing: 'অনুপস্থিত — প্রয়োজনীয় ফাইল যুক্ত হয়নি',
      expiryNeeded: 'মেয়াদের তারিখ দরকার',
      expired: 'মেয়াদোত্তীর্ণ — তারিখ শেষ তারিখের আগে',
      notProvided: 'দেওয়া হয়নি (ঐচ্ছিক)',
      ok: 'ঠিক আছে',
    },
    errors: {
      INVALID_JSON: 'ফাইলটি সঠিক JSON নয়।',
      INVALID_SHAPE: 'ফাইলটি রিকোয়ারমেন্ট ফাইল বলে মনে হচ্ছে না।',
      MISSING_TENDER: 'ফাইলে দরপত্রের তথ্য নেই।',
      BAD_DEADLINE: 'জমার শেষ তারিখ সঠিক নয় (YYYY-MM-DD)।',
      MISSING_REQUIREMENTS: 'ফাইলে প্রয়োজনসমূহের তালিকা নেই।',
      EMPTY_REQUIREMENTS: 'প্রয়োজনসমূহের তালিকা খালি।',
      BAD_REQUIREMENT: 'একটি প্রয়োজন এন্ট্রি সঠিক নয়।',
      DUPLICATE_ID: 'দুটি প্রয়োজনের একই id আছে।',
      NOT_PDF: 'শুধু পিডিএফ ফাইল দেওয়া যাবে।',
      TOO_MANY_FILES: 'সর্বোচ্চ ৩০টি ফাইল যুক্ত করা যাবে।',
      TOO_MANY_BYTES: 'মোট ফাইলের আকার ৫০ MB এর মধ্যে হতে হবে।',
      BAD_PDF: 'ফাইলটি পিডিএফ হিসেবে পড়া যায়নি।',
    },
  },
};
