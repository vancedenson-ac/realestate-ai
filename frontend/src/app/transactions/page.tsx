"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useInfiniteTransactions, filterTransactionsByRole, usePrefetchTransaction } from "@/hooks/use-transactions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransactionStateBadge } from "@/components/transaction-state-badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { toastError } from "@/lib/toast";
import { formatCurrency, formatDate, truncateId } from "@/lib/utils";
import Link from "next/link";
import { Search, Plus, ArrowUpDown, Clock, DollarSign, Building2 } from "lucide-react";
import type { TransactionState } from "@/types/api";
import { canCreateTransaction } from "@/lib/permissions";

const ALL_STATES: TransactionState[] = [
  "PRE_LISTING",
  "LISTED",
  "OFFER_MADE",
  "UNDER_CONTRACT",
  "DUE_DILIGENCE",
  "FINANCING",
  "CLEAR_TO_CLOSE",
  "CLOSED",
  "CANCELLED",
];

function TransactionsPageContent() {
  const { user, isHydrated } = useAuth();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "price">("date");

  const {
    data: infiniteData,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTransactions();
  const prefetchTransaction = usePrefetchTransaction();

  useEffect(() => {
    const state = searchParams.get("state");
    if (state && ALL_STATES.includes(state as TransactionState)) setStateFilter(state);
  }, [searchParams]);

  useEffect(() => {
    if (error) toastError(error, "Failed to load transactions");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Flatten all loaded pages, then filter by role
  const allLoaded = infiniteData?.pages.flatMap((p) => p.data) ?? [];
  let transactions = filterTransactionsByRole(allLoaded, user.role);

  // Apply search filter
  if (searchQuery) {
    transactions = transactions.filter(
      (tx) =>
        tx.transaction_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.property_id?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }

  // Apply state filter
  if (stateFilter !== "all") {
    transactions = transactions.filter((tx) => tx.current_state === stateFilter);
  }

  // Sort transactions
  transactions = [...transactions].sort((a, b) => {
    if (sortBy === "price") {
      return (b.offer_price || 0) - (a.offer_price || 0);
    }
    return new Date(b.state_entered_at).getTime() - new Date(a.state_entered_at).getTime();
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">
            Manage and track all your real estate transactions
          </p>
        </div>
        {canCreateTransaction(user.role) && (
          <Button asChild>
            <Link href="/transactions/new">
              <Plus className="mr-2 h-4 w-4" />
              New Transaction
            </Link>
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by transaction ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Filter by state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {ALL_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "date" | "price")}>
              <SelectTrigger className="w-full md:w-[150px]">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Sort by Date</SelectItem>
                <SelectItem value="price">Sort by Price</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Transaction List */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="file"
              title="No transactions found"
              description={
                searchQuery || stateFilter !== "all"
                  ? "Try adjusting your filters"
                  : "You don't have any transactions visible for your role."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4">
            {transactions.map((tx) => (
              <Link
                key={tx.transaction_id}
                href={`/transactions/${tx.transaction_id}`}
                className="block"
                onMouseEnter={() => prefetchTransaction(tx.transaction_id)}
              >
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">
                          Transaction {truncateId(tx.transaction_id)}
                        </h3>
                        <TransactionStateBadge state={tx.current_state} />
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDate(tx.state_entered_at)}
                        </span>
                        {tx.property_id && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" />
                            Property: {truncateId(tx.property_id)}
                          </span>
                        )}
                        {tx.jurisdiction && (
                          <span>{tx.jurisdiction}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {tx.offer_price ? (
                        <div className="flex items-center gap-1 text-lg font-semibold">
                          <DollarSign className="h-4 w-4" />
                          {formatCurrency(tx.offer_price).replace("$", "")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No price set</span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Created {formatDate(tx.created_at)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <span className="inline-flex items-center gap-2">
                    <LoadingSpinner size="sm" />
                    Loading…
                  </span>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <TransactionsPageContent />
    </Suspense>
  );
}
