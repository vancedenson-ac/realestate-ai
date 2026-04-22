"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { escrowApi, eligibleEscrowOfficersApi } from "@/lib/api";
import { STALE_TIME_DETAIL } from "@/lib/query-config";
import type {
  EscrowAssignmentCreate,
  EarnestMoneyConfirm,
  FundingConfirm,
  DisbursementCreate,
} from "@/types/api";

export function useEligibleEscrowOfficers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["eligible-escrow-officers", user.user_id, user.organization_id],
    queryFn: () => eligibleEscrowOfficersApi.list(user),
    enabled: !!user?.user_id && !!user?.organization_id,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useEscrowAssignments(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["escrow-assignments", transactionId, user.user_id, user.organization_id],
    queryFn: () => escrowApi.listAssignments(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useEscrowEarnestMoney(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["escrow-earnest-money", transactionId, user.user_id, user.organization_id],
    queryFn: () => escrowApi.listEarnestMoney(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useEscrowFunding(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["escrow-funding", transactionId, user.user_id, user.organization_id],
    queryFn: () => escrowApi.listFunding(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useEscrowDisbursements(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["escrow-disbursements", transactionId, user.user_id, user.organization_id],
    queryFn: () => escrowApi.listDisbursements(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useAssignEscrowOfficer(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EscrowAssignmentCreate) =>
      escrowApi.assignOfficer(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow-assignments", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
    },
  });
}

export function useConfirmEarnestMoney(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EarnestMoneyConfirm) =>
      escrowApi.confirmEarnestMoney(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow-earnest-money", transactionId] });
    },
  });
}

export function useConfirmFunding(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FundingConfirm) =>
      escrowApi.confirmFunding(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow-funding", transactionId] });
    },
  });
}

export function useRecordDisbursement(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DisbursementCreate) =>
      escrowApi.recordDisbursement(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escrow-disbursements", transactionId] });
    },
  });
}
