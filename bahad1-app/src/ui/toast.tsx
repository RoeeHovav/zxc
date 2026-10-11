import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ACHIEVEMENTS } from '../domain/xp';

const Ctx = createContext<{ toast: (m: string) => void; achieved: (ids: string[]) => void }>({ toast: () => {}, achieved: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msgs, setMsgs] = useState<{ id: number; text: string }[]>([]);
  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setMsgs((m) => [...m, { id, text }]);
    setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 4200);
  }, []);
  const achieved = useCallback((ids: string[]) => {
    for (const id of ids) { const a = ACHIEVEMENTS.find((x) => x.id === id); if (a) toast(`🏅 הישג חדש: ${a.title}`); }
  }, [toast]);
  return (
    <Ctx.Provider value={{ toast, achieved }}>
      {children}
      <div className="toast-wrap" aria-live="polite" data-testid="toasts">{msgs.map((m) => <div className="toast" key={m.id}>{m.text}</div>)}</div>
    </Ctx.Provider>
  );
}
