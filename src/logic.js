// Pure business logic — no React, no DOM, no libraries.
// All functions are unit-testable and framework-free.

export const MAX_FILES = 30;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

// ---- requirements.json parsing -------------------------------------------
// Expected shape:
// { tender: { tender_id, title, procuring_entity, bidder, submission_deadline },
//   requirements: [ { id, order, title_en, title_bn, mandatory, has_expiry } ] }
export function parseRequirementsJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('INVALID_SHAPE');
  const { tender, requirements } = data;
  if (!tender || typeof tender !== 'object') throw new Error('MISSING_TENDER');
  for (const k of ['tender_id', 'title', 'procuring_entity', 'bidder', 'submission_deadline']) {
    if (!tender[k] || typeof tender[k] !== 'string') throw new Error('MISSING_TENDER_FIELD:' + k);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tender.submission_deadline)) throw new Error('BAD_DEADLINE');
  if (!Array.isArray(requirements) || requirements.length === 0) throw new Error('MISSING_REQUIREMENTS');
  const seen = new Set();
  const reqs = requirements.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error('BAD_REQUIREMENT:' + i);
    for (const k of ['id', 'title_en', 'title_bn']) {
      if (!r[k] || typeof r[k] !== 'string') throw new Error('BAD_REQUIREMENT_FIELD:' + k);
    }
    if (typeof r.order !== 'number') throw new Error('BAD_REQUIREMENT_FIELD:order');
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

// ---- status rules (exactly one per requirement) ---------------------------
// match = { fileId: string|null, expiry: 'YYYY-MM-DD'|'' } (or undefined)
// Priority: Missing > Expiry-needed > Expired > Not-provided > OK
export function getRequirementStatus(req, match, deadline) {
  const hasFile = !!(match && match.fileId);
  if (!hasFile) return req.mandatory ? 'missing' : 'not-provided';
  if (req.has_expiry && !(match.expiry && /^\d{4}-\d{2}-\d{2}$/.test(match.expiry))) {
    return 'expiry-needed';
  }
  if (req.has_expiry && match.expiry < deadline) return 'expired'; // same day is OK
  return 'ok';
}

export function isBlocking(status) {
  return status === 'missing' || status === 'expiry-needed' || status === 'expired';
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
