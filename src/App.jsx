import { useMemo, useRef, useState } from 'react';
import {
  parseRequirements, checkUploadLimits, formatBytes,
  getPackageSummary, buildFilename, getDisplayTitle, autoMatchAll,
  findDuplicateGroups, sha256Hex,
} from './logic.js';
import { STR, useLang, msgFor, fill, limitMsg } from './i18n.js';
import { validatePdf, countPages, buildPackagePdf, downloadBytes } from './pdf.js';

let fileSeq = 0;

// %PDF magic bytes: first 5 bytes must be "%PDF-".
function hasPdfMagic(u8) {
  return u8.length >= 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44
    && u8[3] === 0x46 && u8[4] === 0x2d;
}

export default function App() {
  const [lang, setLang] = useLang();
  const [tender, setTender] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [files, setFiles] = useState([]); // {id,name,size,bytes,pages,hash} — usable only
  const [badFiles, setBadFiles] = useState([]); // {name, kind} — rejected, never matchable
  const [matches, setMatches] = useState({}); // reqId -> {fileId, expiry}
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [success, setSuccess] = useState('');
  const [building, setBuilding] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [dragJson, setDragJson] = useState(false);
  const [dragPdf, setDragPdf] = useState(false);
  const [suggestions, setSuggestions] = useState([]); // {fileId, reqId, score}
  const [autoRan, setAutoRan] = useState(false);
  const jsonRef = useRef(null);
  const pdfRef = useRef(null);
  const t = STR[lang];

  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);
  const summary = useMemo(
    () => (tender ? getPackageSummary(requirements, matches, tender.submission_deadline) : null),
    [tender, requirements, matches]
  );
  const fileById = useMemo(() => Object.fromEntries(files.map((f) => [f.id, f])), [files]);
  const usedFileIds = useMemo(
    () => new Set(Object.values(matches).map((m) => m && m.fileId).filter(Boolean)),
    [matches]
  );
  const dupMap = useMemo(
    () => findDuplicateGroups(files.map((f) => ({ id: f.id, hash: f.hash }))),
    [files]
  );
  const dupOfName = useMemo(() => {
    const out = {};
    const seen = {};
    for (const f of files) {
      const g = dupMap[f.id];
      if (!g) continue;
      if (!(g in seen)) seen[g] = f.name;
      else if (!(f.id in out)) out[f.id] = seen[g];
    }
    return out;
  }, [files, dupMap]);
  // Drop suggestions that became stale (file removed/matched, or req matched).
  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => {
      const req = requirements.find((r) => r.id === s.reqId);
      const m = matches[s.reqId];
      return !!req && !!fileById[s.fileId] && !(m && m.fileId);
    }),
    [suggestions, requirements, matches, fileById]
  );

  function resetForTender(parsed) {
    setTender(parsed.tender);
    setRequirements(parsed.requirements);
    setFiles([]);
    setBadFiles([]);
    setMatches({});
    setSuggestions([]);
    setAutoRan(false);
    setError('');
    setNotice('');
    setSuccess('');
  }

  async function loadJsonBlob(blob) {
    try {
      resetForTender(parseRequirements(await blob.text()));
    } catch (err) {
      setError(msgFor(lang, err));
    }
  }

  async function onJsonFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) loadJsonBlob(f);
  }

  async function onTryDemo() {
    setError('');
    try {
      const res = await fetch('sample-requirements.json');
      resetForTender(parseRequirements(await res.text()));
    } catch (err) {
      setError(msgFor(lang, err));
    }
  }

  async function addPdfBlobs(blobs) {
    const picked = Array.from(blobs || []);
    if (!picked.length) return;
    setNotice('');
    const check = checkUploadLimits(files.length, totalBytes, picked);
    if (!check.ok) {
      setError(limitMsg(lang, check));
      return;
    }
    setError('');
    setHashing(true);
    try {
      const added = [];
      const rejected = [];
      for (const f of picked) {
        let buf;
        try {
          buf = new Uint8Array(await f.arrayBuffer());
        } catch {
          rejected.push({ name: f.name || t.unnamedFile, kind: 'damaged' });
          continue;
        }
        if (!hasPdfMagic(buf)) {
          rejected.push({ name: f.name, kind: 'notpdf' });
          continue;
        }
        const v = await validatePdf(buf.slice());
        if (!v.ok) {
          rejected.push({ name: f.name, kind: v.reason }); // 'locked' | 'damaged'
          continue;
        }
        let hash = '';
        try {
          hash = await sha256Hex(buf.slice());
        } catch {
          rejected.push({ name: f.name, kind: 'damaged' });
          continue;
        }
        added.push({ id: 'F' + (++fileSeq), name: f.name, size: f.size, bytes: buf, pages: v.pages, hash });
      }
      // Bad files are listed with a clear per-file error and never added,
      // so they cannot be matched and the app never crashes.
      setBadFiles((prev) => [...prev, ...rejected]);
      if (rejected.length && !added.length) return;
      if (!added.length) return;
      setFiles((prev) => [...prev, ...added]);
      // Queue fuzzy suggestions for the user to confirm (Bonus A).
      const takenReq = requirements
        .filter((r) => matches[r.id] && matches[r.id].fileId)
        .map((r) => r.id);
      const picks = autoMatchAll(added, requirements, takenReq);
      if (picks.length) setSuggestions((prev) => [...prev, ...picks]);
    } finally {
      setHashing(false);
    }
  }

  async function onPdfFiles(e) {
    const picked = e.target.files;
    e.target.value = '';
    await addPdfBlobs(picked);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setSuggestions((prev) => prev.filter((s) => s.fileId !== id));
    setMatches((prev) => {
      const next = {};
      for (const [k, m] of Object.entries(prev)) {
        if (m && m.fileId === id) next[k] = { fileId: '', expiry: '' };
        else next[k] = m;
      }
      return next;
    });
  }
  function pickFile(reqId, fileId) {
    setNotice('');
    if (fileId) {
      const cand = files.find((f) => f.id === fileId);
      const candHash = cand && cand.hash;
      for (const [k, m] of Object.entries(matches)) {
        if (k !== reqId && m && m.fileId && m.fileId !== fileId) {
          const other = files.find((f) => f.id === m.fileId);
          if (candHash && other && other.hash === candHash) {
            setNotice(fill(t.dupBlockedNamed, { a: cand.name, b: other.name }));
            return false; // rejected — keep any pending suggestion
          }
        }
      }
    }
    setMatches((prev) => {
      const next = { ...prev };
      for (const [k, m] of Object.entries(next)) {
        if (k !== reqId && m && m.fileId === fileId) next[k] = { fileId: '', expiry: m.expiry || '' };
      }
      next[reqId] = { fileId: fileId || '', expiry: (next[reqId] && next[reqId].expiry) || '' };
      return next;
    });
    return true;
  }

  function clearMatch(reqId) {
    setNotice('');
    setMatches((prev) => ({ ...prev, [reqId]: { fileId: '', expiry: '' } }));
  }

  function setMatch(reqId, patch) {
    setMatches((prev) => ({ ...prev, [reqId]: { fileId: '', expiry: '', ...(prev[reqId] || {}), ...patch } }));
  }

  // ---- Bonus A: fuzzy auto-match — suggestions the user confirms ----
  function acceptSuggestion(s) {
    const ok = pickFile(s.reqId, s.fileId); // pickFile enforces dup-hash guard
    if (!ok) return; // rejection shows a notice; keep the suggestion
    setSuggestions((prev) => prev.filter((x) => x !== s && x.reqId !== s.reqId && x.fileId !== s.fileId));
  }
  function dismissSuggestion(s) {
    setSuggestions((prev) => prev.filter((x) => x !== s));
  }
  function runAutoMatch() {
    setNotice('');
    const takenReq = requirements
      .filter((r) => matches[r.id] && matches[r.id].fileId)
      .map((r) => r.id);
    const free = files.filter((f) => !usedFileIds.has(f.id));
    const picks = autoMatchAll(free, requirements, takenReq);
    setSuggestions(picks);
    setAutoRan(true);
  }

  async function onDownload() {
    if (!summary || !summary.canDownload || building) return;
    setBuilding(true);
    setError('');
    setSuccess('');
    try {
      const items = [];
      for (const it of summary.items) {
        const m = matches[it.req.id];
        if (m && m.fileId) items.push({ req: it.req, bytes: fileById[m.fileId].bytes, expiry: m.expiry || '' });
      }
      const out = await buildPackagePdf(tender, items);
      const fname = buildFilename(tender.tender_id);
      downloadBytes(out, fname);
      const npages = await countPages(out);
      setSuccess(fill(t.successMsg, { file: fname, pages: npages }));
    } catch (err) {
      setError(msgFor(lang, err));
    } finally {
      setBuilding(false);
    }
  }

  function badMsg(b) {
    if (b.kind === 'locked') return t.lockedPdf;
    if (b.kind === 'notpdf') return t.notRealPdf;
    return t.damagedPdf;
  }

  const unmatched = files.filter((f) => !usedFileIds.has(f.id));
  const blockers = tender
    ? summary.items.filter((i) => i.blocking).map((i) => ({
        name: `${i.req.order}. ${getDisplayTitle(i.req, lang)}`,
        status: t.statuses[i.status],
      }))
    : [];
  const pct = tender && requirements.length
    ? Math.round((summary.okCount / requirements.length) * 100) : 0;
  const stepDone = [!!tender, files.length > 0, summary && summary.okCount > 0, summary && summary.canDownload];

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>{t.appTitle}</h1>
          <p>{t.appSub}</p>
        </div>
        <div className="langswitch" title={t.langTitle} aria-label={t.langTitle}>
          <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} title={t.switchToEn} aria-label={t.switchToEn}>EN</button>
          <button className={lang === 'bn' ? 'active' : ''} onClick={() => setLang('bn')} title={t.switchToBn} aria-label={t.switchToBn}>বাংলা</button>
        </div>
      </header>

      <ol className="steps" aria-label={fill(t.stepOf, { n: tender ? (summary.canDownload ? 4 : files.length ? 3 : 2) : 1 })}>
        {[t.step1, t.step2, t.step3, t.step4].map((s, i) => (
          <li key={i} className={stepDone[i] ? 'done' : (i === 0 || stepDone[i - 1] ? 'current' : '')}>
            <span className="stepnum">{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      {tender && (
        <div className="progress" role="status">
          <div className="progress-top">
            <span>{fill(t.progressOk, { ok: summary.okCount, total: requirements.length })}</span>
            <span>{pct}%</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: pct + '%' }} /></div>
        </div>
      )}

      {error && <div className="msg err">{error}</div>}
      {notice && <div className="msg bad">{notice}</div>}

      <div className="cols">
        <section
          className={'card drop' + (dragJson ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setDragJson(true); }}
          onDragLeave={() => setDragJson(false)}
          onDrop={(e) => { e.preventDefault(); setDragJson(false); if (e.dataTransfer.files[0]) loadJsonBlob(e.dataTransfer.files[0]); }}
        >
          <h2><span className="cardnum">1</span> {t.loadJson}</h2>
          <p className="help">{t.loadJsonHelp} {t.dropJson}</p>
          <button className="btn" onClick={() => jsonRef.current.click()} title={t.chooseJson}>{t.chooseJson}</button>
          <button className="btn secondary" onClick={onTryDemo} title={t.tryDemo}>{t.tryDemo}</button>
          <input ref={jsonRef} type="file" accept="application/json,.json" hidden onChange={onJsonFile} />
          {tender && (
            <div className="tenderbox">
              <div><b>{tender.tender_id}</b> — {tender.title}</div>
              <div><b>{t.entity}:</b> {tender.procuring_entity}</div>
              <div><b>{t.bidder}:</b> {tender.bidder}</div>
              <div><b>{t.deadline}:</b> {tender.submission_deadline}</div>
              <div className="reqlist-title">{t.reqListTitle}:</div>
              <ol className="reqlist">
                {requirements.map((r) => (
                  <li key={r.id}>{r.order}. {getDisplayTitle(r, lang)} {r.mandatory ? '' : `(${t.optional})`}</li>
                ))}
              </ol>
            </div>
          )}
        </section>

        <section
          className={'card drop' + (dragPdf ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); if (tender) setDragPdf(true); }}
          onDragLeave={() => setDragPdf(false)}
          onDrop={(e) => { e.preventDefault(); setDragPdf(false); if (tender) addPdfBlobs(e.dataTransfer.files); }}
        >
          <h2><span className="cardnum">2</span> {t.upload}</h2>
          <p className="help">{t.uploadHelp} ({files.length}/30, {formatBytes(totalBytes)}/50 MB) {t.dropPdfs}</p>
          <button className="btn" disabled={!tender || hashing} onClick={() => pdfRef.current.click()} title={t.choosePdfs}>
            {hashing ? t.hashing : t.choosePdfs}
          </button>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onPdfFiles} />
          {!tender && <p className="note empty">{t.loadJson}</p>}
          {tender && files.length === 0 && badFiles.length === 0 && !hashing && <p className="note empty">{t.noFiles}</p>}
          {hashing && <p className="note busy"><span className="spinner" aria-hidden="true" /> {t.hashing}</p>}
          {files.length > 0 && (
            <ul className="filelist">
              {files.map((f) => (
                <li key={f.id}>
                  <span>
                    <b>{f.name}</b> — {formatBytes(f.size)}, {f.pages} {t.pages}
                    {dupOfName[f.id] && (
                      <span className="dupbadge"> {t.duplicateOf} {dupOfName[f.id]}</span>
                    )}
                  </span>
                  <button className="linkbtn" onClick={() => removeFile(f.id)} title={t.removeTitle} aria-label={`${t.removeTitle}: ${f.name}`}>{t.remove}</button>
                </li>
              ))}
            </ul>
          )}
          {badFiles.length > 0 && (
            <ul className="filelist badlist">
              {badFiles.map((b, i) => (
                <li key={i} className="badfile">
                  <span><b>{b.name}</b> — <span className="badbadge">{badMsg(b)}</span></span>
                  <button className="linkbtn" onClick={() => setBadFiles((prev) => prev.filter((_, j) => j !== i))} title={t.removeTitle} aria-label={`${t.removeTitle}: ${b.name}`}>{t.remove}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {tender && (
        <section className="card">
          <h2><span className="cardnum">3</span> {t.match}</h2>
          <p className="help">{t.matchHelp}</p>
          {files.length > 0 && requirements.length > 0 && (
            <div className="automatch-bar">
              <button className="btn small" onClick={runAutoMatch} disabled={usedFileIds.size >= files.length}>
                {t.autoMatch}
              </button>
              <span className="note">{t.autoMatchHelp}</span>
            </div>
          )}
          {visibleSuggestions.length > 0 && (
            <div className="msg sug">
              <b>{t.suggestions} ({visibleSuggestions.length})</b>
              <ul className="suglist">
                {visibleSuggestions.map((s) => {
                  const f = fileById[s.fileId];
                  const req = requirements.find((r) => r.id === s.reqId);
                  if (!f || !req) return null;
                  return (
                    <li key={s.fileId + '|' + s.reqId}>
                      <span className="sugtext">
                        <code>{f.name}</code> → {getDisplayTitle(req, lang)}
                        <span className="sugpct">{Math.round(s.score * 100)}%</span>
                      </span>
                      <span className="sugactions">
                        <button className="btn tiny" onClick={() => acceptSuggestion(s)}>{t.confirm}</button>
                        <button className="linkbtn" onClick={() => dismissSuggestion(s)}>{t.dismiss}</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {autoRan && visibleSuggestions.length === 0 && (
            <div className="msg good">{t.noSuggestions}</div>
          )}
          {blockers.length > 0 && (
            <div className="msg bad">
              <b>{blockers.length} {t.summaryBar}</b>
              <ul className="blockerlist">
                {blockers.map((b, i) => (
                  <li key={i}>{b.name} — {b.status}</li>
                ))}
              </ul>
              <div className="blocker-sub">{t.blockingList}</div>
            </div>
          )}
          {blockers.length === 0 && <div className="msg good">{t.allGood}</div>}
          {requirements.map((req) => {
            const m = matches[req.id] || { fileId: '', expiry: '' };
            const st = summary.items.find((i) => i.req.id === req.id).status;
            const offered = files.filter((f) => !usedFileIds.has(f.id) || f.id === m.fileId);
            return (
              <div className="req" key={req.id}>
                <div className="row1">
                  <span className="title">{req.order}. {getDisplayTitle(req, lang)}</span>
                  <span className={'pill ' + (req.mandatory ? 'mand' : 'opt')}>
                    {req.mandatory ? t.mandatory : t.optional}
                  </span>
                </div>
                <div className="row2">
                  <select value={m.fileId} onChange={(e) => pickFile(req.id, e.target.value)}>
                    <option value="">{t.pickFile}</option>
                    {offered.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}{dupOfName[f.id] ? ` (${t.duplicateOf} ${dupOfName[f.id]})` : ''}
                      </option>
                    ))}
                  </select>
                  {m.fileId !== '' && (
                    <button className="linkbtn" onClick={() => clearMatch(req.id)} title={t.clearTitle} aria-label={t.clearTitle}>{t.clear}</button>
                  )}
                  {req.has_expiry && m.fileId !== '' && (
                    <label>{t.expiry}: <input type="date" value={m.expiry} onChange={(e) => setMatch(req.id, { expiry: e.target.value })} /></label>
                  )}
                </div>
                <div className={'chip ' + st.replace(/([A-Z])/g, '-$1').toLowerCase()}>{t.statuses[st]}</div>
              </div>
            );
          })}
        </section>
      )}

      {tender && (
        <section className="card">
          <h2><span className="cardnum">4</span> {t.status}</h2>
          <div className="summary">
            <span><b className="ok">{summary.okCount}</b> {t.ready}</span>
            <span><b className="bad">{summary.blockingCount}</b> {t.blocking}</span>
          </div>
          {summary.canDownload && <div className="msg good">{t.okMsg}</div>}
          {!summary.canDownload && <div className="msg bad">{t.blockedMsg}</div>}
          <button className="btn big" disabled={!summary.canDownload || building} onClick={onDownload} title={summary.canDownload ? t.generate : t.blockedMsg}>
            {building && <span className="spinner light" aria-hidden="true" />}
            {building ? t.building : t.download}
          </button>
          {success && <div className="msg good">{success}</div>}
          <p className="note">{t.coverNote}</p>
          <p className="note">{t.fileName}: <b>{buildFilename(tender.tender_id)}</b></p>
          {unmatched.length > 0 && (
            <p className="unmatched">{t.unmatched}: {unmatched.map((f) => f.name).join(', ')}</p>
          )}
        </section>
      )}

      <footer>{t.footer}</footer>
    </div>
  );
}

