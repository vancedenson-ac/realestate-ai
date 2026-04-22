"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { showingsApi } from "@/lib/api";
import { STALE_TIME_DETAIL } from "@/lib/query-config";
import type { ShowingCreate, ShowingUpdate, ShowingFeedbackCreate } from "@/types/api";

export function useListingShowings(listingId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["showings", listingId, user.user_id, user.organization_id],
    queryFn: () => showingsApi.list(user, listingId),
    enabled: !!user && !!listingId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useScheduleShowing(listingId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ShowingCreate) =>
      showingsApi.schedule(user, listingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["showings", listingId] });
    },
  });
}

export function useUpdateShowing(showingId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ShowingUpdate) =>
      showingsApi.update(user, showingId, data),
    onSuccess: (_, __, context: { listingId?: string } | undefined) => {
      if (context?.listingId) {
        queryClient.invalidateQueries({ queryKey: ["showings", context.listingId] });
      }
    },
  });
}

export function useShowingFeedback(showingId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["showing-feedback", showingId, user.user_id],
    queryFn: () => showingsApi.listFeedback(user, showingId),
    enabled: !!user && !!showingId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useAddShowingFeedback(showingId: string, listingId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ShowingFeedbackCreate) =>
      showingsApi.addFeedback(user, showingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["showing-feedback", showingId] });
      queryClient.invalidateQueries({ queryKey: ["showings", listingId] });
    },
  });
}
