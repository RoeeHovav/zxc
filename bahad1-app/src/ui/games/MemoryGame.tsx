import { useEffect, useMemo, useRef, useState } from 'react';
import type { MemoryRound } from '../../domain/games';
import type { Question } from '../../domain/types';
import { Num, fmtTime } from '../components/common';
import { SourceModal } from '../components/SourceModal';

export interface MemoryResult { pairs: number; moves: number; ms: number }

/** Flip two cards at a time: find the two sides of each verified pair (taken from verified matching questions). */
export function MemoryGame({ round, bank, onEnd, onQuit }: { round: MemoryRound; bank: Question[]; onEnd: (r: MemoryResult) => void; onQuit: () => void }) {
  const [open, setOpen] = useState<string[]>([]); // card ids currently face up (not yet matched), max 2
  const [matched, setMatched] = useState<string[]>([]); // pair ids
  const [moves, setMoves] = useState(0);
  const [src, setSrc] = useState<Question | null>(null);
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const locked = useRef(false);
  const matchedRef = useRef<string[]>([]);
  const doneRef = useRef(false);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  const byCard = useMemo(() => new Map(round.cards.map((c) => [c.id, c])), [round]);

  const flip = (id: string) => {
    if (locked.current || open.includes(id) || matched.includes(byCard.get(id)!.pairId)) return;
    const next = [...open, id];
    setOpen(next);
    if (next.length < 2) return;
    setMoves((m) => m + 1);
    const [a, b] = next.map((x) => byCard.get(x)!);
    locked.current = true;
    if (a.pairId === b.pairId && a.side !== b.side) {
      setTimeout(() => {
        const n = [...matchedRef.current, a.pairId];
        matchedRef.current = n;
        setMatched(n); setOpen([]); locked.current = false;
        if (n.length === round.pairs.length && !doneRef.current) { doneRef.current = true; onEnd({ pairs: round.pairs.length, moves: moves + 1, ms: Date.now() - started.current }); }
      }, 350);
    } else {
      setTimeout(() => { setOpen([]); locked.current = false; }, 1000);
    }
  };

  const found = round.pairs.filter((p) => matched.includes(p.id));
  return (
    <div className="card stack fade-in game-run" data-testid="game-memory">
      <div className="game-hud row between">
        <span className="chip gold">⏱ <Num>{fmtTime(now - started.current)}</Num></span>
        <span>מהלכים: <b data-testid="memory-moves"><Num>{moves}</Num></b></span>
        <span className="chip">זוגות: <Num>{matched.length}</Num> מתוך <Num>{round.pairs.length}</Num></span>
        <button className="btn ghost" type="button" onClick={onQuit}>יציאה</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>מצאו את שני הצדדים של כל זוג: מושג והפרט שמתאים לו לפי החוברת.</p>
      <div className="memory-grid" role="group" aria-label="לוח זיכרון">
        {round.cards.map((c, i) => {
          const isMatched = matched.includes(c.pairId);
          const faceUp = isMatched || open.includes(c.id);
          return (
            <button key={c.id} type="button" className={`mem-card${faceUp ? ' up' : ''}${isMatched ? ' done' : ''}`} onClick={() => flip(c.id)} disabled={isMatched}
              aria-label={faceUp ? c.text : `קלף מוסתר ${i + 1}`} data-testid={`mem-${c.pairId}`} data-side={c.side} data-card={c.id}>
              <span aria-hidden={!faceUp}>{faceUp ? c.text : '?'}</span>
            </button>
          );
        })}
      </div>
      {found.length > 0 && (
        <div className="stack tight" data-testid="memory-found">
          <b>זוגות שנמצאו</b>
          <ul className="list-plain">
            {found.map((p) => (
              <li key={p.id} className="row between"><span>{p.left} ← {p.right}</span><button className="btn ghost" type="button" onClick={() => setSrc(bank.find((q) => q.id === p.questionId) ?? null)}>המקור</button></li>
            ))}
          </ul>
        </div>
      )}
      {src && <SourceModal refs={src.refs} onClose={() => setSrc(null)} />}
    </div>
  );
}
