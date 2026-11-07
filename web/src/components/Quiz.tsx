import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, QuizPlan, QuizQuestion } from "../api";
import { Narrator } from "../player/Narrator";
import { useStore } from "../store";
import { Icon } from "./Icons";

interface Result {
  q: QuizQuestion;
  score: number;
  picked: number | null;
}

export interface QuizUi {
  phase: "loading" | "asking" | "feedback" | "summary";
  heading?: string;
  questions: QuizQuestion[];
  index: number;
  picked: number | null;
  revealed: boolean; // an open question: the key points are showing
  results: Result[];
}

const FREE_VOICE: Record<string, string> = { he: "edge:he-IL-HilaNeural", en: "edge:en-US-AvaMultilingualNeural" };

/** Comprehension checkpoints: asks questions about what was just listened to.  Narration waits while this runs. */
export function useQuiz(docId: string, narrator: Narrator) {
  const { settings, toast, lang } = useStore();
  const he = lang === "he";
  const [ui, setUi] = useState<QuizUi | null>(null);
  const uiRef = useRef<QuizUi | null>(null);
  uiRef.current = ui;
  const done = useRef<(() => void) | null>(null);
  const resumeAt = useRef<string | null>(null);
  const replayed = useRef(false);
  const request = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const stopAudio = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setSpeaking(false);
  }, []);

  const close = useCallback(() => {
    request.current++;
    stopAudio();
    setUi(null);
    const d = done.current;
    done.current = null;
    d?.();
    if (replayed.current && resumeAt.current) {
      // the listener went back to hear a part again: carry on where the reading had got to
      const at = resumeAt.current;
      replayed.current = false;
      narrator.playFrom(at, 0).catch(() => undefined);
    }
    replayed.current = false;
  }, [narrator, stopAudio]);

  const fetchQuestions = useCallback(
    async (units: string[]) => {
      try {
        return await api.quiz(docId, units);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body?.provider) {
          const ok = narrator.consentHandler ? await narrator.consentHandler(e.body) : false;
          if (!ok) throw new Error(he ? "ללא אישור לא נשלח טקסט ל-Gemini." : "Not allowed, so nothing was sent to Gemini.");
          await api.consent(e.body.provider);
          return await api.quiz(docId, units);
        }
        throw e;
      }
    },
    [docId, narrator, he],
  );

  const checkpoint = useCallback(
    (heard: string[], _plan: QuizPlan, next: string | null) =>
      new Promise<void>((resolve) => {
        done.current = resolve;
        resumeAt.current = next;
        replayed.current = false;
        const id = ++request.current;
        setUi({ phase: "loading", questions: [], index: 0, picked: null, revealed: false, results: [] });
        fetchQuestions(heard)
          .then((r) => {
            if (id !== request.current) return; // skipped meanwhile
            if (r.status === "ready" && r.questions.length) {
              setUi({ phase: "asking", heading: r.heading, questions: r.questions, index: 0, picked: null, revealed: false, results: [] });
              return;
            }
            const say: Record<string, string> = {
              "no-key": he ? "מבחני ההבנה צריכים את מפתח ה-Gemini שלכם (הגדרות ← מנועי דיבור)." : "Comprehension checkpoints need your Gemini key (Settings → Speech engines).",
              paused: he ? "מבחני ההבנה נחים: המכסה החינמית של Google נגמרה. הם יחזרו כשהיא תתחדש." : "Checkpoints are resting: Google's free allowance is used up. They return when it resets.",
              error: (he ? "לא הצלחתי לנסח שאלות: " : "Could not write questions: ") + (r.message || ""),
              empty: he ? "אין בקטע הזה משהו ששווה לשאול עליו." : "Nothing in that part was worth a question.",
            };
            if (say[r.status]) toast(say[r.status], r.status === "error" ? "error" : "info");
            close();
          })
          .catch((e) => {
            if (id !== request.current) return;
            toast((he ? "מבחן ההבנה: " : "Checkpoint: ") + (e?.message || e), "error");
            close();
          });
      }),
    [fetchQuestions, close, toast, he],
  );

  const prefetch = useCallback(
    (units: string[]) => {
      api.quiz(docId, units, true).catch(() => undefined); // best effort; consent is asked when the questions are needed
    },
    [docId],
  );

  useEffect(() => {
    narrator.checkpointHandler = checkpoint;
    narrator.quizPrefetch = prefetch;
  }, [narrator, checkpoint, prefetch]);

  // ----------------------------------------------------------- answering
  const record = (q: QuizQuestion, score: number, picked: number | null) => {
    api.quizAnswer(docId, q, score, picked, !!q.revisit).catch(() => undefined);
  };

  const choose = (i: number) => {
    const s = uiRef.current;
    if (!s || s.phase !== "asking") return;
    const q = s.questions[s.index];
    if (q.kind === "recall" || !q.options || i >= q.options.length) return;
    const score = i === q.answer ? 1 : 0;
    record(q, score, i);
    setUi({ ...s, phase: "feedback", picked: i, results: [...s.results, { q, score, picked: i }] });
  };

  const reveal = () => {
    const s = uiRef.current;
    if (s && s.phase === "asking") setUi({ ...s, revealed: true });
  };

  const rate = (score: number) => {
    const s = uiRef.current;
    if (!s || s.phase !== "asking") return;
    const q = s.questions[s.index];
    record(q, score, null);
    next({ ...s, results: [...s.results, { q, score, picked: null }] });
  };

  const next = (from?: QuizUi) => {
    const s = from || uiRef.current;
    if (!s) return;
    stopAudio();
    if (s.index + 1 < s.questions.length) setUi({ ...s, phase: "asking", index: s.index + 1, picked: null, revealed: false });
    else setUi({ ...s, phase: "summary" });
  };

  // "hear that part again": plays the sentence that holds the answer, then the reading carries on from where it was
  const hear = async (q: QuizQuestion) => {
    stopAudio();
    try {
      const u = await narrator.getUnit(q.unit);
      const si = narrator.sentenceOf(u, q.word);
      const [a, b] = u.sentences[si] ?? [q.word, q.word + 1];
      const last = u.words[Math.max(a, b - 1)] ?? u.words[q.word];
      replayed.current = true;
      await narrator.playFrom(u, a, { stopAt: { page: last[0], word: last[1] } });
    } catch (e: any) {
      toast(e?.message || String(e), "error");
    }
  };

  // read a question aloud with the free voice (never the limited Gemini voice)
  const speak = async (q: QuizQuestion) => {
    stopAudio();
    const text = q.options ? `${q.q} ${q.options.map((o, i) => `${i + 1}. ${o}`).join(". ")}` : q.q;
    const lg = /[֐-׿]/.test(text) ? "he" : "en";
    let voice = settings?.voices[lg] || FREE_VOICE[lg];
    if (voice.startsWith("gemini:")) voice = FREE_VOICE[lg];
    try {
      setSpeaking(true);
      const sp = await api.preview(text, voice, lg);
      const a = new Audio(sp.audio);
      a.playbackRate = settings?.speed || 1;
      (a as any).preservesPitch = true;
      a.onended = () => setSpeaking(false);
      a.onerror = () => setSpeaking(false);
      audio.current = a;
      await a.play();
    } catch {
      setSpeaking(false);
    }
  };

  // read the question aloud as soon as it appears, if the listener asked for that
  useEffect(() => {
    if (ui?.phase === "asking" && settings?.quiz_read_aloud && !replayed.current) speak(ui.questions[ui.index]);
  }, [ui?.phase, ui?.index]);

  useEffect(() => stopAudio, []);

  return { ui, speaking, choose, reveal, rate, next, hear, speak, skip: close, finish: close, stopAudio };
}

type QuizApi = ReturnType<typeof useQuiz>;

const KIND_LABEL = {
  en: { detail: "Detail", link: "Connection", apply: "Apply it", recall: "In your own words" },
  he: { detail: "פרט", link: "קשר והיגיון", apply: "יישום", recall: "במילים שלכם" },
};

export function QuizCard({ quiz }: { quiz: QuizApi }) {
  const { lang } = useStore();
  const he = lang === "he";
  const { ui } = quiz;

  useEffect(() => {
    if (!ui) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        quiz.skip();
      } else if (ui.phase === "asking" && /^[1-4]$/.test(e.key)) quiz.choose(Number(e.key) - 1);
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (ui.phase === "feedback") quiz.next();
        else if (ui.phase === "summary") quiz.finish();
        else if (ui.phase === "asking" && ui.questions[ui.index].kind === "recall" && !ui.revealed) quiz.reveal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ui) return null;
  const total = ui.questions.length;
  const q = ui.questions[ui.index];
  const labels = KIND_LABEL[he ? "he" : "en"];
  const dir = he ? "rtl" : "ltr";

  const head = (
    <div className="quiz-head">
      <Icon name="check" size={16} />
      <strong style={{ flex: 1 }}>
        {he ? "בדיקת הבנה" : "Checkpoint"}
        {ui.phase !== "loading" && ui.phase !== "summary" && total > 0 ? ` · ${ui.index + 1}/${total}` : ""}
      </strong>
      {ui.heading && ui.phase === "asking" && ui.index === 0 && <span className="muted small quiz-heading" dir="auto">{ui.heading}</span>}
      <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => quiz.skip()} aria-label={he ? "דילוג" : "Skip"} title={he ? "דילוג (Esc)" : "Skip (Esc)"} data-testid="quiz-skip">
        <Icon name="x" size={14} />
      </button>
    </div>
  );

  if (ui.phase === "loading")
    return (
      <div className="quiz" dir={dir} role="dialog" aria-label="Checkpoint" data-testid="quiz">
        {head}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="spinner" /> {he ? "מנסח שאלות על מה ששמעתם…" : "Writing questions about what you just heard…"}
        </div>
        <div className="muted small">{he ? "דילוג בכל רגע בלחיצה על Esc או על כפתור ההשמעה." : "Skip any time with Esc or the play button."}</div>
      </div>
    );

  if (ui.phase === "summary") {
    const points = ui.results.reduce((a, r) => a + r.score, 0);
    const missed = ui.results.filter((r) => r.score < 1);
    return (
      <div className="quiz" dir={dir} role="dialog" aria-label="Checkpoint result" data-testid="quiz">
        {head}
        <div className="quiz-score" data-testid="quiz-score">
          {points % 1 === 0 ? points : points.toFixed(1)} / {ui.results.length}
        </div>
        <div className="muted small">
          {missed.length === 0
            ? he ? "הקשבתם היטב." : "You followed it well."
            : he ? "אפשר לשמוע שוב את המקום שבו נאמרה כל תשובה. מה שפספסתם יחזור בבדיקה הבאה." : "You can hear again the place where each answer was said. What you missed comes back at the next checkpoint."}
        </div>
        {missed.map((r) => (
          <div className="quiz-missed" key={r.q.qid}>
            <span dir="auto" style={{ flex: 1 }}>{r.q.q}</span>
            <button className="btn" onClick={() => quiz.hear(r.q)} data-testid="quiz-hear">
              <Icon name="play" size={14} /> {he ? "שמיעה חוזרת" : "Hear it again"}
            </button>
          </div>
        ))}
        <div style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={() => quiz.finish()} data-testid="quiz-continue">
            {he ? "המשך הקשבה" : "Continue listening"}
          </button>
        </div>
      </div>
    );
  }

  const recall = q.kind === "recall";
  return (
    <div className="quiz" dir={dir} role="dialog" aria-label="Checkpoint question" data-testid="quiz">
      {head}
      <div className="quiz-kind">
        {q.revisit ? (he ? "מקודם — שאלה שפספסתם · " : "From earlier — you missed this · ") : ""}
        {labels[q.kind]}
      </div>
      <div className="quiz-q" dir="auto" data-testid="quiz-question">{q.q}</div>

      {!recall &&
        q.options!.map((o, i) => {
          const fb = ui.phase === "feedback";
          const cls = fb ? (i === q.answer ? "right" : i === ui.picked ? "wrong" : "") : "";
          return (
            <button key={i} className={`quiz-opt ${cls}`} disabled={fb} onClick={() => quiz.choose(i)} data-testid={`quiz-opt-${i}`}>
              <span className="quiz-num">{i + 1}</span>
              <span dir="auto" style={{ flex: 1, textAlign: "start" }}>{o}</span>
              {fb && i === q.answer && <Icon name="check" size={16} />}
            </button>
          );
        })}

      {recall && !ui.revealed && (
        <>
          <textarea className="quiz-text" rows={3} dir="auto" placeholder={he ? "ענו במילים שלכם (או אמרו בקול) — ואז הציגו מה נאמר בקטע" : "Answer in your own words (or say it out loud), then show what the text said"} data-testid="quiz-text" />
          <button className="btn primary" onClick={() => quiz.reveal()} data-testid="quiz-reveal">
            {he ? "הצגת מה שנאמר" : "Show what the text said"}
          </button>
        </>
      )}
      {recall && ui.revealed && (
        <>
          <div className="quiz-points" dir="auto">
            <div className="muted small">{he ? "תשובה טובה כוללת:" : "A good answer contains:"}</div>
            <ul>{q.key_points!.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
          <div className="muted small">{he ? "כמה מזה אמרתם?" : "How much of that did you say?"}</div>
          <div className="quiz-rate">
            <button className="btn" onClick={() => quiz.rate(1)} data-testid="quiz-got">{he ? "הכול" : "All of it"}</button>
            <button className="btn" onClick={() => quiz.rate(0.5)} data-testid="quiz-partly">{he ? "חלק" : "Part of it"}</button>
            <button className="btn" onClick={() => quiz.rate(0)} data-testid="quiz-missed">{he ? "כמעט כלום" : "Hardly any"}</button>
            <button className="btn" onClick={() => quiz.hear(q)}><Icon name="play" size={14} /> {he ? "שמיעה חוזרת" : "Hear it again"}</button>
          </div>
        </>
      )}

      {ui.phase === "feedback" && (
        <div className="quiz-feedback" data-testid="quiz-feedback">
          <strong style={{ color: ui.picked === q.answer ? "var(--ok, #16a34a)" : "var(--danger, #dc2626)" }}>
            {ui.picked === q.answer ? (he ? "נכון." : "Correct.") : he ? "לא מדויק." : "Not quite."}
          </strong>{" "}
          <span dir="auto">{q.why}</span>
          {q.evidence && (
            <blockquote dir="auto">{q.evidence}</blockquote>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => quiz.hear(q)} data-testid="quiz-hear">
              <Icon name="play" size={14} /> {he ? "שמיעה חוזרת של המקום" : "Hear that part again"}
            </button>
            <button className="btn primary" onClick={() => quiz.next()} data-testid="quiz-next">
              {ui.index + 1 < total ? (he ? "השאלה הבאה" : "Next question") : he ? "סיום" : "Finish"}
            </button>
          </div>
        </div>
      )}

      <div className="quiz-foot">
        <button className="btn" onClick={() => (quiz.speaking ? quiz.stopAudio() : quiz.speak(q))} title={he ? "הקראת השאלה" : "Read the question aloud"}>
          <Icon name="speech" size={14} /> {quiz.speaking ? (he ? "עצירה" : "Stop") : he ? "הקראה" : "Read aloud"}
        </button>
        {!recall && ui.phase === "asking" && <span className="muted small">{he ? "מקשים 1–4 לבחירה" : "Keys 1–4 to answer"}</span>}
      </div>
    </div>
  );
}
