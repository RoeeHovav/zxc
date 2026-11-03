import { describe, expect, it } from 'vitest';
import { bookSegments, emphasisParts, groupBookBlocks, tidyBookText, type BookUnit } from '../../src/domain/bookText';

describe('tidyBookText: layout artefacts only, never words', () => {
  it('fixes spacing around punctuation and brackets', () => {
    expect(tidyBookText('בירושלים ,היישוב הגדול')).toBe('בירושלים, היישוב הגדול');
    expect(tidyBookText('זאבי( 1926-2001), היה אלוף')).toBe('זאבי (1926-2001), היה אלוף');
    expect(tidyBookText('על- פי החוק ( בקצרה )')).toBe('על-פי החוק (בקצרה)');
  });
  it('repairs a closing quote that the PDF glued to the next word, but leaves gershayim and unpairable quotes alone', () => {
    expect(tidyBookText('למושג "יהדות "שלוש "פנים" מרכזיות:')).toBe('למושג "יהדות" שלוש "פנים" מרכזיות:');
    expect(tidyBookText('בצה"ל ובמשטרה')).toBe('בצה"ל ובמשטרה');
    expect(tidyBookText('אמר "שלום לכולם" והלך')).toBe('אמר "שלום לכולם" והלך');
    expect(tidyBookText('ציטוט "פתוח בלי סגירה')).toBe('ציטוט "פתוח בלי סגירה');
  });
  it('moves a stray space before a final or standalone punctuation mark', () => {
    expect(tidyBookText('ברוב התחומים .')).toBe('ברוב התחומים.');
    expect(tidyBookText('ראשון , שני . שלישי')).toBe('ראשון, שני. שלישי');
  });
  it('removes invisible bidi marks and collapses whitespace', () => {
    expect(tidyBookText('‫שלום‬   עולם‏')).toBe('שלום עולם');
  });
  it('keeps numbers, ranges and decimals intact', () => {
    expect(tidyBookText('בשנים 1948-1949, כ-1,000 איש, 3.5%')).toBe('בשנים 1948-1949, כ-1,000 איש, 3.5%');
  });
  it('never changes the letters or digits of the text', () => {
    const raw = 'הנוצרים בישראל מרוכזים בגליל ובאזור ירושלים ,היישוב( 2009 ) על- פי';
    const letters = (s: string) => s.replace(/[^א-ת0-9]/g, '');
    expect(letters(tidyBookText(raw))).toBe(letters(raw));
  });
});

describe('emphasisParts', () => {
  it('marks printed-bold terms and skips terms that are not found or too short', () => {
    expect(emphasisParts('המשטר הדמוקרטי הוא יסוד', ['הדמוקרטי'])).toEqual([{ text: 'המשטר ', bold: false }, { text: 'הדמוקרטי', bold: true }, { text: ' הוא יסוד', bold: false }]);
    expect(emphasisParts('טקסט פשוט', ['לא קיים'])).toEqual([{ text: 'טקסט פשוט', bold: false }]);
    expect(emphasisParts('אב אב', ['אב'])).toEqual([{ text: 'אב אב', bold: false }]);
  });
  it('merges overlapping terms', () => {
    const p = emphasisParts('עקרון הפרדת הרשויות', ['עקרון הפרדת', 'הפרדת הרשויות']);
    expect(p.filter((x) => x.bold).map((x) => x.text)).toEqual(['עקרון הפרדת הרשויות']);
  });
});

describe('groupBookBlocks / bookSegments', () => {
  const units: BookUnit[] = [
    { id: 'p001.u01', page: 1, kind: 'heading', h: 2, text: 'כותרת הפרק' },
    { id: 'p001.u02', page: 1, kind: 'paragraph', text: 'פסקה ראשונה ,עם טקסט.', bold: ['פסקה ראשונה'] },
    { id: 'p001.v1', page: 1, kind: 'figure_text', figure: 'p001-f1', text: 'טקסט מתוך האיור' },
    { id: 'p001.u03', page: 1, kind: 'thought_box', text: 'שאלה למחשבה' },
    { id: 'p001.u04', page: 1, kind: 'table_row', table: 'T1', row: 1, cells: ['א', 'ב'], text: 'א ב' },
    { id: 'p001.u05', page: 1, kind: 'table_row', table: 'T1', row: 2, cells: ['ג', 'ד'], text: 'ג ד' },
    { id: 'p002.u01', page: 2, kind: 'paragraph', text: 'פסקה בעמוד שני.' },
    { id: 'p002.u02', page: 2, kind: 'table_row', table: 'T2', row: 1, cells: ['כיתוב תמונה'], text: 'כיתוב תמונה' },
  ];
  it('builds typed blocks with page markers, one table for consecutive rows, and a one-column table as caption', () => {
    const b = groupBookBlocks(units, { pageMarkers: true });
    expect(b.map((x) => x.type)).toEqual(['page', 'heading', 'p', 'figure', 'thought', 'table', 'page', 'p', 'caption']);
    expect((b[5] as { rows: string[][] }).rows).toEqual([['א', 'ב'], ['ג', 'ד']]);
    expect((b[2] as { text: string }).text).toBe('פסקה ראשונה, עם טקסט.');
  });
  it('without page markers there are none', () => {
    expect(groupBookBlocks(units).some((x) => x.type === 'page')).toBe(false);
  });
  it('narrator: headings, paragraphs, figure text and table rows are spoken in order; page markers and thought-less blocks are not duplicated', () => {
    const segs = bookSegments(groupBookBlocks(units, { pageMarkers: true }), 'orig:t');
    const texts = segs.map((s) => s.text).join(' | ');
    expect(texts.indexOf('כותרת הפרק')).toBeLessThan(texts.indexOf('פסקה ראשונה'));
    expect(texts).toContain('טקסט מתוך האיור');
    expect(texts).toContain('א, ב');
    expect(segs.every((s) => s.blockId?.startsWith('orig:t:'))).toBe(true);
    expect(segs.find((s) => s.text.includes('כותרת'))!.pauseAfterMs).toBeGreaterThan(segs.find((s) => s.text.includes('פסקה ראשונה'))!.pauseAfterMs - 1);
  });
});
