import { useEffect, useMemo, useState } from 'react';
import { advanceFlashQueue, type FlashCard } from '../../domain/games';
import { Num, Progress } from '../components/common';
import { SourceModal } from '../components/SourceModal';

/** Self-check cards. Nothing here is graded and no XP is given (that stays reserved for strict, independent answers):
 *  think of the answer, flip, and tell yourself honestly whether you knew it; cards you did not know come back later in the session. */
export function Flashcards({ deck, onQuit }: { deck: FlashCard[]; onQuit: () => void }) {
  const [queue, setQueue] = useState<string[]>(() => deck.map((c) => c.id));
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [again, setAgain] = useState(0);
  const [src, setSrc] = useState<FlashCard | null>(null);
  const byId = useMemo(() => new Map(deck.map((c) => [c.id, c])), [deck]);
  const card = queue.length ? byId.get(queue[0])! : null;

  const rate = (k: boolean) => {
    if (!card) return;
    if (k) setKnown((n) => n + 1); else setAgain((n) => n + 1);
    setQueue((q) => advanceFlashQueue(q, k));
    setFlipped(false);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!card) return;
      if (e.key === ' ' || e.key === 'Enter') { if (t?.tagName === 'BUTTON') return; e.preventDefault(); setFlipped((f) => !f); }
      if (flipped && e.key === '1') rate(true);
      if (flipped && e.key === '2') rate(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, flipped]);

  if (!card) {
    return (
      <div className="card stack fade-in center" style={{ alignItems: 'center' }} data-testid="flash-end">
        <h2>סיימתם את החפיסה 🎉</h2>
        <p>ידעתם <b><Num>{known}</Num></b> כרטיסים{again > 0 && <>; <b><Num>{again}</Num></b> פעמים חזרתם על כרטיס שעוד לא ידעתם</>}.</p>
        <button className="btn primary" type="button" onClick={onQuit}>חזרה למשחקים</button>
      </div>
    );
  }
  return (
    <div className="card stack fade-in game-run" data-testid="game-flash">
      <div className="game-hud row between">
        <span className="chip">נשארו <Num>{queue.length}</Num> כרטיסים</span>
        <span className="muted small">ידעתי: <Num>{known}</Num></span>
        <button className="btn ghost" type="button" onClick={onQuit}>יציאה</button>
      </div>
      <Progress value={deck.length ? known / deck.length : 0} gold />
      <div className={`flash-card${flipped ? ' flipped' : ''}`} data-testid="flash-card">
        <div className="front" style={{ whiteSpace: 'pre-line' }}>{card.front}</div>
        {flipped && <div className="back" data-testid="flash-back"><div className="answer-box">{card.back}</div><div className="muted small">{card.question.explanation}</div></div>}
      </div>
      {!flipped ? (
        <div><button className="btn primary big" type="button" onClick={() => setFlipped(true)} data-testid="flash-flip">הצגת התשובה</button> <span className="muted small">(רווח / Enter)</span></div>
      ) : (
        <div className="row">
          <button className="btn primary" type="button" onClick={() => rate(true)} data-testid="flash-known">ידעתי (1)</button>
          <button className="btn" type="button" onClick={() => rate(false)} data-testid="flash-again">עוד לא (2)</button>
          <button className="btn ghost" type="button" onClick={() => setSrc(card)}>המקור בחוברת</button>
        </div>
      )}
      {src && <SourceModal refs={src.question.refs} onClose={() => setSrc(null)} />}
    </div>
  );
}
