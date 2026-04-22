"use client";

import { useQuery, useQueries, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { useAuth } from "@/context/auth-context";
import { transactionsApi, documentsApi } from "@/lib/api";
import { inspectionsApi } from "@/lib/api";
import { uploadFileToPresignedUrl, computeSha256Hex } from "@/lib/upload";
import {
  STALE_TIME_LIST,
  STALE_TIME_DETAIL,
  PREFETCH_DEBOUNCE_MS,
  isPrefetchOnHoverEnabled,
  DEFAULT_LIST_PAGE_SIZE,
} from "@/lib/query-config";
import type {
  TransactionOverview,
  TransactionCreate,
  TransitionRequest,
  PartyCreate,
} from "@/types/api";
import type { DocumentOverview, DocumentType } from "@/types/api";
import type { InspectionCreate } from "@/types/api";

export function useTransactions(params?: { cursor?: string; limit?: number }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transactions", user.user_id, user.organization_id, params],
    queryFn: () => transactionsApi.list(user, params),
    enabled: !!user,
    staleTime: STALE_TIME_LIST,
  });
}

/**
 * Cursor-based infinite list for transactions. Use on the main Transactions page
 * for "Load more" instead of loading 100 at once. Improves first-load time and
 * memory in heavy-use environments.
 */
export function useInfiniteTransactions() {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: ["transactions", "infinite", user.user_id, user.organization_id],
    queryFn: ({ pageParam }) =>
      transactionsApi.list(user, {
        limit: DEFAULT_LIST_PAGE_SIZE,
        cursor: pageParam as string | undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.cursor ?? undefined,
    enabled: !!user,
    staleTime: STALE_TIME_LIST,
  });
}

export function useTransaction(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transaction", id, user.user_id, user.organization_id],
    queryFn: () => transactionsApi.get(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useTransactionTimeline(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transaction-timeline", id, user.user_id, user.organization_id],
    queryFn: () => transactionsApi.getTimeline(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useTransactionDocumentChecklist(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transaction-checklist", id, user.user_id, user.organization_id],
    queryFn: () => transactionsApi.getDocumentChecklist(user, id),
    enabled: !!user && !!id,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useTransactionInspections(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transaction-inspections", transactionId, user.user_id, user.organization_id],
    queryFn: () => inspectionsApi.list(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useCreateInspection(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InspectionCreate) =>
      inspectionsApi.create(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-inspections", transactionId] });
    },
  });
}

/** Prefetch a single transaction on list card hover. Production-safe: debounced, only primes empty cache, can be disabled via env. */
export function usePrefetchTransaction() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (id: string) => {
    if (!user || !isPrefetchOnHoverEnabled()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const key = ["transaction", id, user.user_id, user.organization_id] as const;
      if (queryClient.getQueryData(key) !== undefined) return;
      queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => transactionsApi.get(user, id),
        staleTime: STALE_TIME_DETAIL,
      });
    }, PREFETCH_DEBOUNCE_MS);
  };
}

export function useCreateTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: TransactionCreate) => transactionsApi.create(user, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useTransitionTransaction(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: TransitionRequest) =>
      transactionsApi.transition(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction-timeline", transactionId] });
    },
  });
}

export function useAddParty(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: PartyCreate) => transactionsApi.addParty(user, transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction", transactionId] });
    },
  });
}

export function useTransactionDocuments(transactionId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transaction-documents", transactionId, user.user_id, user.organization_id],
    queryFn: () => documentsApi.list(user, transactionId),
    enabled: !!user && !!transactionId,
    staleTime: STALE_TIME_DETAIL,
  });
}

export function useDocumentVersions(documentId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["document-versions", documentId, user.user_id, user.organization_id],
    queryFn: () => (documentId ? documentsApi.listVersions(user, documentId) : Promise.resolve([])),
    enabled: !!user && !!documentId,
    staleTime: STALE_TIME_DETAIL,
  });
}

/** Fetches documents across all transactions the user can see (for /documents page "All Documents"). */
export function useAllDocuments(): {
  data: DocumentOverview[];
  isLoading: boolean;
  error: Error | null;
} {
  const { user } = useAuth();
  const { data: transactionsData, isLoading: transactionsLoading } = useTransactions();
  const transactions = transactionsData?.data
    ? filterTransactionsByRole(transactionsData.data, user.role)
    : [];
  const transactionIds = useMemo(
    () => transactions.map((t) => t.transaction_id),
    [transactions]
  );

  const documentQueries = useQueries({
    queries: transactionIds.map((tid) => ({
      queryKey: ["transaction-documents", tid, user.user_id, user.organization_id],
      queryFn: () => documentsApi.list(user, tid),
      enabled: !!user && !!tid,
      staleTime: STALE_TIME_DETAIL,
    })),
  });

  const isLoading = transactionsLoading || documentQueries.some((q) => q.isLoading);
  const error =
    documentQueries.find((q) => q.error)?.error as Error | undefined ?? null;

  const data = useMemo(() => {
    const list: DocumentOverview[] = [];
    for (const q of documentQueries) {
      if (q.data) list.push(...q.data);
    }
    list.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return list;
  }, [documentQueries]);

  return { data, isLoading, error };
}

export function useUploadDocument(transactionId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentType,
      file,
    }: {
      documentType: DocumentType;
      file: File;
    }) => {
      let doc: { document_id: string };
      try {
        doc = await documentsApi.create(user, transactionId, { document_type: documentType });
      } catch (e) {
        throw new Error(`Create document failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
      let upload_url: string;
      let storage_path: string;
      let storage_bucket: string;
      try {
        const ur = await documentsApi.getUploadUrl(user, doc.document_id, {
          filename: file.name,
          content_type: file.type || undefined,
        });
        upload_url = ur.upload_url;
        storage_path = ur.storage_path;
        storage_bucket = ur.storage_bucket;
      } catch (e) {
        throw new Error(`Get upload URL failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
      try {
        await uploadFileToPresignedUrl(upload_url, file);
      } catch (e) {
        throw new Error(`Upload file to storage failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
      const checksum = await computeSha256Hex(file);
      try {
        return await documentsApi.addVersion(user, doc.document_id, {
          storage_path,
          storage_bucket,
          checksum,
        });
      } catch (e) {
        throw new Error(`Save document version failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-documents", transactionId] });
      queryClient.invalidateQueries({ queryKey: ["transaction-documents"] });
      queryClient.invalidateQueries({ queryKey: ["transaction-checklist", transactionId] });
    },
  });
}

/** Sign a document (in-app; backend RLS allows only transaction party with signer_id = current user). */
export function useSignDocument() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) =>
      documentsApi.sign(user, documentId, { signer_id: user.user_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transaction-documents"] });
    },
  });
}

// Filter transactions by role visibility
export function filterTransactionsByRole(
  transactions: TransactionOverview[],
  role: string
): TransactionOverview[] {
  const r = (role || "").toUpperCase();
  if (r === "BUYER" || r === "BUYER_AGENT") {
    return transactions.filter((t) => t.current_state !== "PRE_LISTING");
  }
  return transactions;
}
