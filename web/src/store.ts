import { create } from "zustand";
import { api, AppState, Settings } from "./api";
import { resolveLang, STRINGS, Strings } from "./i18n";

interface Toast {
  id: number;
  msg: string;
  kind: "info" | "error";
}

interface Store {
  app: AppState | null;
  settings: Settings | null;
  lang: "en" | "he";
  t: Strings;
  toasts: Toast[];
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  toast: (msg: string, kind?: "info" | "error") => void;
}

let toastId = 0;

export const useStore = create<Store>((set, get) => ({
  app: null,
  settings: null,
  lang: resolveLang("auto"),
  t: STRINGS[resolveLang("auto")],
  toasts: [],
  load: async () => {
    const app = await api.state();
    const lang = resolveLang(app.settings.ui_lang);
    set({ app, settings: app.settings, lang, t: STRINGS[lang] });
  },
  update: async (patch) => {
    const prev = get().settings;
    if (prev) set({ settings: { ...prev, ...patch } as Settings });
    const s = await api.putSettings(patch);
    const lang = resolveLang(s.ui_lang);
    set({ settings: s, lang, t: STRINGS[lang], app: get().app ? { ...get().app!, settings: s } : null });
  },
  toast: (msg, kind = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, msg, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), kind === "error" ? 7000 : 3500);
  },
}));
