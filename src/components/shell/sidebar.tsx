"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { Menu, X, Flame } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav";

function Brand({ businessName }: { businessName: string }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2 py-1">
      <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
        <Flame className="size-4.5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-white">PrintForge</span>
        <span className="block truncate text-[11px] leading-tight text-sidebar-foreground/70">{businessName}</span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi}>
          {group.label && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-sidebar-active text-white" : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-indigo-300" : "text-sidebar-foreground/70 group-hover:text-white")} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ businessName }: { businessName: string }) {
  return (
    <aside className="no-print fixed inset-y-0 start-0 z-30 hidden w-60 flex-col bg-sidebar lg:flex">
      <div className="px-3 pb-2 pt-4">
        <Brand businessName={businessName} />
      </div>
      <NavList />
      <p className="px-5 py-3 text-[11px] text-sidebar-foreground/40">v0.1 · self-hosted</p>
    </aside>
  );
}

export function MobileNav({ businessName }: { businessName: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 lg:hidden" />
        <D.Content className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-xl outline-none lg:hidden">
          <D.Title className="sr-only">Navigation</D.Title>
          <D.Description className="sr-only">Main navigation</D.Description>
          <div className="flex items-center justify-between px-3 pb-2 pt-4">
            <Brand businessName={businessName} />
            <D.Close className="inline-flex size-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-active" aria-label="Close navigation">
              <X className="size-5" />
            </D.Close>
          </div>
          <NavList onNavigate={() => setOpen(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
