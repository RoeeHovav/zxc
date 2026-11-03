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
  const [cache, setCache] = useState<{ bytes: number; limit: number } | null>(null);
  const [extraLang, setExtraLang] = useState("");

  useEffect(() => {
    api.voices().then((r) => setVoices(r.voices));
    api.cacheInfo().then(setCache);
  }, []);

  const byLang = useMemo(() => {
    const m = new Map<string, Voice[]>();
    for (const v of voices) {
      const arr = m.get(v.lang) || [];
      arr.push(v);
      m.set(v.lang, arr);
    }
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
                      {v.name} — {v.locale} {v.gender ? `· ${v.gender}` : ""} {v.provider !== "edge" ? `[${v.provider}]` : ""}
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
