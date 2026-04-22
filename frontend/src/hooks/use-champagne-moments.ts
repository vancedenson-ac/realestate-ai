"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { champagneMomentsApi } from "@/lib/api";
import { toastChampagne } from "@/lib/toast";

const CHAMPAGNE_POLL_INTERVAL_MS = 30_000;

/**
 * Fetches champagne moments for the current user and shows a custom toast for each new moment.
 * Idempotent per event_id (only toasts once per event per session).
 */
export function useChampagneMoments() {
  const { user } = useAuth();
  const shownEventIds = useRef<Set<string>>(new Set());

  const { data: moments } = useQuery({
    queryKey: ["champagne-moments", user?.user_id, user?.organization_id],
    queryFn: () => champagneMomentsApi.list(user!),
    enabled: !!user?.user_id && !!user?.organization_id,
    refetchInterval: CHAMPAGNE_POLL_INTERVAL_MS,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!moments?.length) return;
    for (const moment of moments) {
      if (shownEventIds.current.has(moment.event_id)) continue;
      toastChampagne(moment);
      shownEventIds.current.add(moment.event_id);
    }
  }, [moments]);
}
