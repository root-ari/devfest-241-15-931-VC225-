// Pure business logic — no React, no DOM, no libraries.
// All functions are unit-testable and framework-free.
//
// Status vocabulary (spec): 'missing' | 'expiryNeeded' | 'expired' | 'notProvided' | 'ok'
// The UI also uses kebab-case aliases ('expiry-needed' | 'not-provided'); both are
// accepted as input, and computeStatus/getRequirementStatus return spec casing.

export const MAX_FILES = 30;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

/** Normalize a status token to spec casing (accepts kebab-case aliases). */
export function normStatus(s) {
  if (s === 'expiry-needed') return 'expiryNeeded';
  if (s === 'not-provided') return 'notProvided';
  return s;
}

/** Validate a YYYY-MM-DD string (format + real calendar date). */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---- parseRequirements ----------------------------------------------------
/**
 * Validate requirements.json shape and return { tender, requirements } with
 * requirements sorted by `order` (ties by `id`).
 * Input may be a JSON string or an already-parsed object.
 * Throws Error with a clear key: INVALID_JSON | INVALID_SHAPE | MISSING_TENDER |
 * MISSING_TENDER_FIELD:<k> | BAD_DEADLINE | MISSING_REQUIREMENTS |
 * EMPTY_REQUIREMENTS | BAD_REQUIREMENT:<i> | BAD_REQUIREMENT_FIELD:<k> | DUPLICATE_ID:<id>
 */
export function parseRequirements(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('INVALID_JSON');
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_SHAPE');
  const { tender, requirements } = data;
  if (!tender || typeof tender !== 'object' || Array.isArray(tender)) throw new Error('MISSING_TENDER');
  for (const k of ['tender_id', 'title', 'procuring_entity', 'bidder', 'submission_deadline']) {
    if (typeof tender[k] !== 'string' || tender[k].trim() === '') throw new Error('MISSING_TENDER_FIELD:' + k);
  }
  if (!isValidDateStr(tender.submission_deadline)) throw new Error('BAD_DEADLINE');
  if (!Array.isArray(requirements)) throw new Error('MISSING_REQUIREMENTS');
  if (requirements.length === 0) throw new Error('EMPTY_REQUIREMENTS');
  const seen = new Set();
  const reqs = requirements.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('BAD_REQUIREMENT:' + i);
    for (const k of ['id', 'title_en', 'title_bn']) {
      if (typeof r[k] !== 'string' || r[k].trim() === '') throw new Error('BAD_REQUIREMENT_FIELD:' + k);
    }
    if (typeof r.order !== 'number' || !Number.isFinite(r.order)) throw new Error('BAD_REQUIREMENT_FIELD:order');
    if (typeof r.mandatory !== 'boolean') throw new Error('BAD_REQUIREMENT_FIELD:mandatory');
    if (typeof r.has_expiry !== 'boolean') throw new Error('BAD_REQUIREMENT_FIELD:has_expiry');
    if (seen.has(r.id)) throw new Error('DUPLICATE_ID:' + r.id);
    seen.add(r.id);
    return {
      id: r.id, order: r.order, title_en: r.title_en, title_bn: r.title_bn,
      mandatory: r.mandatory, has_expiry: r.has_expiry,
    };
  });
  return { tender: { ...tender }, requirements: sortRequirements(reqs) };
}

// Backwards-compatible alias used by the App (accepts a JSON string).
export function parseRequirementsJson(text) {
  return parseRequirements(text);
}

export function sortRequirements(reqs) {
  return [...reqs].sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
}

// ---- upload limits --------------------------------------------------------
export function checkUploadLimits(existingCount, existingBytes, newFiles) {
  const addBytes = newFiles.reduce((s, f) => s + (f.size || 0), 0);
  if (existingCount + newFiles.length > MAX_FILES) return { ok: false, reason: 'TOO_MANY_FILES' };
  if (existingBytes + addBytes > MAX_TOTAL_BYTES) return { ok: false, reason: 'TOO_MANY_BYTES' };
  const bad = newFiles.find((f) => !/\.pdf$/i.test(f.name || '') && f.type !== 'application/pdf');
  if (bad) return { ok: false, reason: 'NOT_PDF', fileName: bad.name };
  return { ok: true };
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---- sha256Hex ------------------------------------------------------------
/** SHA-256 hex digest of an ArrayBuffer / TypedArray using WebCrypto. */
export async function sha256Hex(buf) {
  const bytes = buf instanceof ArrayBuffer
    ? buf
    : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- findDuplicateGroups --------------------------------------------------
/**
 * Find files with identical content hashes.
 * @param {Array<{id:string, hash:string}>} files
 * @returns {Object} map of fileId -> groupId for ids that share a hash
 *   with at least one other file (unique files are omitted).
 *   groupId is `dup-<first-8-hex-of-hash>` (stable across runs).
 */
export function findDuplicateGroups(files) {
  const byHash = new Map();
  for (const f of files || []) {
    if (!f || !f.id || !f.hash) continue;
    if (!byHash.has(f.hash)) byHash.set(f.hash, []);
    byHash.get(f.hash).push(f.id);
  }
  const out = {};
  for (const [hash, ids] of byHash) {
    if (ids.length > 1) {
      const gid = 'dup-' + String(hash).slice(0, 8);
      for (const id of ids) out[id] = gid;
    }
  }
  return out;
}

// ---- computeStatus --------------------------------------------------------
/**
 * Exactly one status per requirement (priority: missing > expiryNeeded >
 * expired > notProvided > ok). Dates compare as YYYY-MM-DD strings — plain
 * lexicographic compare is chronological, no timezone involved.
 * Same-day expiry (expiry === deadline) is OK.
 * @param {Object} requirement { mandatory:boolean, has_expiry:boolean }
 * @param {Object|null} matchedFile truthy = a file is matched (any object with an id)
 * @param {string} expiryDate 'YYYY-MM-DD' or '' when not entered
 * @param {string} deadline 'YYYY-MM-DD' submission deadline
 */
export function computeStatus(requirement, matchedFile, expiryDate, deadline) {
  const hasFile = !!(matchedFile && (matchedFile.id || matchedFile.fileId));
  if (!hasFile) return requirement.mandatory ? 'missing' : 'notProvided';
  if (requirement.has_expiry && !isValidDateStr(expiryDate || '')) return 'expiryNeeded';
  if (requirement.has_expiry && expiryDate < deadline) return 'expired';
  return 'ok';
}

// UI-shaped wrapper: match = { fileId, expiry } — returns spec-cased status.
export function getRequirementStatus(req, match, deadline) {
  const m = match && match.fileId ? { id: match.fileId } : null;
  return computeStatus(req, m, (match && match.expiry) || '', deadline);
}

/** True when the status blocks download. Accepts both casings. */
export function isBlocking(status) {
  const s = normStatus(status);
  return s === 'missing' || s === 'expiryNeeded' || s === 'expired';
}

/**
 * Filter helper.
 * @param {Array|Object} statuses array of {id,status} OR map id -> status.
 * @returns only the blocking entries (same shape as the input).
 */
export function getBlockers(statuses) {
  if (Array.isArray(statuses)) return statuses.filter((s) => isBlocking(s && s.status));
  const out = {};
  for (const [k, v] of Object.entries(statuses || {})) if (isBlocking(v)) out[k] = normStatus(v);
  return out;
}

export function getDisplayTitle(req, lang) {
  return lang === 'bn' ? req.title_bn : req.title_en;
}

// Full package summary for live UI + download gating.
export function getPackageSummary(requirements, matches, deadline) {
  const items = requirements.map((req) => {
    const status = getRequirementStatus(req, matches[req.id], deadline);
    return { req, status, blocking: isBlocking(status) };
  });
  const blocking = items.filter((i) => i.blocking);
  const ok = items.filter((i) => i.status === 'ok');
  return { items, blockingCount: blocking.length, okCount: ok.length, canDownload: blocking.length === 0 };
}

export function buildFilename(tenderId) {
  return String(tenderId).trim().replace(/[\\/:*?"<>|]/g, '-') + '_Package.pdf';
}

// Suggest a requirement for an uploaded filename (keyword overlap on title_en).
// Returns requirement id or null. Staff can always change it.
export function suggestMatch(fileName, requirements) {
  const words = String(fileName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2);
  if (!words.length) return null;
  let best = null;
  let bestScore = 0;
  for (const r of requirements) {
    const title = String(r.title_en).toLowerCase();
    let score = 0;
    for (const w of words) if (title.includes(w)) score += w.length;
    if (score > bestScore) { bestScore = score; best = r.id; }
  }
  return bestScore > 0 ? best : null;
}
