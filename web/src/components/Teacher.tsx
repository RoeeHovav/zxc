import React, { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icons";

export interface TeacherState {
  unitId: string;
  scope: "paragraph" | "section";
  status: "loading" | "ready" | "speaking" | "error";
  text?: string;
  lang?: string;
  model?: string;
  heading?: string;
  error?: string;
}

/** Card that shows an AI explanation, clearly separated from the document. */
export function TeacherPanel({ state, onPlay, onClose }: { state: TeacherState; onPlay: () => void; onClose: () => void }) {
  const { lang } = useStore();
  const he = lang === "he";
  return (
    <div className="teacher" role="complementary" aria-label="AI explanation" data-testid="teacher">
      <div className="teacher-head">
        <Icon name="lab" size={16} />
        <strong style={{ flex: 1 }}>{he ? "הסבר של בינה מלאכותית — אינו חלק מהמסמך" : "AI explanation — not part of the document"}</strong>
        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose} aria-label="close">
          <Icon name="x" size={14} />
        </button>
      </div>
      {state.heading && <div className="muted small" dir="auto">{state.heading}</div>}
      {state.status === "loading" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="spinner" /> {he ? "המורה חושב…" : "The teacher is thinking…"}
        </div>
      )}
      {state.status === "error" && <div style={{ color: "var(--danger)" }}>{state.error}</div>}
      {state.text && (
        <>
          <div dir="auto" style={{ lineHeight: 1.55, margin: "6px 0" }}>
            {state.text}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={onPlay} disabled={state.status === "speaking"}>
              <Icon name="play" size={14} /> {he ? "השמעה" : "Listen"}
            </button>
            <span className="muted small">{state.model}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Fetch + speak explanations.  Returns helpers used by the Reader. */
export function useTeacher(docId: string) {
  const { settings, toast } = useStore();
  const [state, setState] = useState<TeacherState | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const done = useRef<(() => void) | null>(null);

  const stopAudio = () => {
    audio.current?.pause();
    audio.current = null;
    done.current?.();
    done.current = null;
  };
  useEffect(() => stopAudio, []);

  const speak = async (text: string, lg: string) => {
    const voice = settings?.voices[lg] || settings?.voices.en || "";
    const sp = await api.preview(text, voice, lg);
    stopAudio();
    const a = new Audio(sp.audio);
    audio.current = a;
    a.playbackRate = settings?.speed || 1;
    (a as any).preservesPitch = true;
    await new Promise<void>((resolve) => {
      done.current = resolve;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
    done.current = null;
  };

  /** Explain a unit; if `speakIt`, read the explanation aloud and resolve when done. */
  const explain = async (unitId: string, scope: "paragraph" | "section", speakIt: boolean) => {
    setState({ unitId, scope, status: "loading" });
    try {
      let r;
      try {
        r = await api.explain(docId, unitId, scope);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          if (!confirm(`Teacher Mode will send the passage to ${settings?.llm_base_url}. Allow?`)) throw new Error("Not allowed.");
          await api.consent("llm");
          r = await api.explain(docId, unitId, scope);
        } else throw e;
      }
      setState({ unitId, scope, status: speakIt ? "speaking" : "ready", text: r.text, lang: r.lang, model: r.model, heading: r.heading });
      if (speakIt) {
        await speak(r.text, r.lang);
        setState((s) => (s ? { ...s, status: "ready" } : s));
      }
    } catch (e: any) {
      setState({ unitId, scope, status: "error", error: e?.message || String(e) });
      if (speakIt) toast("Teacher Mode: " + (e?.message || e), "error");
    }
  };

  return {
    state,
    explain,
    play: () => state?.text && speak(state.text, state.lang || "en").then(() => setState((s) => (s ? { ...s, status: "ready" } : s))),
    close: () => {
      stopAudio();
      setState(null);
    },
    stopAudio,
  };
}
