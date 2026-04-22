"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { LoadingSpinner } from "@/components/loading-spinner";

/**
 * Waits for the Next.js router (pathname) and auth hydration before rendering
 * children. Prevents first-load errors from pathname being null or auth not
 * ready. Shows a full-page spinner until both are ready, with a brief
 * settling delay (≈120ms) to avoid first-frame races.
 */
export function RouterReadyGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isHydrated } = useAuth();
  const [settled, setSettled] = useState(false);

  const routerReady = pathname !== null && pathname !== undefined;

  useEffect(() => {
    if (!routerReady || !isHydrated) {
      setSettled(false);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    const rafId = requestAnimationFrame(() => {
      timeoutId = setTimeout(() => setSettled(true), 120);
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [routerReady, isHydrated]);

  if (!routerReady || !isHydrated || !settled) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
