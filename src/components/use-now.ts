"use client";
import * as React from "react";

const subscribe = (cb: () => void) => {
  const t = setInterval(cb, 30000);
  return () => clearInterval(t);
};
// Rounded to the minute so the snapshot is stable between renders.
const getSnapshot = () => Math.floor(Date.now() / 60000) * 60000;
const getServerSnapshot = () => null;

/** Current time (minute resolution) on the client; null during SSR so markup matches. */
export function useNow(): number | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const noop = () => () => {};
/** True after hydration. */
export function useMounted() {
  return React.useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
