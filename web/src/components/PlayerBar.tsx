import React from "react";
import { NarrPos, Narrator, Status } from "../player/Narrator";
import { useStore } from "../store";
import { Icon } from "./Icons";

interface Props {
  narrator: Narrator;
  status: Status;
  error: string | null;
  pos: NarrPos | null;
  rate: number;
  onRate: (r: number) => void;
  onPlay: () => void;
  sleepUntil: number | null;
  onSleep: (min: number) => void;
  voiceLabel: string;
}

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

export default function PlayerBar({ narrator, status, error, pos, rate, onRate, onPlay, sleepUntil, onSleep, voiceLabel }: Props) {
  const { t, settings } = useStore();
  const skip = settings?.skip_seconds || 10;
  const playing = status === "playing" || status === "loading";
  const sentText = pos ? pos.unit.text.split(" ").slice(pos.unit.sentences[pos.sentence]?.[0] ?? 0, pos.unit.sentences[pos.sentence]?.[1] ?? 0).join(" ") : "";
  const frac = pos && pos.duration > 0 ? Math.min(1, pos.time / pos.duration) : 0;
  const sleepLeft = sleepUntil ? Math.max(0, Math.round((sleepUntil - Date.now()) / 60000)) : 0;
  return (
    <div className="player" data-testid="player" dir="ltr" /* transport controls follow the timeline, not the text direction */>
      <div className="timebar" title={pos ? `${pos.time.toFixed(1)}s / ${pos.duration.toFixed(1)}s` : ""}>
        <div style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="row">
        <button className="icon-btn" title={`${t.prevParagraph} ([)`} aria-label={t.prevParagraph} onClick={() => narrator.paragraph(-1)} disabled={!pos}>
          <Icon name="paraPrev" />
        </button>
        <button className="icon-btn" title={`${t.prevSentence} (Shift+←)`} aria-label={t.prevSentence} onClick={() => narrator.sentence(-1)} disabled={!pos}>
          <Icon name="prev" />
        </button>
        <button className="icon-btn" title={`${t.back} ${skip}s (←)`} aria-label={`${t.back} ${skip}s`} onClick={() => narrator.seekBy(-skip)} disabled={!pos}>
          <Icon name="back" />
        </button>
        <button className="play-btn" title={`${playing ? t.pause : t.play} (Space)`} aria-label={playing ? t.pause : t.play} onClick={onPlay} data-testid="play">
          {status === "loading" ? <div className="spinner" style={{ borderTopColor: "currentColor" }} /> : <Icon name={playing ? "pause" : "play"} size={22} />}
        </button>
        <button className="icon-btn" title={`${t.forward} ${skip}s (→)`} aria-label={`${t.forward} ${skip}s`} onClick={() => narrator.seekBy(skip)} disabled={!pos}>
          <Icon name="fwd" />
        </button>
        <button className="icon-btn" title={`${t.nextSentence} (Shift+→)`} aria-label={t.nextSentence} onClick={() => narrator.sentence(1)} disabled={!pos}>
          <Icon name="next" />
        </button>
        <button className="icon-btn" title={`${t.nextParagraph} (])`} aria-label={t.nextParagraph} onClick={() => narrator.paragraph(1)} disabled={!pos}>
          <Icon name="paraNext" />
        </button>
        <div className="sep" />
        <button className="icon-btn" title={`${t.repeat} (R)`} aria-label={t.repeat} onClick={() => narrator.repeatSentence()} disabled={!pos}>
          <Icon name="repeat" />
        </button>
        <button className="icon-btn" title={t.restart} aria-label={t.restart} onClick={() => narrator.restart()} disabled={!pos}>
          <Icon name="restart" />
        </button>
        <button className="icon-btn" title={`${t.stop} (Esc)`} aria-label={t.stop} onClick={() => narrator.stop()} disabled={status === "idle"}>
          <Icon name="stop" size={18} />
        </button>
        <div className="now" dir="auto" data-testid="now-reading">
          {status === "error" ? (
            <span className="pill err" title={error || ""}>
              <Icon name="alert" size={14} /> {error}
            </span>
          ) : status === "loading" ? (
            t.loading
          ) : (
            sentText
          )}
        </div>
        {pos && (
          <span className={`pill ${pos.timing === "word" ? "ok" : "warn"}`} title={pos.timing === "word" ? t.timingWord : t.timingEstimated} data-testid="timing">
            {pos.timing === "word" ? "◉ word sync" : "◎ sentence sync"}
          </span>
        )}
        <span className="pill" title={t.voice}>
          {voiceLabel}
        </span>
        <div className="speed" title={`${t.speed} ( , / . )`}>
          <span className="muted small">{t.speed}</span>
          <input type="range" min={0.5} max={3} step={0.05} value={rate} onChange={(e) => onRate(Number(e.target.value))} onMouseUp={(e) => (e.target as HTMLInputElement).blur()} aria-label={t.speed} data-testid="speed" />
          <select value={SPEEDS.includes(rate) ? String(rate) : ""} onChange={(e) => {
              if (e.target.value) onRate(Number(e.target.value));
              e.target.blur(); // give keyboard shortcuts back to the player
            }} aria-label={t.speed} style={{ padding: "3px 4px" }}>
            {!SPEEDS.includes(rate) && <option value="">{rate.toFixed(2)}×</option>}
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <select value={sleepUntil ? "on" : "0"} onChange={(e) => {
            onSleep(Number(e.target.value));
            e.target.blur();
          }} title={t.sleep} aria-label={t.sleep} style={{ padding: "3px 4px", marginInlineStart: 6 }}>
          {sleepUntil ? <option value="on">⏾ {sleepLeft} {t.minutes}</option> : null}
          <option value="0">⏾ {t.off}</option>
          {[10, 20, 30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              ⏾ {m} {t.minutes}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
