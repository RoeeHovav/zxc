"use client";
import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Plus, Settings, Sun, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dialog";
import { MobileNav } from "./sidebar";
import { SearchPalette } from "./search";
import { logoutAction } from "@/app/(auth)/actions";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = !mounted ? Monitor : theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`Theme: ${mounted ? theme : "system"}. Switch to ${next}.`} title={`Theme: ${mounted ? theme : "system"}`}>
      <Icon />
    </Button>
  );
}

export function Topbar({ user, businessName }: { user: { name: string; email: string }; businessName: string }) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
      <MobileNav businessName={businessName} />
      <div className="min-w-0 flex-1">
        <SearchPalette />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="hidden sm:inline-flex">
            <Plus /> New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link href="/orders/new">New order</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/quotes/new">New quotation</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/customers/new">New customer</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/designs/new">New design project</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/finance/expenses/new">New expense</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Account menu">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {user.name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")
                .toUpperCase() || <UserRound className="size-4" />}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <span className="block text-sm font-medium text-foreground">{user.name}</span>
            <span className="block text-xs">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/account">
              <UserRound /> Account & security
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void logoutAction()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
