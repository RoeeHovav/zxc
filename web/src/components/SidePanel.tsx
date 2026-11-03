import React, { useEffect, useMemo, useState } from "react";
import { api, Bookmark, LexiconEntry, OutlineEntry } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";

export type Tab = "outline" | "bookmarks" | "search" | "pron";

interface Props {
  docId: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  currentPage: number;
  onGo: (page: number, y?: number | null, unitId?: string, word?: number) => void;
  onPlayUnit: (unitId: string) => void;
  bookmarks: Bookmark[];
  setBookmarks: (b: Bookmark[]) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: { page: number; w0: number; w1: number; snippet: string }[] | null;
  searchInfo: string;
  onSearch: (q: string) => void;
  onSearchPick: (i: number) => void;
  lexVersion: number;
  onLexChanged: () => void;
}

export default function SidePanel(p: Props) {
  const { t, lang } = useStore();
  const [outline, setOutline] = useState<{ pdf: OutlineEntry[]; detected: OutlineEntry[]; complete: boolean } | null>(null);

  useEffect(() => {
    if (p.tab !== "outline") return;
    let stop = false;
    const load = () =>
      api.outline(p.docId).then((o) => {
        if (stop) return;
        setOutline(o);
        if (!o.complete && !o.pdf.length) setTimeout(load, 2500);
      });
    load();
    return () => {
      stop = true;
    };
  }, [p.tab, p.docId]);

  const entries = outline ? (outline.pdf.length ? outline.pdf : outline.detected) : [];
  const currentIdx = useMemo(() => {
    let idx = -1;
    entries.forEach((e, i) => {
      if (e.page <= p.currentPage) idx = i;
    });
    return idx;
  }, [entries, p.currentPage]);

  return (
    <aside className="side" data-testid="side-panel">
      <div className="tabs" role="tablist">
        {(
          [
            ["outline", t.outline],
            ["bookmarks", t.bookmarks],
            ["search", t.search],
            ["pron", t.pronunciation],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={p.tab === k} className={p.tab === k ? "on" : ""} onClick={() => p.setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="body">
        {p.tab === "outline" && (
          <>
            {!outline && <div className="muted">…</div>}
            {outline && !entries.length && <div className="muted small">{outline.complete ? "—" : `${t.processing}…`}</div>}
            {entries.map((e, i) => (
              <button
                key={i}
                className={`outline-item${i === currentIdx ? " current" : ""}`}
                style={{ paddingInlineStart: 8 + Math.max(0, e.level - 1) * 14, fontWeight: e.level <= 1 ? 600 : 400 }}
                onClick={() => p.onGo(e.page, e.y, e.unit_id)}
                onDoubleClick={() => e.unit_id && p.onPlayUnit(e.unit_id)}
                title={e.unit_id ? "Double-click to start reading here" : undefined}
                dir="auto"
              >
                {e.title}
                <span className="pg">{e.page + 1}</span>
              </button>
            ))}
            {outline && !outline.complete && entries.length > 0 && <div className="muted small" style={{ padding: 8 }}>{t.processing}…</div>}
          </>
        )}

        {p.tab === "bookmarks" && <Bookmarks {...p} />}

        {p.tab === "search" && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                p.onSearch(p.searchQuery);
              }}
              style={{ display: "flex", gap: 6, marginBottom: 8 }}
            >
              <input autoFocus value={p.searchQuery} onChange={(e) => p.setSearchQuery(e.target.value)} placeholder={t.searchPlaceholder} style={{ flex: 1 }} dir="auto" data-testid="search-input" />
              <button className="btn" type="submit">
                <Icon name="search" size={16} />
              </button>
            </form>
            {p.searchInfo && <div className="muted small" style={{ marginBottom: 6 }}>{p.searchInfo}</div>}
            {p.searchResults && !p.searchResults.length && <div className="muted">{t.noResults}</div>}
            {p.searchResults?.map((r, i) => (
              <div key={i} className="result" onClick={() => p.onSearchPick(i)} dir="auto" data-testid="search-result">
                <div className="muted small">
                  {t.page} {r.page + 1}
                </div>
                <div>{r.snippet}</div>
              </div>
            ))}
          </>
        )}

        {p.tab === "pron" && <Pronunciations docId={p.docId} version={p.lexVersion} onChanged={p.onLexChanged} />}
      </div>
    </aside>
  );
}

function Bookmarks(p: Props) {
  const { t, lang } = useStore();
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  return (
    <>
      {!p.bookmarks.length && <div className="muted small">{t.noBookmarks}</div>}
      {p.bookmarks.map((b) => (
        <div key={b.id} className="result" onClick={() => p.onGo(b.page, null, b.unit_id || undefined, b.word)}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="bookmark" size={14} />
            <span className="muted small" style={{ flex: 1 }}>
              {t.page} {b.page + 1}
            </span>
            <button
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              title="Edit note"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(b.id);
                setNote(b.note || "");
              }}
            >
              ✎
            </button>
            <button
              className="icon-btn"
              style={{ width: 26, height: 26 }}
              title={t.delete}
              onClick={async (e) => {
                e.stopPropagation();
                const r = await api.deleteBookmark(p.docId, b.id);
                p.setBookmarks(r.bookmarks);
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          <div dir="auto">{b.label}</div>
          {editing === b.id ? (
            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6, display: "grid", gap: 6 }}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} dir="auto" />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn primary"
                  onClick={async () => {
                    const r = await api.updateBookmark(p.docId, b.id, { label: b.label, note });
                    p.setBookmarks(r.bookmarks);
                    setEditing(null);
                  }}
                >
                  {t.save}
                </button>
                <button className="btn" onClick={() => setEditing(null)}>
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            b.note && (
              <div className="muted small" dir="auto" style={{ whiteSpace: "pre-wrap" }}>
                {b.note}
              </div>
            )
          )}
        </div>
      ))}
    </>
  );
}

function Pronunciations({ docId, version, onChanged }: { docId: string; version: number; onChanged: () => void }) {
  const { t } = useStore();
  const [entries, setEntries] = useState<LexiconEntry[]>([]);
  const [builtin, setBuiltin] = useState<any[]>([]);
  const [showBuiltin, setShowBuiltin] = useState(false);
  const [w, setW] = useState("");
  const [s, setS] = useState("");
  const [scope, setScope] = useState<"document" | "global">("document");
  const load = () =>
    api.lexicon(docId).then((r) => {
      setEntries(r.entries);
      setBuiltin(r.builtin);
    });
  useEffect(() => {
    load();
  }, [docId, version]);
  const add = async () => {
    if (!w.trim() || !s.trim()) return;
    const lang = /[֐-׿]/.test(w) ? "he" : "en";
    await api.addLexicon({ written: w, spoken: s, scope, doc_id: scope === "document" ? docId : null, lang });
    setW("");
    setS("");
    load();
    onChanged();
  };
  return (
    <div>
      <p className="muted small">
        Words or phrases here are spoken the way you write them in “says”. Use niqqud (e.g. סַפָּר) or a phonetic respelling. Multi-word phrases act as context rules (e.g. “ספר תורה” → “סֵפֶר תּוֹרָה”).
      </p>
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        <input value={w} onChange={(e) => setW(e.target.value)} placeholder="Written (as in the PDF)" dir="auto" />
        <input value={s} onChange={(e) => setS(e.target.value)} placeholder="Says" dir="auto" />
        <select value={scope} onChange={(e) => setScope(e.target.value as any)}>
          <option value="document">This document only</option>
          <option value="global">All documents</option>
        </select>
        <button className="btn primary" onClick={add}>
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
      <table className="lex">
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ opacity: e.enabled ? 1 : 0.5 }}>
              <td dir="auto">{e.written}</td>
              <td dir="auto">{e.spoken}</td>
              <td className="muted small">{e.scope === "global" ? "all" : "doc"}</td>
              <td>
                <button
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  title={t.delete}
                  onClick={async () => {
                    await api.deleteLexicon(e.id);
                    load();
                    onChanged();
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => setShowBuiltin(!showBuiltin)}>
        Built-in dictionary ({builtin.length})
      </button>
      {showBuiltin && (
        <table className="lex" style={{ marginTop: 8 }}>
          <tbody>
            {builtin.map((e, i) => (
              <tr key={i}>
                <td dir="auto">{e.written}</td>
                <td dir="auto">{e.spoken}</td>
                <td className="muted small">{e.context !== "any" ? e.context.replace(/_/g, " ") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
