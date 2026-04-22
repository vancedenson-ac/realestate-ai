"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/context/auth-context";
import { useTransactions, filterTransactionsByRole } from "@/hooks/use-transactions";
import { useListings } from "@/hooks/use-listings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TransactionStateBadge } from "@/components/transaction-state-badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { toastError } from "@/lib/toast";
import { formatCurrency, formatDate, getRoleDisplayName } from "@/lib/utils";
import { canCreateProperty, canCreateListing, canMakeOffer } from "@/lib/permissions";
import { DASHBOARD_TRANSACTIONS_LIMIT, DASHBOARD_LISTINGS_LIMIT } from "@/lib/query-config";
import Link from "next/link";
import {
  FileText,
  Building2,
  ListChecks,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle2,
  ArrowRight,
  Plus,
  HandCoins,
} from "lucide-react";
import type { TransactionState } from "@/types/api";

const STATE_ORDER: TransactionState[] = [
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

export default function DashboardPage() {
  const { user, isHydrated } = useAuth();
  const [pipelineFilterState, setPipelineFilterState] = useState<TransactionState | null>(null);
  const { data: transactionsData, isLoading: loadingTx, error: txError, refetch: refetchTx } = useTransactions({ limit: DASHBOARD_TRANSACTIONS_LIMIT });
  const { data: listingsData, isLoading: loadingListings, error: listingsError } = useListings({ limit: DASHBOARD_LISTINGS_LIMIT });

  useEffect(() => {
    if (txError) toastError(txError, "Failed to load transactions");
    if (listingsError) toastError(listingsError, "Failed to load listings");
  }, [txError, listingsError]);

  if (!isHydrated || !user) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const transactions = transactionsData?.data
    ? filterTransactionsByRole(transactionsData.data, user.role)
    : [];

  const filteredTransactions = useMemo(() => {
    if (!pipelineFilterState) return transactions;
    return transactions.filter((t) => t.current_state === pipelineFilterState);
  }, [transactions, pipelineFilterState]);

  const showCreateProperty = canCreateProperty(user.role);
  const showCreateListing = canCreateListing(user.role);
  const showMakeOffer = canMakeOffer(user.role);

  // Calculate stats
  const activeTransactions = transactions.filter(
    (t) => !["CLOSED", "CANCELLED"].includes(t.current_state)
  );
  const closedTransactions = transactions.filter((t) => t.current_state === "CLOSED");
  const totalValue = transactions.reduce((sum, t) => sum + (t.offer_price || 0), 0);

  // Group by state for pipeline view
  const stateGroups = STATE_ORDER.reduce((acc, state) => {
    acc[state] = transactions.filter((t) => t.current_state === state);
    return acc;
  }, {} as Record<string, typeof transactions>);

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {user.full_name?.split(" ")[0] || "User"}
        </h1>
        <p className="text-muted-foreground">
          Here&apos;s what&apos;s happening with your transactions today.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Transactions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeTransactions.length}</div>
            <p className="text-xs text-muted-foreground">
              {closedTransactions.length} closed this period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pipeline Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground">
              Across {transactions.length} transactions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Listings</CardTitle>
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {listingsData?.data?.filter((l) => l.status === "ACTIVE").length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {listingsData?.data?.length || 0} total listings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Your Role</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{getRoleDisplayName(user.role)}</div>
            <p className="text-xs text-muted-foreground">{user.organization_name}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction Pipeline</CardTitle>
          <CardDescription>
            Overview of all transactions by state
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTx ? (
            <div className="flex h-32 items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : txError ? (
            <Button variant="outline" onClick={() => refetchTx()}>
              Retry
            </Button>
          ) : transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="You don't have any transactions visible for your role."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              {STATE_ORDER.filter(
                (state) => !["CLOSED", "CANCELLED"].includes(state)
              ).map((state) => {
                const count = stateGroups[state]?.length || 0;
                const isSelected = pipelineFilterState === state;
                return (
                  <button
                    key={state}
                    type="button"
                    onClick={() => setPipelineFilterState(isSelected ? null : state)}
                    className={`rounded-lg border p-4 text-center transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary ${
                      isSelected ? "border-primary bg-primary/5 ring-2 ring-primary" : "bg-card"
                    }`}
                  >
                    <TransactionStateBadge state={state} />
                    <div className="mt-2 text-2xl font-bold">{count}</div>
                    <p className="text-xs text-muted-foreground">transactions</p>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Transactions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Transactions</CardTitle>
              <CardDescription>
                {pipelineFilterState
                  ? `Filtered by ${pipelineFilterState.replace(/_/g, " ")}`
                  : "Your most recent transactions"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {pipelineFilterState && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPipelineFilterState(null)}
                >
                  Clear filter
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href={pipelineFilterState ? `/transactions?state=${pipelineFilterState}` : "/transactions"}>
                  View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingTx ? (
              <div className="flex h-32 items-center justify-center">
                <LoadingSpinner />
              </div>
            ) : filteredTransactions.length === 0 ? (
              <EmptyState
                title={pipelineFilterState ? `No ${pipelineFilterState.replace(/_/g, " ")} transactions` : "No transactions"}
                icon="inbox"
              />
            ) : (
              <div className="space-y-4">
                {filteredTransactions.slice(0, 5).map((tx) => (
                  <Link
                    key={tx.transaction_id}
                    href={`/transactions/${tx.transaction_id}`}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        Transaction {tx.transaction_id.slice(0, 8)}...
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(tx.state_entered_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {tx.offer_price && (
                        <span className="text-sm font-medium">
                          {formatCurrency(tx.offer_price)}
                        </span>
                      )}
                      <TransactionStateBadge state={tx.current_state} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks based on your role</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {showCreateProperty && (
                <Button className="justify-start" asChild>
                  <Link href="/properties/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create property
                  </Link>
                </Button>
              )}
              {showCreateListing && (
                <Button className="justify-start" asChild>
                  <Link href="/listings/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create listing
                  </Link>
                </Button>
              )}
              {showMakeOffer && (
                <Button className="justify-start" asChild>
                  <Link href="/listings">
                    <HandCoins className="mr-2 h-4 w-4" />
                    Make offer
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="justify-start" asChild>
                <Link href="/transactions">
                  <FileText className="mr-2 h-4 w-4" />
                  View All Transactions
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" asChild>
                <Link href="/properties">
                  <Building2 className="mr-2 h-4 w-4" />
                  Browse Properties
                </Link>
              </Button>
              <Button variant="outline" className="justify-start" asChild>
                <Link href="/listings">
                  <ListChecks className="mr-2 h-4 w-4" />
                  View Listings
                </Link>
              </Button>
              {(user.role === "BUYER" || user.role === "BUYER_AGENT") && (
                <Button variant="outline" className="justify-start" asChild>
                  <Link href="/recommendations">
                    <TrendingUp className="mr-2 h-4 w-4" />
                    View Recommendations
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="justify-start" asChild>
                <Link href="/chat">
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Open Messages
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
