// No-framework tests for src/logic.js. Run: node tests/logic.test.mjs
import {
  parseRequirements, computeStatus, isBlocking, getBlockers,
  findDuplicateGroups, sha256Hex,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
