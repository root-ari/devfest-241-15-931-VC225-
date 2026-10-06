// No-framework tests for src/logic.js. Run: node tests/logic.test.mjs
import {
  parseRequirements, computeStatus, isBlocking, getBlockers,
  findDuplicateGroups, sha256Hex,
  scoreAutoMatch, suggestMatch, autoMatchAll,
} from '../src/logic.js';

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' — got ' + a + ', want ' + e); }
}
function throwsKey(name, fn, key) {
  try { fn(); fail++; console.log('FAIL ' + name + ' — no error thrown'); }
  catch (err) { eq(name, err.message, key); }
}

const DL = '2026-10-20';
const mandExp = { mandatory: true, has_expiry: true };
const mandNoExp = { mandatory: true, has_expiry: false };
const optExp = { mandatory: false, has_expiry: true };
const optNoExp = { mandatory: false, has_expiry: false };

// Edge: same-day expiry is OK (string compare, no Date/timezone).
eq('same-day expiry ok', computeStatus(mandExp, { id: 'F1' }, '2026-10-20', DL), 'ok');
// Edge: day before deadline is expired.
eq('day-before expired', computeStatus(mandExp, { id: 'F1' }, '2026-10-19', DL), 'expired');
// Edge: optional with no file -> notProvided (not blocking).
eq('optional no file', computeStatus(optNoExp, null, '', DL), 'notProvided');
eq('optional no file not blocking', isBlocking('notProvided'), false);
// Edge: optional WITH file, has_expiry, but no date -> expiryNeeded (blocks!).
eq('optional+file, no date', computeStatus(optExp, { id: 'F1' }, '', DL), 'expiryNeeded');
eq('expiryNeeded blocks', isBlocking('expiryNeeded'), true);
// Edge: mandatory, expiry required, empty date -> expiryNeeded.
eq('mandatory expiry empty', computeStatus(mandExp, { id: 'F1' }, '', DL), 'expiryNeeded');
// Mandatory, no file -> missing.
eq('mandatory no file', computeStatus(mandNoExp, null, '', DL), 'missing');
// Mandatory + file, no expiry needed -> ok.
eq('mandatory+file ok', computeStatus(mandNoExp, { id: 'F1' }, '', DL), 'ok');
// Optional + file, no expiry needed -> ok (expiry ignored).
eq('optional+file ok', computeStatus(optNoExp, { id: 'F1' }, '', DL), 'ok');
// Optional + file + valid future expiry -> ok.
eq('optional+file+date ok', computeStatus(optExp, { id: 'F1' }, '2027-01-01', DL), 'ok');

// getBlockers: array shape and map shape.
eq('getBlockers array', getBlockers([
  { id: 'R1', status: 'missing' }, { id: 'R2', status: 'ok' }, { id: 'R3', status: 'notProvided' },
]), [{ id: 'R1', status: 'missing' }]);
eq('getBlockers map', getBlockers({ R1: 'expired', R2: 'ok' }), { R1: 'expired' });

// Duplicates: same hash grouped, unique omitted.
eq('duplicates', findDuplicateGroups([
  { id: 'A', hash: 'aabbccdd11' }, { id: 'B', hash: 'aabbccdd11' },
  { id: 'C', hash: 'zz' }, { id: 'D', hash: 'aabbccdd11' },
]), { A: 'dup-aabbccdd', B: 'dup-aabbccdd', D: 'dup-aabbccdd' });
eq('no duplicates', findDuplicateGroups([{ id: 'A', hash: 'x' }]), {});

// parseRequirements: sorts by order, validates.
const parsed = parseRequirements(JSON.stringify({
  tender: { tender_id: 'T1', title: 't', procuring_entity: 'e', bidder: 'b', submission_deadline: '2026-10-20' },
  requirements: [
    { id: 'R2', order: 2, title_en: 'B', title_bn: 'বি', mandatory: false, has_expiry: false },
    { id: 'R1', order: 1, title_en: 'A', title_bn: 'এ', mandatory: true, has_expiry: true },
  ],
}));
eq('parse sorts by order', parsed.requirements.map((r) => r.id), ['R1', 'R2']);
throwsKey('parse empty list', () => parseRequirements(JSON.stringify({
  tender: { tender_id: 'T', title: 't', procuring_entity: 'e', bidder: 'b', submission_deadline: '2026-10-20' },
  requirements: [],
})), 'EMPTY_REQUIREMENTS');
throwsKey('parse missing field', () => parseRequirements(JSON.stringify({
  tender: { tender_id: 'T', title: 't', procuring_entity: 'e', bidder: 'b' },
  requirements: [{ id: 'R1', order: 1, title_en: 'A', title_bn: 'B', mandatory: true, has_expiry: false }],
})), 'MISSING_TENDER_FIELD:submission_deadline');
throwsKey('parse bad json', () => parseRequirements('{nope'), 'INVALID_JSON');

// sha256Hex: known vector for "abc".
const h = await sha256Hex(new TextEncoder().encode('abc').buffer);
eq('sha256 abc', h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

// ---- auto-match (Bonus A) ----
const REQS = [
  { id: 'R01', order: 1, title_en: 'Trade License', title_bn: 'ট', mandatory: true, has_expiry: true },
  { id: 'R02', order: 2, title_en: 'TIN Certificate', title_bn: 'ট', mandatory: true, has_expiry: false },
  { id: 'R03', order: 3, title_en: 'VAT Registration Certificate', title_bn: 'ভ', mandatory: true, has_expiry: false },
  { id: 'R04', order: 4, title_en: 'Bank Solvency Certificate', title_bn: 'ব', mandatory: true, has_expiry: true },
  { id: 'R08', order: 8, title_en: 'Technical Proposal', title_bn: 'ক', mandatory: true, has_expiry: false },
  { id: 'R09', order: 9, title_en: 'Financial Proposal', title_bn: 'আ', mandatory: true, has_expiry: false },
];
eq('fuzzy trade_license.pdf -> R01', suggestMatch('trade_license.pdf', REQS).reqId, 'R01');
eq('fuzzy Trade-License-2026.PDF -> R01', suggestMatch('Trade-License-2026.PDF', REQS).reqId, 'R01');
eq('fuzzy tin_certificate.pdf -> R02', suggestMatch('tin_certificate.pdf', REQS).reqId, 'R02');
eq('fuzzy bank_solvency.pdf -> R04', suggestMatch('bank_solvency.pdf', REQS).reqId, 'R04');
eq('fuzzy 01_financial_proposal.pdf -> R09', suggestMatch('01_financial_proposal.pdf', REQS).reqId, 'R09');
eq('fuzzy 02_technical_proposal.pdf -> R08', suggestMatch('02_technical_proposal.pdf', REQS).reqId, 'R08');
eq('fuzzy unrelated -> null', suggestMatch('company_logo.png', REQS), null);
eq('fuzzy empty -> null', suggestMatch('', REQS), null);
// Similar titles compete: financial beats technical for "financial".
const sFin = scoreAutoMatch('financial.pdf', REQS[5]);
const sTech = scoreAutoMatch('financial.pdf', REQS[4]);
eq('financial.pdf prefers Financial Proposal', sFin > sTech, true);
// Requirement id in filename wins outright.
eq('id match wins', suggestMatch('R04-whatever.pdf', REQS).reqId, 'R04');
// autoMatchAll: one file <-> one requirement, best-score pairing.
const picks = autoMatchAll(
  [
    { id: 'F1', name: 'trade_license_2026.pdf' },
    { id: 'F2', name: 'trade_license_2025.pdf' },
    { id: 'F3', name: 'tin_certificate.pdf' },
  ],
  REQS, []
);
eq('autoMatchAll count', picks.length, 2);
eq('autoMatchAll R01 taken once', picks.filter((p) => p.reqId === 'R01').length, 1);
eq('autoMatchAll tin matched', picks.some((p) => p.fileId === 'F3' && p.reqId === 'R02'), true);
// Taken requirements are skipped.
const picks2 = autoMatchAll([{ id: 'F1', name: 'trade_license.pdf' }], REQS, ['R01']);
eq('autoMatchAll skips taken', picks2.length, 0);

// --- Duplicate content (same hash, different names) is only ever suggested once ---
const sameHash = 'aa'.repeat(32);
const crossPicks = autoMatchAll(
  [
    { id: 'X1', name: 'trade_license.pdf', hash: sameHash },
    { id: 'X2', name: 'tin_certificate.pdf', hash: sameHash },
  ],
  REQS, []
);
eq('dup content: only one of two identically-hashed files suggested', crossPicks.length, 1);
// Unique content is unaffected by hash dedupe.
const uniqPicks = autoMatchAll(
  [
    { id: 'U1', name: 'trade_license.pdf', hash: 'aa'.repeat(32) },
    { id: 'U2', name: 'tin_certificate.pdf', hash: 'bb'.repeat(32) },
  ],
  REQS, []
);
eq('unique content: both still suggested', uniqPicks.length, 2);
// Files without hash fields behave exactly as before (no dedupe).
const noHashPicks = autoMatchAll(
  [
    { id: 'N1', name: 'trade_license.pdf' },
    { id: 'N2', name: 'tin_certificate.pdf' },
  ],
  REQS, []
);
eq('no hash: both suggested', noHashPicks.length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
