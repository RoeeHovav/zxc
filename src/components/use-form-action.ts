"use client";
import * as React from "react";

/**
 * Like useActionState, but submits via onSubmit so the browser does not reset
 * the form after the action completes (React 19 resets uncontrolled fields on
 * `<form action>`), which would wipe user input when validation fails.
 */
export function useFormAction<S>(action: (prev: Awaited<S>, fd: FormData) => Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = React.useActionState<S, FormData>(action, initial);
  const onSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (pending) return;
      const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      React.startTransition(() => dispatch(fd));
    },
    [dispatch, pending],
  );
  // After a failed submit, bring the first error into view and focus the first invalid field.
  React.useEffect(() => {
    if (!state || typeof state !== "object" || !("error" in (state as object)) || !(state as { error?: unknown }).error) return;
    const t = setTimeout(() => {
      const invalid = document.querySelector<HTMLElement>("[aria-invalid=true]");
      const alert = document.querySelector<HTMLElement>("form [role=alert]");
      (alert ?? invalid)?.scrollIntoView({ behavior: "smooth", block: "center" });
      invalid?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(t);
  }, [state]);
  return [state, onSubmit, pending] as const;
}
