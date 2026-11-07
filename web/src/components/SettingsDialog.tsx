import React, { useEffect, useMemo, useState } from "react";
import { api, Voice } from "../api";
import { useStore } from "../store";
import { KIND_LABELS } from "../i18n";
import { Icon } from "./Icons";

const LANG_NAMES: Record<string, string> = {
  he: "Hebrew / עברית",
  en: "English",
  ar: "Arabic",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  ru: "Russian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  uk: "Ukrainian",
  el: "Greek",
  hi: "Hindi",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
};

export default function SettingsDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { settings, update, app, load, t, lang, toast } = useStore();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [azureKey, setAzureKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [cache, setCache] = useState<{ bytes: number; limit: number } | null>(null);
  const [extraLang, setExtraLang] = useState("");

  useEffect(() => {
    api.voices().then((r) => setVoices(r.voices));
    api.cacheInfo().then(setCache);
  }, []);

  const byLang = useMemo(() => {
    const m = new Map<string, Voice[]>();
    const multilingual = voices.filter((v) => v.lang === "mul"); // e.g. Gemini voices read every language
    for (const v of voices) {
      if (v.lang === "mul") continue;
      const arr = m.get(v.lang) || [];
      arr.push(v);
      m.set(v.lang, arr);
    }
    for (const lg of Array.from(new Set(["he", "en", ...Object.keys(LANG_NAMES)]))) m.set(lg, [...(m.get(lg) || []), ...multilingual]);
    // The "Multilingual" Microsoft voices are not tied to one language; offer them for Hebrew too (experimental).
    m.set("he", [...(m.get("he") || []), ...(m.get("en") || []).filter((v) => v.provider === "edge" && v.id.includes("Multilingual"))]);
    return m;
  }, [voices]);

  if (!settings || !app) return null;
  const voiceLangs = Array.from(new Set(["he", "en", ...Object.keys(settings.voices || {})]));
  const he = lang === "he";

  const set = async (patch: any) => {
    await update(patch);
    onChanged?.();
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={t.settings} data-testid="settings">
        <header>
          <Icon name="settings" /> <span className="grow">{t.settings}</span>
          <button className="icon-btn" onClick={onClose} aria-label={t.close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="content">
          <div className="section-title">{he ? "קולות לפי שפה" : "Narrator voice per language"}</div>
          {voiceLangs.map((lg) => {
            const opts = (byLang.get(lg) || []).slice().sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
            return (
              <div className="field" key={lg}>
                <label>{LANG_NAMES[lg] || lg}</label>
                <select value={settings.voices[lg] || ""} onChange={(e) => set({ voices: { ...settings.voices, [lg]: e.target.value } })} data-testid={`voice-${lg}`}>
                  {!settings.voices[lg] && <option value="">(automatic)</option>}
                  {opts.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.locale} {v.gender ? `· ${v.gender}` : ""} {v.provider !== "edge" ? `[${v.provider}]` : ""}{lg === "he" && v.lang === "en" ? (he ? " (ניסיוני בעברית)" : " (experimental for Hebrew)") : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <select value={extraLang} onChange={(e) => setExtraLang(e.target.value)}>
              <option value="">{he ? "הוספת שפה…" : "Add a language…"}</option>
              {Array.from(byLang.keys())
                .filter((l) => !voiceLangs.includes(l))
                .sort()
                .map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l] || l}
                  </option>
                ))}
            </select>
            <button className="btn" disabled={!extraLang} onClick={() => extraLang && set({ voices: { ...settings.voices, [extraLang]: byLang.get(extraLang)?.[0]?.id || "" } }).then(() => setExtraLang(""))}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.switch_voice_for_foreign} onChange={(e) => set({ switch_voice_for_foreign: e.target.checked })} />
            {he ? "החלפת קול למשפטים שלמים בשפה אחרת (מונחים בודדים נשארים בקול הראשי)" : "Switch voice for whole sentences in another language (single foreign terms stay in the main voice)"}
          </label>

          <div className="section-title">{he ? "מה להקריא" : "What to read aloud"}</div>
          <div className="grid2">
            {Object.keys(KIND_LABELS).map((k) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={settings.read_kinds[k] !== false} onChange={(e) => set({ read_kinds: { ...settings.read_kinds, [k]: e.target.checked } })} />
                {KIND_LABELS[k][he ? 1 : 0]}
              </label>
            ))}
          </div>
          <div className="grid2" style={{ marginTop: 6 }}>
            <label className="check">
              <input type="checkbox" checked={settings.skip_citations} onChange={(e) => set({ skip_citations: e.target.checked })} />
              {he ? "דילוג על הפניות [12]" : "Skip citation markers like [12]"}
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.skip_footnote_marks} onChange={(e) => set({ skip_footnote_marks: e.target.checked })} />
              {he ? "דילוג על סימוני הערות שוליים" : "Skip footnote reference marks"}
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.verbalize_math} onChange={(e) => set({ verbalize_math: e.target.checked })} />
              {he ? "הקראת נוסחאות במילים" : "Speak math notation as words"}
            </label>
          </div>

          <div className="section-title">{he ? "קצב והפסקות" : "Pacing"}</div>
          <div className="field">
            <label>
              {he ? "אורך ההפסקות בין פסקאות וכותרות" : "Pauses between paragraphs and headings"}: {settings.pause_scale.toFixed(1)}×
            </label>
            <input type="range" min={0} max={2.5} step={0.1} value={settings.pause_scale} onChange={(e) => set({ pause_scale: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>{he ? "דילוג אחורה/קדימה (שניות)" : "Skip back/forward (seconds)"}</label>
            <select value={settings.skip_seconds} onChange={(e) => set({ skip_seconds: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{he ? "גודל קטע לסינתזה (תווים)" : "Synthesis chunk size (characters)"}</label>
            <select value={settings.max_chunk_chars} onChange={(e) => set({ max_chunk_chars: Number(e.target.value) })}>
              {[400, 600, 900, 1300, 1800].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="hint">{he ? "קטעים ארוכים שומרים על רצף טבעי; קצרים מתחילים מהר יותר." : "Longer chunks keep prosody continuous; shorter ones start faster."}</div>
          </div>

          <div className="section-title">{he ? "תצוגה" : "Display"}</div>
          <div className="grid2">
            <div className="field">
              <label>{t.theme}</label>
              <select value={settings.theme} onChange={(e) => set({ theme: e.target.value })}>
                <option value="system">{t.system}</option>
                <option value="light">{t.light}</option>
                <option value="dark">{t.dark}</option>
              </select>
            </div>
            <div className="field">
              <label>{he ? "שפת הממשק" : "Interface language"}</label>
              <select value={settings.ui_lang} onChange={(e) => set({ ui_lang: e.target.value })}>
                <option value="auto">Auto</option>
                <option value="en">English</option>
                <option value="he">עברית</option>
              </select>
            </div>
            <div className="field">
              <label>{he ? "הדגשה" : "Highlight"}</label>
              <select value={settings.highlight} onChange={(e) => set({ highlight: e.target.value })}>
                <option value="word">{he ? "מילה + משפט" : "Word + sentence"}</option>
                <option value="sentence">{he ? "משפט בלבד" : "Sentence only"}</option>
              </select>
            </div>
            <label className="check" style={{ alignSelf: "end", marginBottom: 14 }}>
              <input type="checkbox" checked={settings.auto_scroll} onChange={(e) => set({ auto_scroll: e.target.checked })} />
              {t.autoScroll}
            </label>
          </div>

          <div className="section-title">{he ? "הכנת קריינות מראש" : "Narrating ahead"}</div>
          <div className="field">
            <label>
              {he ? "לפני ההשמעה הראשונה, להכין מראש" : "Before the first play, narrate up to"} <strong>{settings.buffer_percent ?? 0}%</strong>{" "}
              {he ? "מהמסמך (0 = להתחיל מיד)" : "of the document (0 = start at once)"}
            </label>
            <input type="range" min={0} max={100} step={5} value={settings.buffer_percent ?? 0} onChange={(e) => set({ buffer_percent: Number(e.target.value) })} data-testid="buffer-percent" />
            <label style={{ marginTop: 8 }}>
              {he ? "אבל לא להמתין יותר מכ-" : "but wait for no more than about"} <strong>{settings.buffer_minutes ?? 0}</strong> {he ? "דקות קריינות (0 = ללא הגבלה)" : "minutes of narration (0 = no limit)"}
            </label>
            <input type="range" min={0} max={60} step={5} value={settings.buffer_minutes ?? 0} onChange={(e) => set({ buffer_minutes: Number(e.target.value) })} data-testid="buffer-minutes" />
            <div className="muted small">
              {he
                ? "ההכנה ממשיכה ברקע גם בזמן ההשמעה, ואפשר ללחוץ ״התחל עכשיו״. קול עם מכסה חינמית קטנה (Gemini) לא מוכן מראש בכמות גדולה; לשם כך יש את הכפתור ״הכנת הכול״ בנגן, שממשיך לאט לאורך ימים."
                : "Preparing continues in the background while it plays, and you can press “Start now”. A voice with a small free allowance (Gemini) is not prepared in bulk before playing; use the player's “Prepare all” button instead, which carries on slowly over days."}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.free_fallback !== false} onChange={(e) => set({ free_fallback: e.target.checked })} />
            {he ? "כשהמכסה החינמית של קול מוגבל (Gemini) נגמרת, להמשיך עם הקול החינמי של מיקרוסופט" : "When a limited voice runs out, carry on with the free Microsoft voice"}
          </label>

          <div className="section-title">{he ? "עוזר ההגייה (עברית)" : "Pronunciation assistant (Hebrew)"}</div>
          <label className="check">
            <input type="checkbox" checked={settings.nakdan !== false} onChange={(e) => set({ nakdan: e.target.checked })} data-testid="nakdan" />
            {he
              ? "ניקוד לכל מילה בעזרת ה״נקדן״ החינמי של דיקטה (dicta.org.il), כדי שהקול יגה נכון גם מילים רגילות. ללא מפתח; נשלח טקסט בלבד."
              : "Vowel marks for every word from Dicta's free Nakdan (dicta.org.il), so the voice also says ordinary words right. No key needed; only text is sent."}
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.ai_pronunciation !== false} onChange={(e) => set({ ai_pronunciation: e.target.checked })} data-testid="ai-pronunciation" />
            {he
              ? "לתת לבינה מלאכותית (Gemini) להכריע, לפי המשפט כולו, איך לקרוא מילים דו-משמעיות (שמן, ספר, מלך…) ולתת לקול ניקוד רק עליהן"
              : "Let Gemini decide from the whole sentence how ambiguous words (שמן, ספר, מלך…) are read, and give the voice vowel marks for only those words"}
          </label>
          <div className="field">
            <label>{he ? "מודל Gemini לעוזר ההגייה (ריק = אוטומטי)" : "Gemini model for the assistant (empty = automatic)"}</label>
            <input placeholder="e.g. gemini-3.8-flash" value={settings.pronunciation_model || ""} onChange={(e) => set({ pronunciation_model: e.target.value.trim() })} data-testid="pron-model" />
          </div>
          <div className="muted small" style={{ marginBottom: 8 }}>
            {app.secrets.gemini_api_key
              ? he
                ? "משתמש במפתח ה-Gemini שלכם (טקסט בלבד, מכסה חינמית גדולה בהרבה מזו של הקול). הטקסט המוצג לא משתנה, ופסקה שכבר עובדה נשמרת במחשב. ניתן לבדוק ב״מעבדת הקולות״."
                : "Uses your Gemini key (text only; its free allowance is much larger than the voice's). The displayed text never changes, and each passage is remembered on this computer. Try it in the Voice lab."
              : he
                ? "דורש מפתח Gemini חינמי (ראו ״מנועי דיבור״ למטה)."
                : "Needs your free Gemini key (see “Speech engines” below)."}
          </div>

          <div className="section-title">{he ? "בדיקות הבנה" : "Comprehension checkpoints"}</div>
          <div className="field">
            <label>{he ? "מתי לשאול" : "When to ask"}</label>
            <select value={settings.quiz_mode || "off"} onChange={(e) => set({ quiz_mode: e.target.value as any })} data-testid="quiz-mode-setting">
              <option value="off">{he ? "אף פעם" : "Never"}</option>
              <option value="section">{he ? "בסוף כל פרק (כשיש מספיק חומר)" : "At the end of each section (when there is enough to ask about)"}</option>
              <option value="page">{he ? "בסוף כל עמוד" : "At the end of each page"}</option>
              <option value="minutes">{he ? "כל כמה דקות הקשבה" : "Every few minutes of listening"}</option>
            </select>
          </div>
          {settings.quiz_mode === "minutes" && (
            <div className="field">
              <label>{he ? `כל ${settings.quiz_minutes || 6} דקות` : `Every ${settings.quiz_minutes || 6} minutes`}</label>
              <input type="range" min={3} max={15} step={1} value={settings.quiz_minutes || 6} onChange={(e) => set({ quiz_minutes: Number(e.target.value) })} />
            </div>
          )}
          <div className="field">
            <label>{he ? "סוג השאלות" : "Kind of questions"}</label>
            <select value={settings.quiz_style || "mixed"} onChange={(e) => set({ quiz_style: e.target.value as any })} data-testid="quiz-style">
              <option value="mixed">{he ? "שתי שאלות רב־ברירה ושאלה פתוחה אחת" : "Two multiple-choice and one open question"}</option>
              <option value="recall">{he ? "שאלות פתוחות בלבד — המחמיר ביותר, אי אפשר לנחש" : "Open questions only — the strictest, cannot be guessed"}</option>
              <option value="choice">{he ? "רב־ברירה בלבד — מהיר" : "Multiple choice only — quick"}</option>
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={!!settings.quiz_read_aloud} onChange={(e) => set({ quiz_read_aloud: e.target.checked })} />
            {he ? "להקריא כל שאלה בקול" : "Read each question aloud"}
          </label>
          <div className="muted small" style={{ marginBottom: 8 }}>
            {he
              ? "אחרי קטע האזנה מתעכבת הקריאה ושואלים שתי שאלות רב־ברירה ושאלה אחת פתוחה על מה ששמעתם (או רק שאלות פתוחות, לפי הבחירה). שאלות רב־ברירה קל לנחש גם בלי להקשיב, בעיקר בחומר מוכר; שאלה פתוחה אי אפשר לנחש. טעיתם? אפשר לשמוע שוב את המשפט שבו נאמרה התשובה, והשאלה חוזרת בבדיקה הבאה. נשלח ל-Gemini רק הטקסט של הקטע ששמעתם (באישורכם); התשובות והציונים נשארים במחשב. כל בדיקה משתמשת בשתי בקשות מהמכסה החינמית של Gemini."
              : "After a stretch of listening the reading waits and you get two multiple-choice questions and one open question about what you heard (or open questions only, if you choose). Multiple choice can be guessed even without listening, especially on familiar material; an open question cannot. Missed one? Hear the sentence where the answer was said; the question comes back at the next checkpoint. Only the text of the stretch you listened to is sent to Gemini (with your permission); answers and scores stay on this computer. Each checkpoint uses two requests of your free Gemini allowance."}
          </div>

          <div className="section-title">{he ? "מנועי דיבור" : "Speech engines"}</div>
          {app.providers.map((p) => (
            <div className="provider-card" key={p.id}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong style={{ flex: 1 }}>{p.name}</strong>
                {p.free && <span className="pill ok">free</span>}
                <span className={`pill ${p.available ? "ok" : "warn"}`}>{p.available ? "ready" : "not configured"}</span>
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {p.privacy}
              </div>
              <div className="muted small">Status: {p.verified}</div>
              {!p.available && p.reason && <div className="small" style={{ color: "var(--warn)" }}>{p.reason}</div>}
              {p.cloud && (
                <div className="small" style={{ marginTop: 4 }}>
                  {settings.cloud_consent[p.id] ? (
                    <>
                      ✓ {he ? "אושר שימוש" : "Consent given"}{" "}
                      <button
                        className="btn"
                        style={{ padding: "1px 8px" }}
                        onClick={() => {
                          const c = { ...settings.cloud_consent };
                          delete c[p.id];
                          set({ cloud_consent: c });
                        }}
                      >
                        {he ? "ביטול" : "Revoke"}
                      </button>
                    </>
                  ) : (
                    <span className="muted">{he ? "יתבקש אישור לפני השימוש הראשון" : "You will be asked before first use"}</span>
                  )}
                </div>
              )}
              {p.id === "gemini" && (
                <div style={{ marginTop: 8 }}>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    {he
                      ? "קול של מודל שפה: קורא את המשפט כולו ולכן בוחר את המילה הנכונה בעברית. מפתח חינמי: aistudio.google.com ← Get API key. אחרי השמירה בחרו קול Gemini (למשל Kore או Charon) בעברית ובאנגלית למעלה. המכסה החינמית של גוגל לדיבור קטנה: כשהיא נגמרת התוכנה ממשיכה בקול החינמי של מיקרוסופט וחוזרת ל-Gemini כשהמכסה מתחדשת (בדרך כלל סביב חצות בשעון האוקיינוס השקט). הכפתור ״הכנת הכול״ בנגן מקריין את המסמך בקול Gemini לאט, לאורך ימים, כל עוד התוכנה פתוחה. ההדגשה היא ברמת משפט."
                      : "A language-model voice: it reads the whole sentence, so it picks the right Hebrew word from context. Get a free key at aistudio.google.com → Get API key, paste it here, then choose a Gemini voice (e.g. Kore or Charon) for Hebrew and English above. Google's free allowance for speech is small: when it runs out the app carries on with the free Microsoft voice and switches back when the allowance refills (usually around midnight Pacific time). The player's “Prepare all” button narrates the document in the Gemini voice slowly over days while the app stays open. Highlighting is per sentence."}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input
                      placeholder={app.secrets.gemini_api_key ? "•••••• (key saved)" : "Gemini API key"}
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      style={{ flex: 1, minWidth: 180 }}
                      data-testid="gemini-key"
                    />
                    <button
                      className="btn"
                      onClick={async () => {
                        await api.putSecret("gemini_api_key", geminiKey);
                        setGeminiKey("");
                        await load();
                        setVoices((await api.voices()).voices);
                        toast("Saved");
                      }}
                    >
                      {t.save}
                    </button>
                    {app.secrets.gemini_api_key && (
                      <button
                        className="btn"
                        onClick={async () => {
                          await api.putSecret("gemini_api_key", "");
                          await load();
                          setVoices((await api.voices()).voices);
                        }}
                      >
                        {he ? "הסרת המפתח" : "Remove key"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {p.id === "azure" && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <input placeholder={app.secrets.azure_key ? "•••••• (key saved)" : "Azure Speech key"} type="password" value={azureKey} onChange={(e) => setAzureKey(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
                  <input placeholder="Region (e.g. westeurope)" value={settings.azure_region} onChange={(e) => set({ azure_region: e.target.value })} style={{ width: 170 }} />
                  <button
                    className="btn"
                    onClick={async () => {
                      await api.putSecret("azure_key", azureKey);
                      setAzureKey("");
                      await load();
                      toast("Saved");
                    }}
                  >
                    {t.save}
                  </button>
                </div>
              )}
            </div>
          ))}

          <TeacherSettings />

          <div className="section-title">OCR</div>
          <div className="small">
            {app.ocr.available ? (
              <>✓ Tesseract language data: {app.ocr.languages.join(", ")} <span className="muted">({app.ocr.tessdata})</span></>
            ) : (
              <span style={{ color: "var(--warn)" }}>
                {he ? "נתוני OCR לא נמצאו. הריצו את Setup שוב, או התקינו Tesseract." : "OCR language data not found. Re-run the Windows setup (it downloads Hebrew + English OCR data), or install Tesseract."}
              </span>
            )}
          </div>

          <div className="section-title">{he ? "מטמון שמע" : "Audio cache"}</div>
          <div className="small" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {cache && `${(cache.bytes / (1 << 20)).toFixed(1)} MB / ${(cache.limit / (1 << 30)).toFixed(0)} GB`}
            <button
              className="btn"
              onClick={async () => {
                if (!confirm("Delete all cached narration audio?")) return;
                await api.clearCache();
                setCache(await api.cacheInfo());
              }}
            >
              {he ? "ניקוי" : "Clear"}
            </button>
          </div>
          <div className="muted small" style={{ marginTop: 16 }}>
            {t.appName} {app.version} · data: {app.data_dir}
          </div>
        </div>
        <footer>
          <button className="btn primary" onClick={onClose}>
            {t.close}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TeacherSettings() {
  const { settings, update, app, load, lang, toast } = useStore();
  const [status, setStatus] = useState<string>("");
  const [key, setKey] = useState("");
  if (!settings || !app) return null;
  const he = lang === "he";
  const test = async () => {
    setStatus("…");
    const r = await api.llmStatus();
    setStatus(r.ok ? `✓ ${r.models?.length || 0} model(s): ${(r.models || []).slice(0, 8).join(", ")}` : `✗ ${r.error}`);
  };
  return (
    <>
      <div className="section-title">{he ? "מצב מורה (אופציונלי)" : "Teacher Mode (optional)"}</div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {he
          ? "בסוף כל סעיף, מודל שפה מסביר את החומר במילים פשוטות. ההסבר מסומן בבירור ואינו משנה את המסמך. אפשרות חינמית: התקינו Ollama (ollama.com) והריצו למשל ollama pull gemma3:12b או aya-expanse:8b (תמיכה טובה בעברית)."
          : "At the end of each section a language model explains the material in plain words. Explanations are clearly marked and never change the document. Free option: install Ollama (ollama.com) and run e.g. `ollama pull gemma3:12b` or `aya-expanse:8b` (good Hebrew support)."}
      </p>
      <label className="check">
        <input type="checkbox" checked={settings.teacher_mode} onChange={(e) => update({ teacher_mode: e.target.checked })} />
        {he ? "הסבר אוטומטי בסוף כל סעיף" : "Explain automatically at the end of each section"}
      </label>
      <div className="grid2" style={{ marginTop: 6 }}>
        <div className="field">
          <label>{he ? "כתובת השרת (OpenAI-compatible)" : "Endpoint (OpenAI-compatible)"}</label>
          <input value={settings.llm_base_url} onChange={(e) => update({ llm_base_url: e.target.value })} />
        </div>
        <div className="field">
          <label>{he ? "מודל" : "Model"}</label>
          <input value={settings.llm_model} placeholder="gemma3:12b" onChange={(e) => update({ llm_model: e.target.value })} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input type="password" placeholder={app.secrets.llm_api_key ? "•••••• (key saved)" : he ? "מפתח API (לא נדרש ל-Ollama)" : "API key (not needed for Ollama)"} value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <button
          className="btn"
          onClick={async () => {
            await api.putSecret("llm_api_key", key);
            setKey("");
            await load();
            toast("Saved");
          }}
        >
          {he ? "שמירה" : "Save"}
        </button>
        <button className="btn" onClick={test}>
          {he ? "בדיקת חיבור" : "Test connection"}
        </button>
      </div>
      {status && <div className="small" style={{ marginTop: 6 }}>{status}</div>}
    </>
  );
}
