"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { titleApi } from "@/lib/api";
import { STALE_TIME_DETAIL } from "@/lib/query-config";
import type {
  TitleOrderCreate,
  TitleOrderUpdate,
  TitleCommitmentCreate,
  DeedRecordedCreate,
  OwnershipTransferCreate,
  AppraisalWaiverCreate,
} from "@/types/api";

export function useTitleOrders(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["title-orders", transactionId, user.user_id, user.organization_id],
    queryFn: () => titleApi.listOrders(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useTitleCommitments(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["title-commitments", transactionId, user.user_id, user.organization_id],
    queryFn: () => titleApi.listCommitments(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useDeedRecordings(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["deed-recordings", transactionId, user.user_id, user.organization_id],
    queryFn: () => titleApi.listDeedRecordings(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useOwnershipTransfers(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ownership-transfers", transactionId, user.user_id, user.organization_id],
    queryFn: () => titleApi.listOwnershipTransfers(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useCreateTitleOrder(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: TitleOrderCreate) =>
      titleApi.createOrder(user, transactionId, data ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["title-orders", transactionId] });
    },
  });
}

export function useUpdateTitleOrder() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...data }: TitleOrderUpdate & { orderId: string }) =>
      titleApi.updateOrder(user, orderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["title-orders"] });
    },
  });
}

export function useCreateTitleCommitment(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TitleCommitmentCreate) =>
      titleApi.createCommitment(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["title-commitments", transactionId] });
    },
  });
}

export function useRecordDeed(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeedRecordedCreate) =>
      titleApi.recordDeed(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deed-recordings", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
    },
  });
}

export function useRecordOwnershipTransfer(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: OwnershipTransferCreate) =>
      titleApi.recordOwnershipTransfer(user, transactionId, data ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ownership-transfers", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
    },
  });
}

export function useAppraisalWaivers(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["appraisal-waivers", transactionId, user.user_id, user.organization_id],
    queryFn: () => titleApi.listAppraisalWaivers(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useWaiveAppraisal(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: AppraisalWaiverCreate) =>
      titleApi.waiveAppraisal(user, transactionId, data ?? {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appraisal-waivers", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["document-checklist", transactionId] });
    },
  });
}
