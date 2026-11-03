// Generates realistic PDF fixtures by printing HTML with Chromium (Skia PDF backend).
// Usage: node tests/fixtures/make_fixtures.cjs   (requires the 'playwright' package)
const { chromium } = require('playwright');
const path = require('path');
const OUT = __dirname;

const css = `
  @page { size: A4; margin: 22mm 18mm 22mm 18mm; }
  body { font-family: 'DejaVu Serif', 'Liberation Serif', serif; font-size: 11pt; line-height: 1.45; }
  h1 { font-size: 20pt; margin: 0 0 6pt; }
  h2 { font-size: 14pt; margin: 14pt 0 6pt; }
  p { margin: 0 0 8pt; text-align: justify; }
  .cols { column-count: 2; column-gap: 9mm; }
  .abstract { font-style: italic; margin-bottom: 12pt; }
  .fn { font-size: 8.5pt; border-top: 1px solid #999; margin-top: 10pt; padding-top: 4pt; }
  figure { margin: 8pt 0; break-inside: avoid; }
  figcaption { font-size: 9pt; }
`;

const lorem = (n, seed) => {
  const s = ["The method was evaluated on three independent datasets.", "Results indicate a consistent improvement over the baseline.",
    "However, the effect size varies considerably between conditions.", "We therefore report confidence intervals for every estimate.",
    "This observation motivates the analysis in the following section.", "Several limitations must be acknowledged before drawing conclusions.",
    "In particular, the sample was drawn from a single institution.", "Future work should replicate these findings in other settings."];
  let out = []; for (let i = 0; i < n; i++) out.push(s[(i + seed) % s.length]); return out.join(" ");
};

const en = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>Contextual Speech Synthesis for Study Materials</h1>
<p class="abstract">Abstract. Is it possible to read academic documents aloud naturally? We define natural narration as speech that a listener cannot distinguish from a human reader.</p>
<div class="cols">
<h2>1. Introduction</h2>
<p>Reading long documents aloud is demanding. ${lorem(6, 0)} Consider the equation x² + y² = z², which a narrator must speak as words rather than symbols.</p>
<p>${lorem(8, 2)} For example, e.g. and i.e. are abbreviations that should be expanded when spoken.</p>
<h2>2. Method</h2>
<p>We define the error rate as the fraction of mispronounced words. ${lorem(10, 4)}</p>
<ol><li>Extract text in reading order.</li><li>Normalize numbers, units and symbols.</li><li>Synthesize speech with word timing.</li></ol>
<figure><svg width="220" height="90"><rect x="5" y="5" width="210" height="80" fill="#cde" stroke="#345"/><text x="20" y="50" font-size="12">Pipeline diagram</text></svg>
<figcaption>Figure 1: Overview of the narration pipeline.</figcaption></figure>
<p>${lorem(14, 1)}</p>
<h2>3. Results</h2>
<p>The mean error decreased from 4.1% to 1.7% (p &lt; 0.01). ${lorem(16, 3)}</p>
<p>${lorem(18, 5)}</p>
<h2>4. Conclusion</h2>
<p>In conclusion, structure-aware preparation improves narration quality. ${lorem(12, 6)}</p>
</div>
<p class="fn">1 Footnote: all experiments were run on a standard laptop.</p>
</body></html>`;

const heCss = css.replace("'DejaVu Serif', 'Liberation Serif', serif", "'DejaVu Sans', 'Liberation Sans', 'FreeSans', sans-serif");
const heP = (n, seed) => {
  const s = ["הממצאים מצביעים על שיפור עקבי לאורך כל שלבי המחקר.", "עם זאת, יש לפרש את התוצאות בזהירות רבה.",
    "החוקרים השתמשו בשיטת machine learning כדי לנתח את הנתונים.", "ב-17 בספטמבר 1982 התקבלה ההחלטה הסופית.",
    "כ-2500 משתתפים נטלו חלק בסקר שנערך בשנת 2019.", "המג\"ד והמ\"פ הציגו את התוכנית לרמטכ\"ל ולקצינים בבה\"ד 1.",
    "שאלת המחקר המרכזית הייתה כיצד משפיעה הסביבה על הלמידה?", "לסיכום, התוצאות תומכות בהשערה המקורית."];
  let out = []; for (let i = 0; i < n; i++) out.push(s[(i + seed) % s.length]); return out.join(" ");
};
const he = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>${heCss}</style></head><body>
<h1>מבוא לחקר הלמידה</h1>
<p>הספר שקניתי אתמול עוסק בלמידה. ${heP(6, 0)}</p>
<h2>פרק 1: רקע תיאורטי</h2>
<p>הַסֵּפֶר הַזֶּה מְנֻקָּד בַּחֶלְקוֹ. ${heP(10, 2)}</p>
<ul><li>הגדרת הבעיה ושאלות המחקר.</li><li>סקירת הספרות בנושא Deep Learning.</li><li>תיאור שיטת המחקר.</li></ul>
<h2>פרק 2: שיטה</h2>
<p>${heP(30, 1)}</p>
<p>${heP(26, 3)}</p>
<h2>פרק 3: דיון</h2>
<p>${heP(12, 5)} התוכנה Microsoft Word שימשה לעריכת המסמך.</p>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, html, footer] of [["en_academic.pdf", en, "Page"], ["he_mixed.pdf", he, "עמוד"]]) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: path.join(OUT, name), format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#777">${name === 'he_mixed.pdf' ? 'כתב עת לחינוך — גיליון 7' : 'Journal of Narration Studies — Vol. 7'}</div>`,
      footerTemplate: `<div style="font-size:9px;width:100%;text-align:center"><span class="pageNumber"></span></div>`,
      margin: { top: '22mm', bottom: '22mm', left: '18mm', right: '18mm' },
    });
    console.log('wrote', name);
  }
  await browser.close();
})();
