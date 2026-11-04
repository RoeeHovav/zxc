import React, { useEffect, useRef, useState } from "react";
import { api, DocInfo } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";
import SettingsDialog from "./SettingsDialog";

function fmtSize(b: number) {
  if (b > 1 << 20) return (b / (1 << 20)).toFixed(1) + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}

function fmtDate(ts: number | null | undefined, lang: string) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(lang === "he" ? "he-IL" : undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Library() {
  const { t, lang, toast } = useStore();
  const [docs, setDocs] = useState<DocInfo[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [combine, setCombine] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api.documents().then((r) => setDocs(r.documents));
    api.history().then((r) => setHistory(r.history.slice(0, 12)));
  };
  useEffect(refresh, []);

  const accept = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf");
    if (!pdfs.length) {
      toast("Please choose PDF files.", "error");
      return;
    }
    if (pdfs.length === 1) upload(pdfs, false);
    else {
      setPending(pdfs);
      setCombine(true);
    }
  };

  const upload = async (files: File[], comb: boolean) => {
    setBusy(0);
    try {
      const r = await api.upload(files, comb, (f) => setBusy(f));
      setPending([]);
      if (r.documents.length === 1) window.location.hash = `#/doc/${r.documents[0].id}`;
      else refresh();
    } catch (e: any) {
      toast(e?.message || String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const del = async (d: DocInfo) => {
    if (!confirm(t.confirmDelete)) return;
    await api.deleteDocument(d.id);
    refresh();
  };

  const move = (i: number, dir: number) => {
    const p = [...pending];
    const j = i + dir;
    if (j < 0 || j >= p.length) return;
    [p[i], p[j]] = [p[j], p[i]];
    setPending(p);
  };

  return (
    <div className="library">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h1 style={{ flex: 1 }}>
          <Icon name="doc" size={26} /> {t.appName}
        </h1>
        <button className="icon-btn" title={t.settings} aria-label={t.settings} onClick={() => setShowSettings(true)}>
          <Icon name="settings" />
        </button>
        <button
          className="btn"
          title="Stop the narrator service and close"
          onClick={async () => {
            await fetch("/api/shutdown", { method: "POST" }).catch(() => undefined);
            document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">PDF Narrator has stopped. You can close this window.</div>';
            window.close();
          }}
        >
          {lang === "he" ? "יציאה" : "Quit"}
        </button>
      </div>
      <div
        className={`dropzone${drag ? " drag" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          accept(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        data-testid="dropzone"
      >
        <Icon name="upload" size={30} />
        <div className="big">{busy != null ? `${t.uploading} ${Math.round(busy * 100)}%` : t.dropHere}</div>
        <div className="muted small">{t.dropHint}</div>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            if (e.target.files) accept(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {pending.length > 1 && (
        <div className="pending-files">
          <strong>{pending.length} PDF</strong>
          <ol>
            {pending.map((f, i) => (
              <li key={i}>
                {f.name} <span className="muted small">({fmtSize(f.size)})</span>
                {combine && (
                  <>
                    <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => move(i, -1)} aria-label="up">
                      ▲
                    </button>
                    <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => move(i, 1)} aria-label="down">
                      ▼
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          <label className="check">
            <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} /> {t.combine}
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={busy != null} onClick={() => upload(pending, combine)}>
              <Icon name="upload" size={16} /> {t.openPdf}
            </button>
            <button className="btn" onClick={() => setPending([])}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      <h3>{t.recent}</h3>
      {docs && !docs.length && <p className="muted">{t.noDocs}</p>}
      <div className="doc-list">
        {docs?.map((d) => (
          <div key={d.id} className="doc-card" onClick={() => (window.location.hash = `#/doc/${d.id}`)} data-testid="doc-card">
            <Icon name="doc" size={28} />
            <div className="grow">
              <div className="title">{d.title || t.untitled}</div>
              <div className="muted small">
                {d.pages} {t.pages} · {fmtSize(d.size)} · {fmtDate(d.opened_at || d.added_at, lang)}
                {d.last_page != null && (
                  <>
                    {" "}
                    · {t.page} {d.last_page + 1}
                  </>
                )}
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round((d.progress || 0) * 100)}%` }} />
              </div>
            </div>
            <button
              className="icon-btn"
              title={t.delete}
              aria-label={t.delete}
              onClick={(e) => {
                e.stopPropagation();
                del(d);
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <>
          <h3 style={{ marginTop: 30 }}>{t.history}</h3>
          <div className="muted small" style={{ display: "grid", gap: 4 }}>
            {history.map((h) => (
              <div key={h.id}>
                {fmtDate(h.at, lang)} — {h.title} — {h.event}
                {h.page != null ? ` (${t.page} ${h.page + 1})` : ""}
              </div>
            ))}
          </div>
        </>
      )}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  );
}
