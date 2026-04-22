"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useTransactions, filterTransactionsByRole } from "@/hooks/use-transactions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime, getStateDisplayName } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { Scale, DollarSign, CheckCircle2, Clock, Banknote, ChevronRight } from "lucide-react";
import { TransactionStateBadge } from "@/components/transaction-state-badge";

const ESCROW_RELEVANT_STATES = ["UNDER_CONTRACT", "DUE_DILIGENCE", "FINANCING", "CLEAR_TO_CLOSE"];

export default function EscrowPage() {
  const { user, isHydrated } = useAuth();
  const { data: transactionsData, isLoading, error, refetch } = useTransactions();
  const transactions = useMemo(
    () =>
      transactionsData?.data
        ? filterTransactionsByRole(transactionsData.data, user.role)
        : [],
    [transactionsData?.data, user.role]
  );
  const escrowTransactions = useMemo(
    () => transactions.filter((t) => ESCROW_RELEVANT_STATES.includes(t.current_state)),
    [transactions]
  );

  const canViewEscrow = [
    "ESCROW_OFFICER",
    "BUYER",
    "SELLER",
    "BUYER_AGENT",
    "SELLER_AGENT",
    "ADMIN",
  ].includes(user.role);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canViewEscrow) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Escrow</h1>
          <p className="text-muted-foreground">Escrow management and funding status</p>
        </div>
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="inbox"
              title="Access Restricted"
              description="Escrow management is not available for your role."
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
          <h1 className="text-3xl font-bold tracking-tight">Escrow</h1>
          <p className="text-muted-foreground">Manage escrow assignments, funding, and disbursements</p>
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
          <h1 className="text-3xl font-bold tracking-tight">Escrow</h1>
          <p className="text-muted-foreground">
            Manage escrow assignments, funding, and disbursements
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Escrows</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{escrowTransactions.length}</div>
            <p className="text-xs text-muted-foreground">open transactions</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Escrow Transactions</CardTitle>
          <CardDescription>
            Transactions in under contract, due diligence, financing, or clear to close. Open a transaction to assign escrow, confirm earnest money, funding, or record disbursements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingSpinner size="sm" />
          ) : escrowTransactions.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No escrow transactions"
              description="Transactions with escrow activity will appear here when they reach under contract or later stages."
            />
          ) : (
            <ul className="space-y-2">
              {escrowTransactions.map((t) => (
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
