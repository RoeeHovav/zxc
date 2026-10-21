import { useEffect, useRef } from 'react';
import type { Presented } from '../../domain/present';
import type { Answer } from '../../domain/types';
import { figureUrl } from '../../content/loader';
import { ReadAloud, Speakable } from '../../app/speech';
import { questionSegments } from '../../domain/speech';

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה'];

export interface QuestionViewProps {
  presented: Presented;
  answer: Answer;
  onChange: (a: Answer) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  eliminated?: string[];
  /** after the attempt is finished: mark the correct answer / the wrong choice */
  reveal?: boolean;
  onFigure?: (figureId: string) => void;
}

export function QuestionView({ presented, answer, onChange, onSubmit, disabled, eliminated = [], reveal, onFigure }: QuestionViewProps) {
  const q = presented.question;
  const root = useRef<HTMLDivElement>(null);

  // keyboard: digits 1-5 choose an option (single / multi / tf), Enter submits when focus is not inside a text field
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (q.type === 'mcq' || q.type === 'compare') {
        const opts = presented.options ?? [];
        if (n >= 1 && n <= opts.length && !eliminated.includes(opts[n - 1].id)) onChange({ type: q.type, value: opts[n - 1].id });
      } else if (q.type === 'multi') {
        const opts = presented.options ?? [];
        if (n >= 1 && n <= opts.length) {
          const cur = (answer as Extract<Answer, { type: 'multi' }>).value;
          const id = opts[n - 1].id;
          onChange({ type: 'multi', value: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
        }
      } else if (q.type === 'tf') {
        if (n === 1) onChange({ type: 'tf', value: true }); else if (n === 2) onChange({ type: 'tf', value: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, disabled, eliminated, onChange, presented.options, q.type]);

  const figure = q.figure;
  return (
    <div ref={root} className="stack">
      {figure && (
        <figure className="fig">
          <img src={figureUrl(figure)} alt="איור מקורי מהחוברת" onClick={() => onFigure?.(figure)} />
          <figcaption>איור מקורי מהחוברת (לחצו להגדלה)</figcaption>
        </figure>
      )}
      <div className="q-head">
        <div className="q-stem" role="heading" aria-level={2}><Speakable id={`q:${q.id}:stem`}>{q.stem}</Speakable></div>
        <ReadAloud owner={`q:${q.id}`} compact auto label="הקראת השאלה" testId="read-question" build={() => questionSegments({
          type: q.type, stem: q.stem,
          options: presented.options?.map((o, i) => ({ text: o.text, idx: i })).filter((o) => !eliminated.includes(presented.options![o.idx].id)),
          right: presented.right?.map((r) => ({ text: r.text })),
          leftTexts: q.type === 'match' ? q.left.map((l) => l.text) : undefined,
          items: q.type === 'order' ? (answer as Extract<Answer, { type: 'order' }>).value.map((id) => q.items.find((x) => x.id === id)?.text ?? '') : undefined,
        }, `q:${q.id}`)} />
      </div>
      {(q.type === 'mcq' || q.type === 'compare') && (
        <div className="opts" role="radiogroup" aria-label="אפשרויות תשובה">
          {presented.options!.map((o, i) => {
            const selected = (answer as { value: string | null }).value === o.id;
            const isRight = reveal && o.id === q.correct;
            const isWrong = reveal && selected && o.id !== q.correct;
            const elim = eliminated.includes(o.id);
            return (
              <button key={o.id} type="button" role="radio" aria-checked={selected} disabled={disabled || elim}
                className={`opt${selected ? ' sel' : ''}${isRight ? ' right' : ''}${isWrong ? ' wrong' : ''}${elim ? ' elim' : ''}`}
                onClick={() => onChange({ type: q.type, value: o.id })} data-testid={`opt-${i}`}>
                <span className="k">{LETTERS[i]}</span><Speakable id={`q:${q.id}:opt${i}`}>{o.text}</Speakable>
              </button>
            );
          })}
        </div>
      )}
      {q.type === 'multi' && (
        <div className="opts" role="group" aria-label="בחרו את כל התשובות הנכונות">
          {presented.options!.map((o, i) => {
            const cur = (answer as Extract<Answer, { type: 'multi' }>).value;
            const selected = cur.includes(o.id);
            const isRight = reveal && q.correct.includes(o.id);
            const isWrong = reveal && selected && !q.correct.includes(o.id);
            return (
              <button key={o.id} type="button" role="checkbox" aria-checked={selected} disabled={disabled}
                className={`opt${selected ? ' sel' : ''}${isRight ? ' right' : ''}${isWrong ? ' wrong' : ''}`}
                onClick={() => onChange({ type: 'multi', value: selected ? cur.filter((x) => x !== o.id) : [...cur, o.id] })} data-testid={`opt-${i}`}>
                <span className="k">{selected ? '✓' : LETTERS[i]}</span><Speakable id={`q:${q.id}:opt${i}`}>{o.text}</Speakable>
              </button>
            );
          })}
        </div>
      )}
      {q.type === 'tf' && (
        <div className="opts" role="radiogroup" aria-label="נכון או לא נכון">
          {[true, false].map((v, i) => {
            const selected = (answer as { value: boolean | null }).value === v;
            const isRight = reveal && v === q.correct;
            const isWrong = reveal && selected && v !== q.correct;
            return (
              <button key={String(v)} type="button" role="radio" aria-checked={selected} disabled={disabled}
                className={`opt${selected ? ' sel' : ''}${isRight ? ' right' : ''}${isWrong ? ' wrong' : ''}`}
                onClick={() => onChange({ type: 'tf', value: v })} data-testid={v ? 'tf-true' : 'tf-false'}>
                <span className="k">{i + 1}</span><span>{v ? 'נכון' : 'לא נכון'}</span>
              </button>
            );
          })}
        </div>
      )}
      {(q.type === 'short' || q.type === 'blank') && (
        <ShortInput q={q} value={(answer as { value: string }).value} onChange={(v) => onChange({ type: q.type, value: v })} onSubmit={onSubmit} disabled={disabled} />
      )}
      {q.type === 'match' && (
        <div className="stack tight">
          {q.left.map((l) => (
            <div key={l.id} className="pair">
              <div><b>{l.text}</b></div>
              <select className="text-in" disabled={disabled} aria-label={`התאמה עבור ${l.text}`} value={(answer as Extract<Answer, { type: 'match' }>).value[l.id] ?? ''}
                onChange={(e) => onChange({ type: 'match', value: { ...(answer as Extract<Answer, { type: 'match' }>).value, [l.id]: e.target.value } })} data-testid={`match-${l.id}`}>
                <option value="" disabled>בחרו…</option>
                {presented.right!.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {q.type === 'order' && <OrderInput presented={presented} answer={answer as Extract<Answer, { type: 'order' }>} onChange={onChange} disabled={disabled} reveal={reveal} />}
    </div>
  );
}

function ShortInput({ q, value, onChange, onSubmit, disabled }: { q: { accepted: string[]; placeholder?: string }; value: string; onChange: (v: string) => void; onSubmit?: () => void; disabled?: boolean }) {
  const long = Math.max(...q.accepted.map((a) => a.length)) > 70;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (!disabled) ref.current?.focus(); }, [disabled]);
  return long ? (
    <textarea ref={ref} className="text-in" dir="rtl" value={value} disabled={disabled} placeholder={q.placeholder ?? 'כתבו כאן…'} onChange={(e) => onChange(e.target.value)}
      aria-label="תשובה כתובה" data-testid="short-input" />
  ) : (
    <input ref={ref} className="text-in" dir="rtl" type="text" autoComplete="off" spellCheck={false} value={value} disabled={disabled} placeholder={q.placeholder ?? 'כתבו כאן…'}
      onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSubmit?.(); }} aria-label="תשובה כתובה" data-testid="short-input" />
  );
}

function OrderInput({ presented, answer, onChange, disabled, reveal }: { presented: Presented; answer: Extract<Answer, { type: 'order' }>; onChange: (a: Answer) => void; disabled?: boolean; reveal?: boolean }) {
  const q = presented.question;
  if (q.type !== 'order') return null;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= answer.value.length) return;
    const next = answer.value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ type: 'order', value: next });
  };
  return (
    <div className="stack tight" role="list" aria-label="סדרו לפי הסדר הנכון">
      {answer.value.map((id, i) => {
        const text = q.items.find((x) => x.id === id)?.text;
        const ok = reveal ? q.correct[i] === id : undefined;
        return (
          <div className="order-item" role="listitem" key={id} style={ok === undefined ? undefined : { borderColor: ok ? 'var(--ok)' : 'var(--bad)' }} data-testid={`order-${i}`}>
            <span className="n">{i + 1}</span><span>{text}</span>
            {!disabled && (
              <span className="mv">
                <button type="button" aria-label="הזזה למעלה" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                <button type="button" aria-label="הזזה למטה" onClick={() => move(i, 1)} disabled={i === answer.value.length - 1}>▼</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
