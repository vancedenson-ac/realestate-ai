"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useTransactions, filterTransactionsByRole } from "@/hooks/use-transactions";
import { useQueries } from "@tanstack/react-query";
import { offersApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { DollarSign, FileText, Clock, CheckCircle, XCircle, RotateCcw, ChevronRight } from "lucide-react";
import { STALE_TIME_DETAIL } from "@/lib/query-config";
import type { OfferOverview } from "@/types/api";

export default function OffersPage() {
  const { user, isHydrated } = useAuth();
  const { data: transactionsData, isLoading: transactionsLoading, error, refetch } = useTransactions();
  const transactions = useMemo(
    () =>
      transactionsData?.data
        ? filterTransactionsByRole(transactionsData.data, user.role)
        : [],
    [transactionsData?.data, user.role]
  );
  const offerRelevantStates = ["LISTED", "OFFER_MADE", "UNDER_CONTRACT"];
  const transactionIdsWithOffers = useMemo(
    () =>
      transactions
        .filter((t) => offerRelevantStates.includes(t.current_state))
        .map((t) => t.transaction_id),
    [transactions]
  );

  const offerQueries = useQueries({
    queries: transactionIdsWithOffers.map((tid) => ({
      queryKey: ["transaction-offers", tid, user.user_id, user.organization_id],
      queryFn: () => offersApi.list(user, tid),
      enabled: !!user && !!tid,
      staleTime: STALE_TIME_DETAIL,
    })),
  });

  const allOffers: OfferOverview[] = useMemo(() => {
    const list: OfferOverview[] = [];
    offerQueries.forEach((q) => {
      if (q.data) list.push(...q.data);
    });
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [offerQueries]);

  const stats = useMemo(() => {
    let pending = 0;
    let accepted = 0;
    let countered = 0;
    let rejected = 0;
    allOffers.forEach((o) => {
      const s = (o.status || "").toUpperCase();
      if (s === "SUBMITTED") pending++;
      else if (s === "ACCEPTED") accepted++;
      else if (s === "COUNTERED") countered++;
      else if (s === "REJECTED") rejected++;
    });
    return { pending, accepted, countered, rejected };
  }, [allOffers]);

  const isLoadingOffers = offerQueries.some((q) => q.isLoading);
  const isLoading = transactionsLoading || (transactionIdsWithOffers.length > 0 && isLoadingOffers);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Offers</h1>
          <p className="text-muted-foreground">Manage offers on your transactions</p>
        </div>
        <Card>
          <CardContent className="py-8">
            <p className="text-destructive mb-2">Failed to load transactions.</p>
            <Button onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Offers</h1>
          <p className="text-muted-foreground">Manage offers on your transactions</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">awaiting response</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Accepted</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.accepted}</div>
            <p className="text-xs text-muted-foreground">accepted</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Countered</CardTitle>
            <RotateCcw className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.countered}</div>
            <p className="text-xs text-muted-foreground">in negotiation</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.rejected}</div>
            <p className="text-xs text-muted-foreground">rejected</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Offers</CardTitle>
          <CardDescription>
            View and manage offers across your transactions. Open a transaction to submit, counter, withdraw, reject, or accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingSpinner size="sm" />
          ) : allOffers.length === 0 ? (
            <EmptyState
              icon="file"
              title="No offers yet"
              description="Offers will appear here when you submit or receive them on a transaction. Use Make offer from a listing to start."
            />
          ) : (
            <ul className="space-y-2">
              {allOffers.map((offer) => (
                <li
                  key={offer.offer_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium">Offer {offer.offer_id.slice(0, 8)}…</span>
                    <Badge variant="outline">{offer.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(offer.created_at)}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/transactions/${offer.transaction_id}`}>
                      Open transaction
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
