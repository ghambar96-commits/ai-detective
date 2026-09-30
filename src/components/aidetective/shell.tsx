"use client";

/**
 * AIDetective — application shell: desktop sidebar, mobile Sheet nav,
 * sticky header and a footer that sticks to the viewport bottom
 * (min-h-screen flex flex-col + mt-auto, pushed naturally on overflow).
 */
import { useEffect, useState } from "react";
import { Menu, SearchCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getSystemStatus } from "@/lib/api/client";
import { useUiStore } from "@/stores/ui-store";
import { SidebarNav, VIEW_TITLES } from "./sidebar-nav";

const DISCLAIMER =
  "AIDetective is a probabilistic analysis tool. Results are estimates, not proof, and may produce false positives/negatives.";

export function Shell({ children }: { children: React.ReactNode }) {
  const activeView = useUiStore((s) => s.activeView);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSystemStatus()
      .then((status) => {
        if (!cancelled) setVersion(status.app.version);
      })
      .catch(() => {
        /* version display is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-zinc-950/60 lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <SearchCheck aria-hidden className="size-5 text-emerald-400" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">AIDetective</p>
            <p className="text-[10px] text-muted-foreground">local-first · multimodal</p>
          </div>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <Separator />
        <p className="px-5 py-3 text-[10px] leading-relaxed text-muted-foreground/70">
          Heuristic baselines only — no trained ML models. Estimates, never proof.
        </p>
      </aside>

      {/* Mobile nav (controlled Sheet — trigger is the header hamburger) */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-0">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle className="flex items-center gap-2.5 text-base">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <SearchCheck aria-hidden className="size-4 text-emerald-400" />
              </span>
              AIDetective
            </SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col lg:pl-60">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation menu"
              className="min-h-11 min-w-11 lg:hidden"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu aria-hidden className="size-5" />
            </Button>
            <h1 className="truncate text-sm font-semibold tracking-tight md:text-base">
              {VIEW_TITLES[activeView]}
            </h1>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-400 sm:inline-flex">
                <ShieldAlert aria-hidden className="size-3" />
                Estimates — not proof
              </span>
              {version ? (
                <span className="rounded-md border px-2 py-1 text-[10px] text-muted-foreground">v{version}</span>
              ) : null}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">{children}</main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t bg-zinc-950/40 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <p className="max-w-2xl leading-relaxed">{DISCLAIMER}</p>
            <p className="shrink-0 tabular-nums">
              AIDetective{version ? ` v${version}` : ""} · open-source · local-first
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
