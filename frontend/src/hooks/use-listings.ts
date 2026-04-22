"use client";

import { useRef } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { listingsApi } from "@/lib/api";
import {
  STALE_TIME_LIST,
  STALE_TIME_DETAIL,
  PREFETCH_DEBOUNCE_MS,
  isPrefetchOnHoverEnabled,
  DEFAULT_LIST_PAGE_SIZE,
} from "@/lib/query-config";
import type { ListingCreate, ListingUpdate, MapBounds, MapSearchFilters } from "@/types/api";

export function useListings(params?: { limit?: number; cursor?: string; status_filter?: string }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["listings", user.user_id, user.organization_id, params],
    queryFn: () => listingsApi.list(user, params),
    enabled: !!user,
    staleTime: STALE_TIME_LIST,
  });
}

/**
 * Cursor-based infinite list for listings. Use on the Listings page for "Load more".
 * Search is server-side (address, city, state, postal code); include in queryKey for caching.
 */
export function useInfiniteListings(statusFilter?: string, search?: string) {
  const { user } = useAuth();
  const searchTrimmed = search?.trim() || undefined;
  return useInfiniteQuery({
    queryKey: ["listings", "infinite", user.user_id, user.organization_id, statusFilter, searchTrimmed],
    queryFn: ({ pageParam }) =>
      listingsApi.list(user, {
        limit: DEFAULT_LIST_PAGE_SIZE,
        cursor: pageParam as string | undefined,
        status_filter: statusFilter,
        search: searchTrimmed,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.cursor ?? undefined,
    enabled: !!user,
    staleTime: STALE_TIME_LIST,
  });
}

export function useListing(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["listing", id, user.user_id, user.organization_id],
    queryFn: () => listingsApi.get(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useInterestedBuyers(listingId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["interested-buyers", listingId, user.user_id, user.organization_id],
    queryFn: () => listingsApi.getInterestedBuyers(user, listingId),
    enabled: !!user && !!listingId,
    staleTime: STALE_TIME_DETAIL,
  });
}

/** Prefetch a single listing on list card hover. Production-safe: debounced, only primes empty cache, can be disabled via env. */
export function usePrefetchListing() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (id: string) => {
    if (!user || !isPrefetchOnHoverEnabled()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const key = ["listing", id, user.user_id, user.organization_id] as const;
      if (queryClient.getQueryData(key) !== undefined) return;
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => listingsApi.get(user, id),
        staleTime: STALE_TIME_DETAIL,
      });
    }, PREFETCH_DEBOUNCE_MS);
  };
}

export function useCreateListing() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ListingCreate) => listingsApi.create(user, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
  });
}

export function useUpdateListing(id: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ListingUpdate) => listingsApi.update(user, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listing", id] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
  });
}

/**
 * Bounding-box map search for listings. Returns GeoJSON FeatureCollection.
 * Uses placeholderData to keep previous data visible during pan/zoom (no flash).
 * Debouncing should be handled at the component level (300ms after onMoveEnd).
 */
export function useMapListings(
  bounds: MapBounds | null,
  zoom: number,
  filters?: MapSearchFilters,
) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["listings", "map", user.user_id, user.organization_id, bounds, zoom, filters],
    queryFn: () =>
      listingsApi.mapSearch(user, {
        bounds: bounds!,
        zoom,
        filters,
      }),
    enabled: !!user && !!bounds,
    staleTime: STALE_TIME_LIST,
    // Keep previous data while new bounds load (prevents map flash during pan)
    placeholderData: (prev) => prev,
  });
}
