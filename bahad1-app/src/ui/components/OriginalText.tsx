import { Fragment } from 'react';
import { Speakable } from '../../app/speech';
import { emphasisParts, blockSpeechId, type BookBlock } from '../../domain/bookText';
import { figureUrl } from '../../content/loader';

function Emph({ text, bold }: { text: string; bold?: string[] }) {
  return <>{emphasisParts(text, bold).map((p, i) => (p.bold ? <strong key={i} className="book-bold">{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}</>;
}

/** The book's own text, block by block (headings, paragraphs, boxes, tables, figures). Every block lights up while the narrator reads it. */
export function OriginalText({ blocks, prefix, onFigure }: { blocks: BookBlock[]; prefix: string; onFigure: (figureId: string) => void }) {
  return (
    <div className="book-text" data-testid="original-text">
      {blocks.map((b) => {
        const id = blockSpeechId(prefix, b);
        switch (b.type) {
          case 'page': return <div key={b.id} className="book-page-marker" id={`page-${b.page}`} data-testid="page-marker">עמוד <span className="num">{b.page}</span></div>;
          case 'heading': return <Speakable key={b.id} as={b.level === 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4'} id={id} className={`book-h l${b.level}`}>{b.text}</Speakable>;
          case 'p': return <Speakable key={b.id} as="p" id={id} className="book-p" data-unit={b.id}><Emph text={b.text} bold={b.bold} /></Speakable>;
          case 'epigraph': return <Speakable key={b.id} as="blockquote" id={id} className="book-epigraph">{b.text}</Speakable>;
          case 'box': return <Speakable key={b.id} as="div" id={id} className="book-box"><Emph text={b.text} bold={b.bold} /></Speakable>;
          case 'note': return <Speakable key={b.id} as="div" id={id} className="book-box"><Emph text={b.text} bold={b.bold} /></Speakable>;
          case 'thought': return <Speakable key={b.id} as="div" id={id} className="book-thought"><span className="chip">למחשבה – חומר משלים, לא חומר למבחן</span> {b.text}</Speakable>;
          case 'caption': return <Speakable key={b.id} as="figcaption" id={id} className="book-caption">{b.text}</Speakable>;
          case 'table': return (
            <Speakable key={b.id} as="div" id={id} className="book-table-wrap"><table className="t"><tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></Speakable>
          );
          case 'figure': return (
            <figure key={b.id} className="fig book-fig" data-testid="book-figure">
              {b.figure && <img src={figureUrl(b.figure)} alt="איור מקורי מהחוברת" onClick={() => onFigure(b.figure)} loading="lazy" />}
              <figcaption className="muted small">איור מקורי מהחוברת (לחצו להגדלה)</figcaption>
              {b.text && <Speakable as="div" id={id} className="book-fig-text"><span className="chip">הטקסט שבתוך האיור</span> {b.text}</Speakable>}
            </figure>
          );
        }
      })}
    </div>
  );
}
