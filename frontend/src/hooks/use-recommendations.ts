"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { preferencesApi, recommendationsApi, savedListingsApi } from "@/lib/api";
import { STALE_TIME_STATIC, STALE_TIME_DYNAMIC } from "@/lib/query-config";
import type { PreferenceCreate, PreferenceUpdate, FeedbackBody } from "@/types/api";

export function usePreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["preferences", user.user_id],
    queryFn: () => preferencesApi.list(user),
    enabled: !!user,
    staleTime: STALE_TIME_STATIC,
  });
}

export function usePreference(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["preference", id, user.user_id],
    queryFn: () => preferencesApi.get(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_STATIC,
  });
}

export function useCreatePreference() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: PreferenceCreate) => preferencesApi.create(user, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
  });
}

export function useUpdatePreference(id: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: PreferenceUpdate) => preferencesApi.update(user, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preference", id] });
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
  });
}

export function useRecommendations(params?: {
  preference_id?: string;
  min_score?: number;
  limit?: number;
}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["recommendations", user.user_id, params],
    queryFn: () => recommendationsApi.list(user, params),
    enabled: !!user,
    staleTime: STALE_TIME_DYNAMIC,
  });
}

export function useSubmitFeedback() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matchId, data }: { matchId: string; data: FeedbackBody }) =>
      recommendationsApi.submitFeedback(user, matchId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
  });
}

export function useSavedListings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved-listings", user.user_id],
    queryFn: () => savedListingsApi.list(user),
    enabled: !!user,
    staleTime: STALE_TIME_STATIC,
  });
}

export function useSaveListing() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) =>
      savedListingsApi.save(user, { listing_id: listingId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-listings"] });
    },
  });
}

export function useUnsaveListing() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (listingId: string) => savedListingsApi.unsave(user, listingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-listings"] });
    },
  });
}
