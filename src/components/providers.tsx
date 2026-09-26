"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      {children}
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: "text-sm" }} />
    </ThemeProvider>
  );
}
