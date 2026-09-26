import { Flame } from "lucide-react";

export function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
            <Flame className="size-5" aria-hidden />
          </span>
          <span className="text-xl font-semibold tracking-tight">PrintForge</span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-pop)] sm:p-7">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
