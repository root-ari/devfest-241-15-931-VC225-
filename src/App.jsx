import { useMemo, useRef, useState } from 'react';
import {
  parseRequirements, checkUploadLimits, formatBytes,
  getPackageSummary, buildFilename, getDisplayTitle, suggestMatch,
  findDuplicateGroups, sha256Hex,
} from './logic.js';
import { STR } from './i18n.js';
import { validatePdf, buildPackagePdf, downloadBytes } from './pdf.js';

let fileSeq = 0;

// %PDF magic bytes: first 5 bytes must be "%PDF-".
function hasPdfMagic(u8) {
  return u8.length >= 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44
    && u8[3] === 0x46 && u8[4] === 0x2d;
}

export default function App() {
  const [lang, setLang] = useState('en');
  const [tender, setTender] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [files, setFiles] = useState([]); // {id,name,size,bytes,pages,hash}
  const [matches, setMatches] = useState({}); // reqId -> {fileId, expiry}
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [building, setBuilding] = useState(false);
  const [dragJson, setDragJson] = useState(false);
  const [dragPdf, setDragPdf] = useState(false);
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

  function resetForTender(parsed) {
    setTender(parsed.tender);
    setRequirements(parsed.requirements);
    setFiles([]);
    setMatches({});
    setError('');
    setNotice('');
  }

  async function loadJsonBlob(blob) {
    try {
      resetForTender(parseRequirements(await blob.text()));
    } catch (err) {
      setError(t.errors[err.message] || err.message);
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
      setError(t.errors[err.message] || String(err.message || err));
    }
  }

  async function addPdfBlobs(blobs) {
    const picked = Array.from(blobs || []);
    if (!picked.length) return;
    setNotice('');
    const check = checkUploadLimits(files.length, totalBytes, picked);
    if (!check.ok) {
      setError(check.reason === 'NOT_PDF' ? `${t.errors.NOT_PDF} (${check.fileName})` : (t.errors[check.reason] || check.reason));
      return;
    }
    setError('');
    const added = [];
    for (const f of picked) {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (!hasPdfMagic(buf)) {
        setError(`${f.name} ${t.notPdfMagic}`);
        continue;
      }
      try {
        const pages = await validatePdf(buf.slice());
        const hash = await sha256Hex(buf.slice());
        added.push({ id: 'F' + (++fileSeq), name: f.name, size: f.size, bytes: buf, pages, hash });
      } catch {
        setError(`${t.errors.BAD_PDF} (${f.name})`);
      }
    }
    if (!added.length) return;
    setFiles((prev) => [...prev, ...added]);
    setMatches((prev) => {
      const next = { ...prev };
      for (const a of added) {
        const sug = suggestMatch(a.name, requirements);
        if (sug && !(next[sug] && next[sug].fileId)) next[sug] = { fileId: a.id, expiry: '' };
      }
      return next;
    });
  }

  async function onPdfFiles(e) {
    const picked = e.target.files;
    e.target.value = '';
    await addPdfBlobs(picked);
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
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
            setNotice(`${t.dupBlocked} (${cand.name} = ${other.name})`);
            return;
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
  }

  function clearMatch(reqId) {
    setNotice('');
    setMatches((prev) => ({ ...prev, [reqId]: { fileId: '', expiry: '' } }));
  }

  function setMatch(reqId, patch) {
    setMatches((prev) => ({ ...prev, [reqId]: { fileId: '', expiry: '', ...(prev[reqId] || {}), ...patch } }));
  }

  async function onDownload() {
    if (!summary || !summary.canDownload || building) return;
    setBuilding(true);
    setError('');
    try {
      const items = [];
      for (const it of summary.items) {
        const m = matches[it.req.id];
        if (m && m.fileId) items.push({ req: it.req, bytes: fileById[m.fileId].bytes, expiry: m.expiry || '' });
      }
      const out = await buildPackagePdf(tender, items);
      downloadBytes(out, buildFilename(tender.tender_id));
    } catch {
      setError(t.errors.BAD_PDF);
    } finally {
      setBuilding(false);
    }
  }

  const unmatched = files.filter((f) => !usedFileIds.has(f.id));
  const blockers = tender
    ? summary.items.filter((i) => i.blocking).map((i) => ({
        name: `${i.req.order}. ${getDisplayTitle(i.req, lang)}`,
        status: t.statuses[i.status],
      }))
    : [];

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>{t.appTitle}</h1>
          <p>{t.appSub}</p>
        </div>
        <div className="langswitch">
          <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
          <button className={lang === 'bn' ? 'active' : ''} onClick={() => setLang('bn')}>বাংলা</button>
        </div>
      </header>

      {error && <div className="msg err">{error}</div>}
      {notice && <div className="msg bad">{notice}</div>}

      <div className="cols">
        <section
          className={'card drop' + (dragJson ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setDragJson(true); }}
          onDragLeave={() => setDragJson(false)}
          onDrop={(e) => { e.preventDefault(); setDragJson(false); if (e.dataTransfer.files[0]) loadJsonBlob(e.dataTransfer.files[0]); }}
        >
          <h2>{t.loadJson}</h2>
          <p className="help">{t.loadJsonHelp} {t.dropJson}</p>
          <button className="btn" onClick={() => jsonRef.current.click()}>{t.chooseJson}</button>
          <button className="btn secondary" onClick={onTryDemo}>{t.tryDemo}</button>
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
          <h2>{t.upload}</h2>
          <p className="help">{t.uploadHelp} ({files.length}/30, {formatBytes(totalBytes)}/50 MB) {t.dropPdfs}</p>
          <button className="btn" disabled={!tender} onClick={() => pdfRef.current.click()}>{t.choosePdfs}</button>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onPdfFiles} />
          {!tender && <p className="note">{t.loadJson}</p>}
          {tender && files.length === 0 && <p className="note">{t.noFiles}</p>}
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
                  <button className="linkbtn" onClick={() => removeFile(f.id)}>{t.remove}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>


      {tender && (
        <section className="card">
          <h2>{t.match}</h2>
          <p className="help">{t.matchHelp}</p>
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
                    <button className="linkbtn" onClick={() => clearMatch(req.id)}>{t.clear}</button>
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
          <h2>{t.status}</h2>
          <div className="summary">
            <span><b className="ok">{summary.okCount}</b> {t.ready}</span>
            <span><b className="bad">{summary.blockingCount}</b> {t.blocking}</span>
          </div>
          {summary.canDownload && <div className="msg good">{t.okMsg}</div>}
          {!summary.canDownload && <div className="msg bad">{t.blockedMsg}</div>}
          <button className="btn big" disabled={!summary.canDownload || building} onClick={onDownload}>
            {building ? t.building : t.download}
          </button>
          <p className="note">{t.coverNote}</p>
          <p className="note">{t.fileName}: <b>{buildFilename(tender.tender_id)}</b></p>
          {unmatched.length > 0 && (
            <p className="unmatched">{t.unmatched}: {unmatched.map((f) => f.name).join(', ')}</p>
          )}
        </section>
      )}

      <footer>100% in-browser — files never leave this computer. / ১০০% ব্রাউজারেই — ফাইল এই কম্পিউটার ছাড়ে না।</footer>
    </div>
  );
}

