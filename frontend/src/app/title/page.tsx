"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useTransactions, filterTransactionsByRole } from "@/hooks/use-transactions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/utils";
import { TransactionStateBadge } from "@/components/transaction-state-badge";
import { FileText, ChevronRight } from "lucide-react";

const TITLE_RELEVANT_STATES = ["UNDER_CONTRACT", "DUE_DILIGENCE", "FINANCING", "CLEAR_TO_CLOSE", "CLOSED"];

export default function TitlePage() {
  const { user, isHydrated } = useAuth();
  const { data: transactionsData, isLoading, error, refetch } = useTransactions();
  const transactions = useMemo(
    () =>
      transactionsData?.data
        ? filterTransactionsByRole(transactionsData.data, user.role)
        : [],
    [transactionsData?.data, user.role]
  );
  const titleTransactions = useMemo(
    () => transactions.filter((t) => TITLE_RELEVANT_STATES.includes(t.current_state)),
    [transactions]
  );

  const canViewTitle = [
    "ESCROW_OFFICER",
    "BUYER",
    "SELLER",
    "BUYER_AGENT",
    "SELLER_AGENT",
    "LENDER",
    "ADMIN",
  ].includes(user.role);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canViewTitle) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Title</h1>
          <p className="text-muted-foreground">Title orders, commitments, and recording</p>
        </div>
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="inbox"
              title="Access Restricted"
              description="Title management is not available for your role."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Title</h1>
          <p className="text-muted-foreground">Title orders, commitments, deed recording, and ownership transfer</p>
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
          <h1 className="text-3xl font-bold tracking-tight">Title</h1>
          <p className="text-muted-foreground">
            Title orders, commitments, deed recording, and ownership transfer
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transactions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{titleTransactions.length}</div>
            <p className="text-xs text-muted-foreground">with title activity</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Title &amp; Closing</CardTitle>
          <CardDescription>
            Transactions in under contract through closed. Open a transaction to create title orders, add commitments, record deed, or confirm ownership transfer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingSpinner size="sm" />
          ) : titleTransactions.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No title transactions"
              description="Transactions will appear here when they reach under contract or later stages."
            />
          ) : (
            <ul className="space-y-2">
              {titleTransactions.map((t) => (
                <li
                  key={t.transaction_id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <TransactionStateBadge state={t.current_state} />
                    <span className="text-sm text-muted-foreground">
                      {t.transaction_id.slice(0, 8)}… — {formatDateTime(t.created_at)}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/transactions/${t.transaction_id}`}>
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
