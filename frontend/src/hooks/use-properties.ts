"use client";

import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { propertiesApi } from "@/lib/api";
import { uploadFileToPresignedUrl, computeSha256Hex } from "@/lib/upload";
import {
  STALE_TIME_LIST,
  STALE_TIME_DETAIL,
  PREFETCH_DEBOUNCE_MS,
  isPrefetchOnHoverEnabled,
} from "@/lib/query-config";
import type { PropertyCreate, PropertyUpdate, PropertySearchRequest } from "@/types/api";

export function useProperties(params?: { limit?: number; offset?: number; status_filter?: string }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["properties", user.user_id, user.organization_id, params],
    queryFn: () => propertiesApi.list(user, params),
    enabled: !!user,
    staleTime: STALE_TIME_LIST,
  });
}

export function useProperty(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["property", id, user.user_id, user.organization_id],
    queryFn: () => propertiesApi.get(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function usePropertyImages(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["property-images", id, user.user_id, user.organization_id],
    queryFn: () => propertiesApi.getImages(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_DETAIL,
  });
}

/** Prefetch a single property on list card hover. Production-safe: debounced, only primes empty cache, can be disabled via env. */
export function usePrefetchProperty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (id: string) => {
    if (!user || !isPrefetchOnHoverEnabled()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const key = ["property", id, user.user_id, user.organization_id] as const;
      if (queryClient.getQueryData(key) !== undefined) return;
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => propertiesApi.get(user, id),
        staleTime: STALE_TIME_DETAIL,
      });
    }, PREFETCH_DEBOUNCE_MS);
  };
}

export function useSearchProperties() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: (data: PropertySearchRequest) => propertiesApi.search(user, data),
  });
}

export function useCreateProperty() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: PropertyCreate) => propertiesApi.create(user, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}

export function useUpdateProperty(id: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: PropertyUpdate) => propertiesApi.update(user, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["property", id] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}

export function useUploadPropertyImage(propertyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const { upload_url, image_id } =
        await propertiesApi.getImageUploadUrl(user, propertyId, {
          filename: file.name,
          content_type: file.type || undefined,
        });
      await uploadFileToPresignedUrl(upload_url, file);
      const checksum = await computeSha256Hex(file);
      return propertiesApi.updateImage(user, propertyId, image_id, {
        file_size_bytes: file.size,
        checksum,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["property-images", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["property", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}

export function useSetCoverImage(propertyId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (imageId: string) =>
      propertiesApi.updateImage(user, propertyId, imageId, { is_primary: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["property-images", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["property", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
  });
}
