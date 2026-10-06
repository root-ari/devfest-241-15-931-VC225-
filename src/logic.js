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

// ---- auto-match (fuzzy filename <-> requirement) ---------------------------
// Pure, deterministic, dependency-free.

/** Split into lowercase alphanumeric tokens, dropping 1-letter noise. */
export function tokensOf(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1);
}

// Light stemming so "license/licensed/licences", "proposal/proposals",
// "certificate/certificates", "authorization/authorizations" line up.
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

const STOP = new Set([
  'the', 'of', 'and', 'for', 'a', 'an', 'certificate', 'cert',
  'copy', 'scan', 'scanned', 'final', 'new', 'updated', 'page', 'doc', 'document',
]);

function sigTokens(words) {
  const out = [];
  for (const w of words) {
    const s = stem(w);
    if (!STOP.has(s) && !STOP.has(w)) out.push(s);
  }
  return [...new Set(out)];
}

function initials(words) {
  return words.map((w) => w[0]).join('');
}

/**
 * Fuzzy score 0..1 between a file name and a requirement.
 * Signals: requirement id (exact/partial), exact token overlap, acronym match
 * (e.g. "tin" for TIN Certificate), substring/prefix overlap for truncated
 * names ("vat_cert" vs VAT Registration Certificate).
 */
export function scoreAutoMatch(fileName, requirement) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '');
  const fw = tokensOf(base);
  if (!fw.length) return 0;
  const fs = new Set(sigTokens(fw));

  const id = String(requirement.id || '').toLowerCase();
  // Requirement id like "R01" or "trade-license" appearing in the filename.
  if (id) {
    const flat = base.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (flat.includes(id.replace(/[^a-z0-9]+/g, ''))) return 1;
  }

  const title = tokensOf(requirement.title_en);
  const ts = sigTokens(title);
  if (!ts.length) return 0;

  let hit = 0;
  let weight = 0;
  for (const tw of ts) {
    const w = tw.length >= 6 ? 2 : 1; // long words matter more
    weight += w;
    if (fs.has(tw)) { hit += w; continue; }
    // prefix/substring either way, min 3 chars ("trad" ~ "trade")
    let partial = false;
    for (const f of fs) {
      if (f.length >= 3 && tw.length >= 3 && (f.startsWith(tw.slice(0, 4)) || tw.startsWith(f.slice(0, 4)) || f.includes(tw) || tw.includes(f))) {
        partial = true;
        break;
      }
    }
    if (partial) hit += w * 0.6;
  }
  let score = weight ? hit / weight : 0;

  // Acronym bonus: a filename token equal to a title initialism ("tin" for T-I-N).
  const init = initials(title.filter((w) => !STOP.has(w) && !STOP.has(stem(w))));
  if (init.length > 1 && fs.has(init)) score = Math.min(1, score + 0.5);

  // Coverage: what fraction of the filename's own words got used.
  let used = 0;
  for (const f of fs) {
    if (ts.includes(f) || ts.some((tw) => f.length >= 4 && (tw.startsWith(f.slice(0, 4)) || f.startsWith(tw.slice(0, 4))))) used++;
  }
  const coverage = fs.size ? used / fs.size : 0;
  score = score * 0.7 + coverage * 0.3;

  // Penalize matches that only hit one generic word of a long title.
  if (hit <= 1 && ts.length >= 3) score *= 0.6;
  return Math.max(0, Math.min(1, score));
}

/**
 * Best requirement for one filename. Returns { reqId, score } or null when
 * nothing passes `minScore` (default 0.35).
 */
export function suggestMatch(fileName, requirements, minScore = 0.35) {
  let best = null;
  let bestScore = 0;
  for (const r of requirements || []) {
    const s = scoreAutoMatch(fileName, r);
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (!best || bestScore < minScore) return null;
  return { reqId: best.id, score: Math.round(bestScore * 100) / 100 };
}

/**
 * Suggest matches for many files at once. Each file gets its best free
 * requirement; each requirement is used at most once (greedy by score).
 * @param {Array<{id:string,name:string}>} files — only unmatched files
 * @param {Array} requirements — full list
 * @param {Set|Array} takenReqIds — requirement ids already matched
 * @param {number} minScore
 * @returns {Array<{fileId:string, reqId:string, score:number}>} sorted by score desc
 */
export function autoMatchAll(files, requirements, takenReqIds, minScore = 0.35) {
  const taken = new Set(takenReqIds || []);
  const cands = [];
  const hashOf = new Map();
  for (const f of files || []) {
    if (f && f.id && f.hash) hashOf.set(f.id, f.hash);
    for (const r of requirements || []) {
      if (taken.has(r.id)) continue;
      const s = scoreAutoMatch(f.name, r);
      if (s >= minScore) cands.push({ fileId: f.id, fileName: f.name, reqId: r.id, score: s });
    }
  }
  cands.sort((a, b) => b.score - a.score || String(a.fileId).localeCompare(String(b.fileId)));
  const usedFiles = new Set();
  const usedReqs = new Set(taken);
  const usedHashes = new Set();
  const picks = [];
  for (const c of cands) {
    if (usedFiles.has(c.fileId) || usedReqs.has(c.reqId)) continue;
    const h = hashOf.get(c.fileId);
    if (h && usedHashes.has(h)) continue; // same content, other name — one pick only
    usedFiles.add(c.fileId);
    usedReqs.add(c.reqId);
    if (h) usedHashes.add(h);
    picks.push({ fileId: c.fileId, reqId: c.reqId, score: Math.round(c.score * 100) / 100 });
  }
  return picks.sort((a, b) => b.score - a.score);
}
