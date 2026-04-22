"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { offersApi } from "@/lib/api";
import { STALE_TIME_DETAIL } from "@/lib/query-config";
import type {
  OfferOverview,
  OfferCreate,
  OfferDecisionBody,
  OfferAcceptBody,
} from "@/types/api";

export function useTransactionOffers(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transaction-offers", transactionId, user.user_id, user.organization_id],
    queryFn: () => offersApi.list(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useSubmitOffer(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OfferCreate) => offersApi.submit(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-offers", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useCounterOffer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, ...data }: OfferCreate & { offerId: string }) =>
      offersApi.counter(user, offerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-offers"] });
      queryClient.invalidateQueries({ queryKey: ["transaction"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useWithdrawOffer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, ...data }: OfferDecisionBody & { offerId: string }) =>
      offersApi.withdraw(user, offerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-offers"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useRejectOffer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, ...data }: OfferDecisionBody & { offerId: string }) =>
      offersApi.reject(user, offerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-offers"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useAcceptOffer() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, ...data }: OfferAcceptBody & { offerId: string }) =>
      offersApi.accept(user, offerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-offers"] });
      queryClient.invalidateQueries({ queryKey: ["transaction"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
