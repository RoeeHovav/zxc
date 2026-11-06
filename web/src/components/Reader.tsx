import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Bookmark, DocInfo, PageLayout, Position, PrepStatus, Unit } from "../api";
import { NarrPos, Narrator, Status } from "../player/Narrator";
import { useStore } from "../store";
import { Icon } from "./Icons";
import PlayerBar from "./PlayerBar";
import SettingsDialog from "./SettingsDialog";
import SidePanel, { Tab } from "./SidePanel";
import Viewer, { orderSel, PageHighlight, Ref2, Selection, ViewerHandle } from "./Viewer";
import { ConsentDialog, PageRangeDialog, PronounceDialog, ShortcutsDialog, VoiceLab } from "./Dialogs";
import { TeacherPanel, useTeacher } from "./Teacher";

interface Menu {
  x: number;
  y: number;
  ref: Ref2;
}

export default function Reader({ docId }: { docId: string }) {
  const { t, settings, update, toast, lang } = useStore();
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [prep, setPrep] = useState<PrepStatus | null>(null);
  const narrator = useMemo(() => new Narrator(docId, 1), [docId]);
  const viewer = useRef<ViewerHandle>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [pos, setPos] = useState<NarrPos | null>(null);
  const [, setTick] = useState(0);
  const [rate, setRateState] = useState(settings?.speed || 1);
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(settings?.zoom || 1.25);
  const [sideOpen, setSideOpen] = useState(window.innerWidth > 900);
  const [tab, setTab] = useState<Tab>("outline");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selBar, setSelBar] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<null | "settings" | "lab" | "range" | "keys">(null);
  const [pron, setPron] = useState<{ page: number; word: number; text: string; lang: string } | null>(null);
  const [consent, setConsent] = useState<{ info: any; resolve: (ok: boolean) => void } | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ page: number; w0: number; w1: number; snippet: string }[] | null>(null);
  const [searchInfo, setSearchInfo] = useState("");
  const [activeHit, setActiveHit] = useState(-1);
  const [followPaused, setFollowPaused] = useState(false);
  const [resumePos, setResumePos] = useState<Position | null>(null);
  const [progress, setProgress] = useState<{ processed: number; pages: number } | null>(null);
  const [lexVersion, setLexVersion] = useState(0);
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  const teacher = useTeacher(docId);
  const followRef = useRef(followPaused);
  followRef.current = followPaused;

  // ------------------------------------------------------------- loading
  useEffect(() => {
    let cancelled = false;
    api
      .document(docId)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        narrator.pages = d.pages;
        narrator.setMediaTitle(d.title);
        document.title = `${d.title} — ${t.appName}`;
        if (d.doc_settings?.zoom) setZoom(d.doc_settings.zoom);
        if (d.position?.unit_id) {
          setResumePos(d.position);
          setTimeout(() => viewer.current?.scrollToPage(d.position!.page), 50);
        }
      })
      .catch((e) => setLoadErr(e.message));
    api.bookmarks(docId).then((r) => setBookmarks(r.bookmarks));
    return () => {
      cancelled = true;
      narrator.saveBeacon();
      narrator.destroy();
      document.title = t.appName;
    };
  }, [docId]);

  useEffect(() => {
    if (!doc) return;
    let stop = false;
    const poll = () =>
      api
        .progress(docId)
        .then((p) => {
          if (stop) return;
          setProgress(p);
          if (p.processed < p.pages) setTimeout(poll, 1500);
        })
        .catch(() => undefined);
    poll();
    return () => {
      stop = true;
    };
  }, [doc?.id]);

  // narrator <-> react
  useEffect(() => {
    (window as any).__narrator = narrator; // diagnostics / automated tests
    const onStatus = () => setStatus(narrator.status);
    const onPos = (e: Event) => {
      const p = (e as CustomEvent).detail as NarrPos;
      setPos({ ...p });
      if (useStore.getState().settings?.auto_scroll && !followRef.current) {
        viewer.current?.layout(p.page).then(() => viewer.current?.scrollToWord(p.page, p.pageWord));
      }
    };
    const onTime = (e: Event) => setTick((x) => (x + 1) % 1e6);
    const onSleep = () => toast("Sleep timer: playback paused");
    const onSleepChange = (e: Event) => setSleepUntil((e as CustomEvent).detail);
    narrator.addEventListener("status", onStatus);
    narrator.addEventListener("position", onPos);
    narrator.addEventListener("time", onTime);
    narrator.addEventListener("sleep", onSleep);
    narrator.addEventListener("sleepchange", onSleepChange);
    const onPrep = (e: Event) => setPrep((e as CustomEvent).detail);
    narrator.addEventListener("prep", onPrep);
    narrator.noticeHandler = (m) => toast(m);
    narrator.consentHandler = (info) => new Promise<boolean>((resolve) => setConsent({ info, resolve }));
    const unload = () => narrator.saveBeacon();
    window.addEventListener("beforeunload", unload);
    return () => {
      narrator.removeEventListener("status", onStatus);
      narrator.removeEventListener("position", onPos);
      narrator.removeEventListener("time", onTime);
      narrator.removeEventListener("sleep", onSleep);
      narrator.removeEventListener("sleepchange", onSleepChange);
      narrator.removeEventListener("prep", onPrep);
      window.removeEventListener("beforeunload", unload);
    };
  }, [narrator]);

  useEffect(() => {
    if (!settings) return;
    narrator.pauseScale = settings.pause_scale;
    narrator.readKinds = settings.read_kinds;
    narrator.bufferPercent = settings.buffer_percent ?? 0;
    narrator.teacherMode = !!settings.teacher_mode && !!settings.llm_model;
  }, [settings?.buffer_percent, settings?.pause_scale, settings?.read_kinds, settings?.teacher_mode, settings?.llm_model]);

  useEffect(() => {
    narrator.teacherHandler = (unit) => teacher.explain(unit.id, "section", true);
  }, [narrator, teacher.explain]);

  useEffect(() => {
    narrator.setRate(rate);
  }, [rate]);

  useEffect(() => {
    setPageInput(String(page + 1));
  }, [page]);

  // ------------------------------------------------------------- actions
  const setRate = (r: number) => {
    const v = Math.round(Math.min(3, Math.max(0.5, r)) * 100) / 100;
    setRateState(v);
    update({ speed: v }).catch(() => undefined);
  };

  const changeZoom = (z: number) => {
    const v = Math.round(Math.min(4, Math.max(0.5, z)) * 100) / 100;
    setZoom(v);
    api.patchDocument(docId, { doc_settings: { zoom: v } }).catch(() => undefined);
  };

  const resolveWord = async (ref: Ref2): Promise<{ unit: Unit; word: number } | null> => {
    try {
      const r = await api.unitAt(docId, ref[0], ref[1]);
      narrator.rememberUnit(r.unit);
      return r;
    } catch {
      toast("This text is not part of the narration (e.g. a header or figure label).", "error");
      return null;
    }
  };

  const startAt = async (ref: Ref2, mode: "sentence" | "word" | "paragraph" | "only-sentence") => {
    setResumePos(null);
    setFollowPaused(false);
    const r = await resolveWord(ref);
    if (!r) return;
    const u = r.unit;
    const si = narrator.sentenceOf(u, r.word);
    if (mode === "sentence") return narrator.playFrom(u, u.sentences[si]?.[0] ?? r.word);
    if (mode === "word") return narrator.playFrom(u, r.word);
    if (mode === "paragraph") {
      const last = u.words[u.words.length - 1];
      return narrator.playFrom(u, 0, { stopAt: { page: last[0], word: last[1] } });
    }
    const [a, b] = u.sentences[si] || [0, u.words.length];
    const last = u.words[b - 1];
    return narrator.playFrom(u, a, { stopAt: { page: last[0], word: last[1] } });
  };

  const readSelection = async () => {
    if (!selection) return;
    const [s, e] = orderSel(selection);
    setSelBar(null);
    const r = await resolveWord(s);
    if (!r) return;
    setResumePos(null);
    narrator.playFrom(r.unit, r.word, { stopAt: { page: e[0], word: e[1] } });
  };

  const readPages = async (from: number, to: number) => {
    setDialog(null);
    const r = await api.units(docId, from, 40);
    const u = r.units.find((x) => settings?.read_kinds[x.kind] !== false && x.chunks.length);
    if (!u) return toast("Nothing to read on these pages.", "error");
    narrator.rememberUnit(u);
    setResumePos(null);
    narrator.playFrom(u, 0, { stopAt: { page: to, word: 1e9 } });
    viewer.current?.scrollToPage(from);
  };

  const playFromCurrentPage = async () => {
    const r = await api.units(docId, page, 40);
    const u = r.units.find((x) => settings?.read_kinds[x.kind] !== false && x.chunks.length);
    if (!u) return toast("Nothing to read here yet.", "error");
    narrator.rememberUnit(u);
    narrator.playFrom(u, 0);
  };

  /** Narrate the whole document from here in the background (patient = keep a limited premium voice). */
  const prepareAll = async () => {
    let u: Unit | undefined = pos?.unit;
    if (!u) {
      const r = await api.units(docId, page, 40);
      u = r.units.find((x) => settings?.read_kinds[x.kind] !== false && x.chunks.length);
    }
    if (!u) return toast("Nothing to read here yet.", "error");
    const premium = Object.values(settings?.voices || {}).some((v) => v.startsWith("gemini:"));
    try {
      await narrator.prepareFrom(u.id, premium);
    } catch (e: any) {
      toast(e?.message || String(e), "error");
    }
  };

  const onPlay = () => {
    if (status === "playing" || status === "loading") {
      teacher.stopAudio();
      return narrator.pause();
    }
    if (narrator.pos || status === "error") return narrator.resume();
    if (resumePos?.unit_id) {
      const p = resumePos;
      setResumePos(null);
      return narrator.playFrom(p.unit_id!, p.word);
    }
    playFromCurrentPage();
  };

  const selectedText = async (): Promise<string> => {
    if (!selection) return "";
    const [s, e] = orderSel(selection);
    const parts: string[] = [];
    for (let p = s[0]; p <= e[0]; p++) {
      const l: PageLayout = await viewer.current!.layout(p);
      const a = p === s[0] ? s[1] : 0;
      const b = p === e[0] ? e[1] : l.words.length - 1;
      parts.push(l.words.slice(a, b + 1).map((w) => w[0]).join(" "));
    }
    return parts.join("\n");
  };

  const addBookmark = async (ref?: Ref2) => {
    let pageN = page,
      word = 0,
      unitId: string | null = null,
      label = "";
    if (ref) {
      pageN = ref[0];
      word = ref[1];
      const l = viewer.current?.cachedLayout(ref[0]);
      label = l ? l.words.slice(ref[1], ref[1] + 12).map((w) => w[0]).join(" ") : "";
      const ui = l?.word_unit[ref[1]] ?? -1;
      unitId = ui >= 0 ? l!.units[ui] : null;
      word = ui >= 0 ? l!.word_pos[ref[1]] : 0;
    } else if (pos) {
      pageN = pos.page;
      word = pos.word;
      unitId = pos.unit.id;
      const [a, b] = pos.unit.sentences[pos.sentence] || [0, 12];
      label = pos.unit.text.split(" ").slice(a, Math.min(b, a + 14)).join(" ");
    } else {
      const l = viewer.current?.cachedLayout(page);
      label = l ? l.words.slice(0, 12).map((w) => w[0]).join(" ") : `${t.page} ${page + 1}`;
    }
    const r = await api.addBookmark(docId, { page: pageN, word, unit_id: unitId, label });
    setBookmarks(r.bookmarks);
    toast(`${t.addBookmark} ✓`);
  };

  const goTo = async (p: number, y?: number | null, unitId?: string, word?: number) => {
    viewer.current?.scrollToPage(p, y ?? undefined);
    if (unitId && word != null && status !== "playing") {
      setResumePos({ unit_id: unitId, word, page: p, chunk: 0, offset: 0, progress: 0 });
    }
  };

  const doSearch = async (q: string) => {
    if (!q.trim()) return;
    const r = await api.search(docId, q);
    setResults(r.results);
    setSearchInfo(r.indexed < r.pages ? `${r.indexed}/${r.pages} ${t.pages} ${t.indexed}` : `${r.results.length}`);
    if (r.results.length) pickHit(0, r.results);
  };

  const pickHit = (i: number, list = results) => {
    if (!list || !list[i]) return;
    setActiveHit(i);
    const h = list[i];
    viewer.current?.layout(h.page).then(() => viewer.current?.scrollToWord(h.page, h.w0, true));
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || dialog || pron || consent) return;
      const skip = settings?.skip_seconds || 10;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === " " && !ctrl) {
        e.preventDefault();
        onPlay();
      } else if (e.key === "ArrowLeft" && !ctrl) {
        e.preventDefault();
        e.shiftKey ? narrator.sentence(-1) : narrator.seekBy(-skip);
      } else if (e.key === "ArrowRight" && !ctrl) {
        e.preventDefault();
        e.shiftKey ? narrator.sentence(1) : narrator.seekBy(skip);
      } else if (e.key === "[") narrator.paragraph(-1);
      else if (e.key === "]") narrator.paragraph(1);
      else if (e.key === "r" || e.key === "R") !ctrl && narrator.repeatSentence();
      else if (e.key === ",") setRate(rate - 0.05);
      else if (e.key === ".") setRate(rate + 0.05);
      else if (e.key === "Escape") {
        if (menu || selBar) {
          setMenu(null);
          setSelBar(null);
          setSelection(null);
        } else narrator.stop();
      } else if (ctrl && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSideOpen(true);
        setTab("search");
      } else if (ctrl && e.key.toLowerCase() === "b") {
        e.preventDefault();
        addBookmark();
      } else if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        changeZoom(zoom + 0.1);
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        changeZoom(zoom - 0.1);
      } else if (e.key === "PageDown") {
        e.preventDefault();
        viewer.current?.scrollToPage(Math.min((doc?.pages || 1) - 1, page + 1));
      } else if (e.key === "PageUp") {
        e.preventDefault();
        viewer.current?.scrollToPage(Math.max(0, page - 1));
      } else if (e.key === "Home" && ctrl) viewer.current?.scrollToPage(0);
      else if (e.key === "End" && ctrl) viewer.current?.scrollToPage((doc?.pages || 1) - 1);
      else if (e.key === "a" || e.key === "A") update({ auto_scroll: !settings?.auto_scroll });
      else if (e.key === "?") setDialog("keys");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------- highlights
  const highlights = useMemo(() => {
    const m = new Map<number, PageHighlight>();
    const get = (p: number) => {
      let h = m.get(p);
      if (!h) m.set(p, (h = {}));
      return h;
    };
    if (pos && status !== "idle") {
      const [a, b] = pos.unit.sentences[pos.sentence] || [0, pos.unit.words.length];
      for (let w = a; w < b; w++) {
        const ref = pos.unit.words[w];
        if (ref) (get(ref[0]).sentence ||= []).push(ref[1]);
      }
      if (settings?.highlight !== "sentence" && pos.timing === "word") get(pos.page).word = pos.pageWord;
    }
    if (selection) {
      const [s, e] = orderSel(selection);
      for (let p = s[0]; p <= e[0] && p - s[0] < 30; p++) {
        const n = viewer.current?.cachedLayout(p)?.words.length ?? 0;
        get(p).select = [p === s[0] ? s[1] : 0, p === e[0] ? e[1] : Math.max(0, n - 1)];
      }
    }
    if (results) {
      results.forEach((r, i) => {
        if (Math.abs(r.page - page) <= 3 || i === activeHit) (get(r.page).search ||= []).push([r.w0, r.w1]);
      });
    }
    return m;
  }, [pos?.unit.id, pos?.word, pos?.sentence, status, selection, results, activeHit, page, settings?.highlight]);

  const onPageChange = useCallback((p: number) => setPage(p), []);
  const onUserScroll = useCallback(() => {
    if (narrator.status === "playing") setFollowPaused(true);
  }, [narrator]);

  // -------------------------------------------------------------- render
  if (loadErr)
    return (
      <div style={{ padding: 40 }}>
        <p>{loadErr}</p>
        <a href="#/">{t.library}</a>
      </div>
    );
  if (!doc || !doc.page_sizes) return <div style={{ padding: 40 }} className="muted">…</div>;

  const voiceLabel = (() => {
    const lg = pos?.unit ? (pos.unit.chunks[pos.chunk]?.lang ?? pos.unit.lang) : doc.rtl ? "he" : "en";
    const v = settings?.voices[lg] || "";
    return v.split(":").pop()?.replace(/Neural$/, "").replace(/^[a-z]{2}-[A-Z]{2}-/, "") || lg;
  })();

  return (
    <div className="reader">
      <div className="topbar">
        <a className="icon-btn" href="#/" title={t.library} aria-label={t.library}>
          <Icon name="home" />
        </a>
        <button className={`icon-btn${sideOpen ? " active" : ""}`} onClick={() => setSideOpen(!sideOpen)} title={t.outline} aria-label={t.outline}>
          <Icon name="list" />
        </button>
        <div className="doc-title" dir="auto" title={doc.title}>
          {doc.title}
        </div>
        {progress && progress.processed < progress.pages && (
          <span className="pill" title={t.processing} data-testid="processing">
            <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> {t.processing} {progress.processed}/{progress.pages}
          </span>
        )}
        <div className="page-ind">
          {t.page}
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Math.min(doc.pages, Math.max(1, parseInt(pageInput) || 1));
                viewer.current?.scrollToPage(n - 1);
              }
            }}
            aria-label={t.page}
            data-testid="page-input"
          />
          {t.of} {doc.pages}
        </div>
        <div className="sep" />
        <button className="icon-btn" onClick={() => changeZoom(zoom - 0.1)} title={t.zoomOut} aria-label={t.zoomOut}>
          <Icon name="minus" />
        </button>
        <span className="small" style={{ minWidth: 40, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="icon-btn" onClick={() => changeZoom(zoom + 0.1)} title={t.zoomIn} aria-label={t.zoomIn}>
          <Icon name="plus" />
        </button>
        <div className="sep" />
        <button className={`icon-btn${settings?.auto_scroll ? " active" : ""}`} onClick={() => update({ auto_scroll: !settings?.auto_scroll })} title={`${t.autoScroll} (A)`} aria-label={t.autoScroll}>
          <Icon name="follow" />
        </button>
        <button className="icon-btn" onClick={() => addBookmark()} title={`${t.addBookmark} (Ctrl+B)`} aria-label={t.addBookmark}>
          <Icon name="bookmark" />
        </button>
        <button className="icon-btn" onClick={() => setDialog("range")} title={t.readPages} aria-label={t.readPages}>
          <Icon name="doc" />
        </button>
        <button className="icon-btn" onClick={() => setDialog("lab")} title={t.voiceLab} aria-label={t.voiceLab}>
          <Icon name="lab" />
        </button>
        <button className="icon-btn" onClick={() => setDialog("keys")} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          ⌨
        </button>
        <button className="icon-btn" onClick={() => setDialog("settings")} title={t.settings} aria-label={t.settings}>
          <Icon name="settings" />
        </button>
      </div>

      <div className="main">
        {sideOpen && (
          <SidePanel
            docId={docId}
            tab={tab}
            setTab={setTab}
            currentPage={page}
            onGo={goTo}
            onPlayUnit={(id) => {
              setResumePos(null);
              narrator.playFrom(id, 0);
            }}
            bookmarks={bookmarks}
            setBookmarks={setBookmarks}
            searchQuery={query}
            setSearchQuery={setQuery}
            searchResults={results}
            searchInfo={searchInfo}
            onSearch={doSearch}
            onSearchPick={(i) => pickHit(i)}
            lexVersion={lexVersion}
            onLexChanged={() => {
              narrator.invalidate();
              setLexVersion((v) => v + 1);
            }}
          />
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          {resumePos && status === "idle" && (
            <div className="banner" data-testid="resume-banner">
              <Icon name="clock" size={18} />
              <span style={{ flex: 1 }}>
                {t.resumeAt} {resumePos.page + 1}
              </span>
              <button
                className="btn primary"
                onClick={() => {
                  const p = resumePos;
                  setResumePos(null);
                  viewer.current?.scrollToPage(p.page);
                  narrator.playFrom(p.unit_id!, p.word);
                }}
                data-testid="resume"
              >
                <Icon name="play" size={14} /> {t.play}
              </button>
              <button className="icon-btn" onClick={() => setResumePos(null)} aria-label={t.close}>
                <Icon name="x" size={16} />
              </button>
            </div>
          )}
          <Viewer
            ref={viewer}
            docId={docId}
            sizes={doc.page_sizes}
            zoom={zoom}
            highlights={highlights}
            onPageChange={onPageChange}
            onUserScroll={onUserScroll}
            onSelectStart={(r) => {
              setMenu(null);
              setSelBar(null);
              setSelection({ anchor: r, focus: r });
            }}
            onSelectMove={(r) => setSelection((s) => (s ? { ...s, focus: r } : s))}
            onSelectEnd={(r, e) => {
              setSelection((s) => {
                if (!s) return s;
                const fin = r[0] >= 0 ? { ...s, focus: r } : s;
                const [a, b] = orderSel(fin);
                if (a[0] === b[0] && a[1] === b[1]) {
                  setSelBar(null);
                  return null;
                }
                setSelBar({ x: e.clientX, y: e.clientY });
                return fin;
              });
            }}
            onWordDouble={(r) => {
              setSelection(null);
              setSelBar(null);
              startAt(r, "sentence");
            }}
            onWordContext={(r, e) => {
              setSelBar(null);
              setMenu({ x: e.clientX, y: e.clientY, ref: r });
            }}
          />
          {followPaused && status === "playing" && (
            <button
              className="btn primary back-to"
              onClick={() => {
                setFollowPaused(false);
                if (pos) viewer.current?.layout(pos.page).then(() => viewer.current?.scrollToWord(pos.page, pos.pageWord, true));
              }}
            >
              <Icon name="follow" size={16} /> {t.backToNarration}
            </button>
          )}
        </div>
      </div>

      <PlayerBar
        narrator={narrator}
        status={status}
        error={narrator.error}
        pos={pos ? { ...pos, time: narrator.currentTime } : null}
        rate={rate}
        onRate={setRate}
        onPlay={onPlay}
        sleepUntil={sleepUntil}
        onSleep={(m) => narrator.setSleep(m)}
        voiceLabel={voiceLabel}
        prep={prep}
        onPrepareAll={prepareAll}
        onCancelPrep={() => narrator.cancelPrep()}
      />

      {selBar && selection && (
        <div className="sel-bar" style={{ left: Math.min(selBar.x, window.innerWidth - 360), top: Math.max(8, selBar.y - 54) }} data-testid="selection-bar">
          <button className="btn primary" onClick={readSelection} data-testid="read-selection">
            <Icon name="play" size={14} /> {t.readSelection}
          </button>
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard?.writeText(await selectedText());
              setSelBar(null);
              toast(`${t.copy} ✓`);
            }}
          >
            {t.copy}
          </button>
          {orderSel(selection)[0][0] === orderSel(selection)[1][0] && orderSel(selection)[1][1] - orderSel(selection)[0][1] <= 4 && (
            <button
              className="btn"
              onClick={async () => {
                const [s] = orderSel(selection);
                const text = await selectedText();
                const l = viewer.current?.cachedLayout(s[0]);
                const ui = l?.word_unit[s[1]] ?? -1;
                setPron({ page: s[0], word: s[1], text, lang: /[֐-׿]/.test(text) ? "he" : "en" });
                setSelBar(null);
              }}
            >
              {t.fixPronunciation}
            </button>
          )}
        </div>
      )}

      {menu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="menu" style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 260) }} data-testid="context-menu">
            <button onClick={() => (setMenu(null), startAt(menu.ref, "word"))}>
              <Icon name="play" size={16} /> {t.readFromHere}
            </button>
            <button onClick={() => (setMenu(null), startAt(menu.ref, "only-sentence"))}>
              <Icon name="speech" size={16} /> {t.readSentence}
            </button>
            <button onClick={() => (setMenu(null), startAt(menu.ref, "paragraph"))}>
              <Icon name="list" size={16} /> {t.readParagraph}
            </button>
            <button
              onClick={() => {
                const l = viewer.current?.cachedLayout(menu.ref[0]);
                const w = l?.words[menu.ref[1]]?.[0] || "";
                setPron({ page: menu.ref[0], word: menu.ref[1], text: w, lang: /[֐-׿]/.test(w) ? "he" : "en" });
                setMenu(null);
              }}
            >
              <Icon name="speech" size={16} /> {t.fixPronunciation}
            </button>
            <button
              onClick={async () => {
                setMenu(null);
                const r = await resolveWord(menu.ref);
                if (!r) return;
                if (status === "playing") narrator.pause();
                teacher.explain(r.unit.id, "paragraph", false);
              }}
            >
              <Icon name="lab" size={16} /> {lang === "he" ? "הסבר (בינה מלאכותית)" : "Explain (AI)"}
            </button>
            <button onClick={() => (setMenu(null), addBookmark(menu.ref))}>
              <Icon name="bookmark" size={16} /> {t.addBookmark}
            </button>
          </div>
        </>
      )}

      {teacher.state && <TeacherPanel state={teacher.state} onPlay={teacher.play} onClose={teacher.close} />}
      {dialog === "settings" && (
        <SettingsDialog
          onClose={() => setDialog(null)}
          onChanged={() => {
            narrator.invalidate();
          }}
        />
      )}
      {dialog === "lab" && <VoiceLab onClose={() => setDialog(null)} />}
      {dialog === "keys" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "range" && <PageRangeDialog pages={doc.pages} current={page} onClose={() => setDialog(null)} onRead={readPages} />}
      {pron && (
        <PronounceDialog
          docId={docId}
          {...pron}
          onClose={() => setPron(null)}
          onSaved={() => {
            narrator.invalidate();
            setLexVersion((v) => v + 1);
            toast("Pronunciation saved — it applies from the next sentence that is prepared.");
          }}
        />
      )}
      {consent && (
        <ConsentDialog
          info={consent.info}
          onAnswer={(ok) => {
            consent.resolve(ok);
            setConsent(null);
            useStore.getState().load();
          }}
        />
      )}
    </div>
  );
}
