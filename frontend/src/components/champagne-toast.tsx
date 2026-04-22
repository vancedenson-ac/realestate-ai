"use client";

import { PartyPopper } from "lucide-react";
import type { ChampagneMomentOverview } from "@/types/api";

/**
 * Custom champagne moment toast content (dark card, celebratory icon, title + message).
 * Matches mockup: dark theme, rounded card, "Champagne Moment!" title, event message.
 */
export function ChampagneToastContent({ moment }: { moment: ChampagneMomentOverview }) {
  return (
    <div
      className="flex w-full max-w-md items-start gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-lg dark:bg-[hsl(0,0%,10%)]"
      role="alert"
      aria-live="polite"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
        <PartyPopper className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-amber-400/90">
          Champagne Moment
        </p>
        <p className="font-semibold leading-tight text-card-foreground">
          {moment.title}
        </p>
        <p className="text-sm leading-snug text-muted-foreground">
          {moment.message}
        </p>
      </div>
    </div>
  );
}
