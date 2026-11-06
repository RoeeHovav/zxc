import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, Speech, Voice } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";

export function Modal({ title, icon, onClose, children, footer, testid }: { title: string; icon?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; testid?: string }) {
  const { t } = useStore();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title} data-testid={testid}>
        <header>
          {icon && <Icon name={icon} />} <span className="grow">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label={t.close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function ConsentDialog({ info, onAnswer }: { info: any; onAnswer: (ok: boolean) => void }) {
  const { t } = useStore();
  return (
    <Modal
      title={t.consentTitle}
      icon="alert"
      onClose={() => onAnswer(false)}
      testid="consent"
      footer={
        <>
          <button className="btn" onClick={() => onAnswer(false)}>
            {t.deny}
          </button>
          <button className="btn primary" onClick={() => onAnswer(true)} data-testid="consent-allow">
            {t.allow}
          </button>
        </>
      }
    >
      <p>{t.consentBody}</p>
      <div className="provider-card">
        <strong>{info.name}</strong>
        <div className="muted small">{info.privacy}</div>
      </div>
    </Modal>
  );
}

/** Play a single preview clip (Voice Lab, pronunciation editor). */
export function usePreviewPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState(false);
  const play = async (text: string, voice: string, lang: string, vowels = false): Promise<Speech | null> => {
    setBusy(true);
    try {
      let sp: Speech;
      try {
        sp = await api.preview(text, voice, lang, vowels);
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 409 && e.body?.error === "consent_required") {
          if (!window.confirm(`${e.body.name}\n\n${e.body.privacy}\n\nAllow this?`)) throw new Error("Not allowed.");
          await api.consent(e.body.provider);
          sp = await api.preview(text, voice, lang, vowels);
        } else throw e;
      }
      audio.current?.pause();
      audio.current = new Audio(sp.audio);
      await audio.current.play();
      return sp;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => () => audio.current?.pause(), []);
  return { play, busy };
}

export function PronounceDialog({ docId, page, word, text, lang, onClose, onSaved }: { docId: string; page: number; word: number; text: string; lang: string; onClose: () => void; onSaved: () => void }) {
  const { settings, toast } = useStore();
  const clean = text.replace(/^[("'“«\[]+|[)"'”».,;:!?\]]+$/g, "");
  const [spoken, setSpoken] = useState(clean);
  const [scope, setScope] = useState<"occurrence" | "document" | "global">("document");
  const { play, busy } = usePreviewPlayer();
  const voice = settings?.voices[lang] || settings?.voices.en || "";
  const he = /[֐-׿]/.test(clean);
  const NIQQUD = ["ַ", "ָ", "ֶ", "ֵ", "ִ", "ֹ", "ֻ", "ְ", "ּ", "ׁ", "ׂ", "ֲ"];
  const inp = useRef<HTMLInputElement>(null);
  const insert = (m: string) => {
    const el = inp.current;
    if (!el) return;
    const s = el.selectionStart ?? spoken.length;
    const v = spoken.slice(0, s) + m + spoken.slice(s);
    setSpoken(v);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(s + 1, s + 1);
    });
  };
  const save = async () => {
    if (!spoken.trim()) return;
    try {
      if (scope === "occurrence") await api.occurrence(docId, page, word, spoken);
      else await api.addLexicon({ written: clean, spoken, scope: scope === "global" ? "global" : "document", doc_id: scope === "document" ? docId : null, lang: he ? "he" : lang });
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };
  return (
    <Modal
      title="Fix pronunciation"
      icon="speech"
      onClose={onClose}
      testid="pronounce"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label>Written in the document</label>
        <div style={{ fontSize: 20 }} dir="auto">
          {clean}
        </div>
      </div>
      <div className="field">
        <label>Should be said as</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input ref={inp} value={spoken} onChange={(e) => setSpoken(e.target.value)} dir="auto" style={{ flex: 1, fontSize: 20 }} />
          <button className="btn" disabled={busy || !voice} onClick={() => play(spoken, voice, he ? "he" : lang).catch((e) => toast(e.message, "error"))}>
            <Icon name="play" size={14} /> Preview
          </button>
        </div>
        {he && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {NIQQUD.map((m) => (
              <button key={m} className="btn" style={{ padding: "2px 8px", fontSize: 18 }} onClick={() => insert(m)} title="Insert vowel mark after the cursor letter">
                {"א" + m}
              </button>
            ))}
          </div>
        )}
        <div className="hint">
          {he
            ? "Add niqqud to the ambiguous letters (e.g. סֵפֶר / סַפָּר / סָפַר), or respell phonetically. Expand acronyms in words. Preview before saving."
            : "Respell phonetically (e.g. “SEE-kwel”) or expand an abbreviation. Preview before saving."}
        </div>
      </div>
      <div className="field">
        <label>Apply to</label>
        <label className="check">
          <input type="radio" checked={scope === "occurrence"} onChange={() => setScope("occurrence")} /> Only this occurrence
        </label>
        <label className="check">
          <input type="radio" checked={scope === "document"} onChange={() => setScope("document")} /> Every occurrence in this document
        </label>
        <label className="check">
          <input type="radio" checked={scope === "global"} onChange={() => setScope("global")} /> All documents
        </label>
      </div>
    </Modal>
  );
}

const SAMPLES: { id: string; lang: string; title: string; text: string }[] = [
  { id: "he-homographs", lang: "he", title: "Hebrew homographs (ספר)", text: "הספר שקניתי אתמול מרתק. הספר במספרה ספר את הכסף בקפידה. מעבר לספר עברו פליטים רבים." },
  { id: "he-academic", lang: "he", title: "Hebrew academic", text: "במחקר זה נבחנה ההשפעה של משתנים חברתיים על דפוסי ההצבעה. הממצאים מראים כי קיים מתאם חיובי בין רמת ההשכלה לבין ההשתתפות הפוליטית." },
  { id: "he-homograph-user", lang: "he", title: "Hebrew: שמן = “their name” (the one that was read wrongly)", text: "מקראות ישראל הינו שמן של חוברות" },
  { id: "he-niqqud-typed", lang: "he", title: "Hebrew: same sentence with vowel marks typed by hand", text: "מִקְרָאוֹת יִשְׂרָאֵל הִינוֹ שְׁמָן שֶׁל חוּבְרוֹת" },
  { id: "he-acronyms", lang: "he", title: "Hebrew acronyms (military)", text: "המג\"ד והמ\"פ הגיעו לבה\"ד 1. הרמטכ\"ל ביקר בבסיס צה\"ל, והקמב\"ץ דיווח לאג\"ם." },
  { id: "he-mixed", lang: "he", title: "Hebrew + English", text: "האלגוריתם משתמש ב-machine learning כדי לשפר את הדיוק. ראו גם את המאמר של Smith et al. משנת 2019." },
  { id: "he-numbers", lang: "he", title: "Hebrew numbers & dates", text: "ב-17 בספטמבר 1982 נסוגה ישראל מביירות. כ-2500 עולים הגיעו, ו-35% מהם התיישבו בגליל." },
  { id: "en-academic", lang: "en", title: "English academic", text: "Is the effect statistically significant? We define the null hypothesis as the absence of any difference between the groups; therefore, the p-value must be interpreted with caution." },
  { id: "en-math", lang: "en", title: "English math", text: "Let f(x) = x² + 2x − 1. Then f has a minimum where the derivative equals zero, and for all x ≥ 0 the function is increasing." },
];

export function VoiceLab({ onClose }: { onClose: () => void }) {
  const { settings, toast } = useStore();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [sample, setSample] = useState(SAMPLES[0]);
  const [text, setText] = useState(SAMPLES[0].text);
  const [a, setA] = useState(settings?.voices.he || "");
  const [b, setB] = useState("");
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const { play, busy } = usePreviewPlayer();
  useEffect(() => {
    api.voices().then((r) => setVoices(r.voices));
  }, []);
  useEffect(() => {
    setText(sample.text);
    const def = settings?.voices[sample.lang] || "";
    setA(def);
    const alt = voices.find((v) => (v.lang === sample.lang || v.lang === "mul") && v.id !== def);
    setB(alt?.id || "");
  }, [sample, voices.length]);
  const opts = voices.filter((v) => v.lang === sample.lang || v.lang === "mul" || (sample.lang === "he" && v.provider === "edge" && v.id.includes("Multilingual")));
  const [vowels, setVowels] = useState(true);
  const [given, setGiven] = useState("");
  const [assistant, setAssistant] = useState<Speech["assistant"] | null>(null);
  const assistantLine = () => {
    const a = assistant;
    if (!a) return "";
    switch (a.state) {
      case "ok":
        return `Assistant added vowel marks to ${a.changed.length} word(s): ` + a.changed.map((c) => `${c[0]} → ${c[1]}`).join("   ");
      case "none-needed":
        return "Assistant found no ambiguous word in this passage, so nothing was changed.";
      case "no-key":
        return "No Gemini key is saved, so nothing was changed. Add it in Settings → Speech engines → Google Gemini.";
      case "paused":
        return "Assistant is resting because Google's free allowance is used up; nothing was changed. " + (a.detail || "");
      case "error":
        return "Assistant could not answer, so nothing was changed: " + (a.detail || "");
      case "off":
        return "Assistant is switched off.";
      case "voice-understands-context":
        return "This voice reads whole sentences itself; the assistant is not needed.";
      default:
        return "";
    }
  };
  const rate = async (voice: string, r: number) => {
    setRatings({ ...ratings, [voice]: r });
    await api.addRating({ sample: sample.id, voice, rating: r, variant: text === sample.text ? "" : "edited" });
    toast("Rating saved");
  };
  return (
    <Modal title="Voice lab — compare narrators" icon="lab" onClose={onClose} testid="voicelab">
      <p className="muted small">Listen to the same passage with two voices and rate them. Ratings are stored locally so the best voice per language can be chosen deliberately.</p>
      <div className="field">
        <label>Sample</label>
        <select value={sample.id} onChange={(e) => setSample(SAMPLES.find((s) => s.id === e.target.value)!)}>
          {SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
      </div>
      {sample.lang === "he" && (
        <label className="check" style={{ margin: "6px 0" }}>
          <input type="checkbox" checked={vowels} onChange={(e) => setVowels(e.target.checked)} data-testid="lab-vowels" />
          Pronunciation assistant: let Gemini choose the right reading of ambiguous words from the sentence and give the voice vowel marks
          (needs the Gemini key from Settings)
        </label>
      )}
      {given && (
        <div className="small" dir="rtl" style={{ margin: "4px 0 4px", padding: 6, border: "1px dashed #8886" }} data-testid="lab-given">
          <span className="muted" dir="ltr">What the voice was given: </span>
          {given}
        </div>
      )}
      {assistant && (
        <div className="small muted" dir="ltr" style={{ margin: "0 0 8px" }} data-testid="lab-assistant">
          {assistantLine()}
        </div>
      )}
      <div className="lab-grid">
        {[
          [a, setA, "A"],
          [b, setB, "B"],
        ].map(([v, setV, label]: any) => (
          <div className="lab-col" key={label}>
            <strong>Voice {label}</strong>
            <select value={v} onChange={(e) => setV(e.target.value)} style={{ width: "100%", margin: "6px 0" }}>
              <option value="">—</option>
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.locale})
                </option>
              ))}
            </select>
            <button className="btn" disabled={!v || busy} onClick={() => play(text, v, sample.lang, sample.lang === "he" && vowels).then((sp) => {
                setGiven(sp && sp.text !== text ? sp.text : "");
                setAssistant(sample.lang === "he" && vowels ? sp?.assistant ?? null : null);
              }).catch((e) => toast(e.message, "error"))}>
              <Icon name="play" size={14} /> Play
            </button>
            <div className="stars" style={{ marginTop: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={(ratings[v] || 0) >= n ? "on" : ""} disabled={!v} onClick={() => rate(v, n)} aria-label={`${n} stars`}>
                  ★
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function PageRangeDialog({ pages, current, onClose, onRead }: { pages: number; current: number; onClose: () => void; onRead: (from: number, to: number) => void }) {
  const [from, setFrom] = useState(current + 1);
  const [to, setTo] = useState(Math.min(pages, current + 1));
  return (
    <Modal
      title="Read a page range"
      icon="doc"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={() => onRead(Math.max(1, Math.min(from, pages)) - 1, Math.max(from, Math.min(to, pages)) - 1)}>
          <Icon name="play" size={14} /> Read
        </button>
      }
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        From page <input type="number" min={1} max={pages} value={from} onChange={(e) => setFrom(Number(e.target.value))} style={{ width: 90 }} />
        to <input type="number" min={1} max={pages} value={to} onChange={(e) => setTo(Number(e.target.value))} style={{ width: 90 }} /> of {pages}
      </div>
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["Space", "Play / pause"],
    ["← / →", "Skip back / forward"],
    ["Shift + ← / →", "Previous / next sentence"],
    ["[ / ]", "Previous / next paragraph"],
    ["R", "Repeat current sentence"],
    [", / .", "Slower / faster"],
    ["Esc", "Stop (or close dialog)"],
    ["Ctrl + F", "Search"],
    ["Ctrl + B", "Bookmark the current position"],
    ["Ctrl + + / −", "Zoom"],
    ["PageUp / PageDown", "Previous / next page"],
    ["A", "Toggle follow-narration scrolling"],
    ["Double-click a word", "Read from that sentence"],
    ["Drag over text", "Select, then “Read selection”"],
    ["Right-click a word", "More actions (pronunciation, bookmark…)"],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="kbd-list">
        {rows.map(([k, d]) => (
          <React.Fragment key={k}>
            <span>
              <kbd>{k}</kbd>
            </span>
            <span>{d}</span>
          </React.Fragment>
        ))}
      </div>
    </Modal>
  );
}
