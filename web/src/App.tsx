import React, { useEffect, useState } from "react";
import { useStore } from "./store";
import Library from "./components/Library";
import Reader from "./components/Reader";

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const { app, settings, load, lang, toasts } = useStore();
  const [err, setErr] = useState<string | null>(null);
  const hash = useHashRoute();

  useEffect(() => {
    load().catch((e) => setErr(String(e?.message || e)));
  }, []);

  useEffect(() => {
    const apply = () => {
      const pref = settings?.theme || "system";
      const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings?.theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);

  if (err)
    return (
      <div style={{ padding: 40 }}>
        <h2>Cannot reach the narrator service</h2>
        <p className="muted">{err}</p>
        <button className="btn" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  if (!app) return <div style={{ padding: 40 }} className="muted">Loading…</div>;

  const m = hash.match(/^#\/doc\/([^/?]+)/);
  return (
    <>
      {m ? <Reader key={m[1]} docId={m[1]} /> : <Library />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
