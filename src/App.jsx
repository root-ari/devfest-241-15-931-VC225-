import { useMemo, useRef, useState } from 'react';
import {
  parseRequirementsJson, checkUploadLimits, formatBytes,
  getPackageSummary, buildFilename, getDisplayTitle, suggestMatch,
} from './logic.js';
import { STR } from './i18n.js';
import { validatePdf, buildPackagePdf, downloadBytes } from './pdf.js';

let fileSeq = 0;

export default function App() {
  const [lang, setLang] = useState('en');
  const [tender, setTender] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [files, setFiles] = useState([]); // {id,name,size,bytes,pages}
  const [matches, setMatches] = useState({}); // reqId -> {fileId, expiry}
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
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

  function resetForTender(parsed) {
    setTender(parsed.tender);
    setRequirements(parsed.requirements);
    setFiles([]);
    setMatches({});
    setError('');
  }

  async function onJsonFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      resetForTender(parseRequirementsJson(await f.text()));
    } catch (err) {
      setError(t.errors[err.message] || err.message);
    }
  }

  async function onTryDemo() {
    setError('');
    try {
      const res = await fetch('sample-requirements.json');
      resetForTender(parseRequirementsJson(await res.text()));
    } catch (err) {
      setError(t.errors[err.message] || String(err.message || err));
    }
  }

  async function onPdfFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const check = checkUploadLimits(files.length, totalBytes, picked);
    if (!check.ok) {
      setError(check.reason === 'NOT_PDF' ? `${t.errors.NOT_PDF} (${check.fileName})` : (t.errors[check.reason] || check.reason));
      return;
    }
    setError('');
    const added = [];
    for (const f of picked) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const pages = await validatePdf(buf.slice());
        added.push({ id: 'F' + (++fileSeq), name: f.name, size: f.size, bytes: buf, pages });
      } catch {
        setError(`${t.errors.BAD_PDF} (${f.name})`);
      }
    }
    if (!added.length) return;
    // Auto-suggest a requirement for each new file when it is still free.
    setFiles((prev) => [...prev, ...added]);
    setMatches((prev) => {
      const next = { ...prev };
      for (const a of added) {
        const sug = suggestMatch(a.name, requirements);
        if (sug && !(next[sug] && next[sug].fileId)) {
          next[sug] = { fileId: a.id, expiry: '' };
        }
      }
      return next;
    });
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
    setMatches((prev) => {
      const next = { ...prev };
      for (const [k, m] of Object.entries(next)) {
        if (k !== reqId && m && m.fileId === fileId) next[k] = { fileId: '', expiry: m.expiry || '' };
      }
      next[reqId] = { fileId: fileId || '', expiry: (next[reqId] && next[reqId].expiry) || '' };
      return next;
    });
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

      <div className="steps">
        <span className={tender ? 'done' : ''}>{t.step1}</span>
        <span className={files.length ? 'done' : ''}>{t.step2}</span>
        <span className={summary && summary.okCount ? 'done' : ''}>{t.step3}</span>
        <span className={summary && summary.canDownload ? 'done' : ''}>{t.step4}</span>
      </div>

      {error && <div className="msg err">{error}</div>}

      <section className="card">
        <h2>{t.loadJson}</h2>
        <p className="help">{t.loadJsonHelp}</p>
        <button className="btn" onClick={() => jsonRef.current.click()}>{t.chooseJson}</button>
        <button className="btn secondary" onClick={onTryDemo}>{t.tryDemo}</button>
        <input ref={jsonRef} type="file" accept="application/json,.json" hidden onChange={onJsonFile} />
        {tender && (
          <div className="tenderbox">
            <div><b>{t.tender}:</b> {tender.title} ({tender.tender_id})</div>
            <div><b>{t.entity}:</b> {tender.procuring_entity}</div>
            <div><b>{t.bidder}:</b> {tender.bidder}</div>
            <div><b>{t.deadline}:</b> {tender.submission_deadline}</div>
          </div>
        )}
      </section>

      {tender && (
        <section className="card">
          <h2>{t.upload}</h2>
          <p className="help">{t.uploadHelp} ({files.length}/30, {formatBytes(totalBytes)}/50 MB)</p>
          <button className="btn" onClick={() => pdfRef.current.click()}>{t.choosePdfs}</button>
          <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={onPdfFiles} />
          {files.length === 0 && <p className="note">{t.noFiles}</p>}
          {files.length > 0 && (
            <ul className="filelist">
              {files.map((f) => (
                <li key={f.id}>
                  <span>{f.name} — {formatBytes(f.size)}, {f.pages} {t.pages}</span>
                  <button className="linkbtn" onClick={() => removeFile(f.id)}>{t.remove}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tender && (
        <section className="card">
          <h2>{t.match}</h2>
          <p className="help">{t.matchHelp}</p>
          {requirements.map((req) => {
            const m = matches[req.id] || { fileId: '', expiry: '' };
            const st = summary.items.find((i) => i.req.id === req.id).status;
            return (
              <div className="req" key={req.id}>
                <div className="row1">
                  <span className="title">{req.order}. {getDisplayTitle(req, lang)}</span>
                  <span className={'badge ' + (req.mandatory ? 'mand' : 'opt')}>{req.id}</span>
                </div>
                <div className="row2">
                  <select value={m.fileId} onChange={(e) => pickFile(req.id, e.target.value)}>
                    <option value="">{t.pickFile}</option>
                    {files.map((f) => (
                      <option key={f.id} value={f.id} disabled={usedFileIds.has(f.id) && m.fileId !== f.id}>
                        {f.name}{usedFileIds.has(f.id) && m.fileId !== f.id ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                  {req.has_expiry && m.fileId !== '' && (
                    <label>{t.expiry}: <input type="date" value={m.expiry} onChange={(e) => setMatch(req.id, { expiry: e.target.value })} /></label>
                  )}
                </div>
                <div className={'chip ' + st}>{t.statuses[st]}</div>
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

