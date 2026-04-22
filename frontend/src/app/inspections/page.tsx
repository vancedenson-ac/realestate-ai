"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useTransactions, filterTransactionsByRole } from "@/hooks/use-transactions";
import { useQueries } from "@tanstack/react-query";
import { inspectionsApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/utils";
import { ClipboardCheck, Calendar, CheckCircle, Clock, ChevronRight } from "lucide-react";
import { STALE_TIME_DETAIL } from "@/lib/query-config";
import type { InspectionOverview } from "@/types/api";

const INSPECTION_RELEVANT_STATES = ["UNDER_CONTRACT", "DUE_DILIGENCE"];

export default function InspectionsPage() {
  const { user, isHydrated } = useAuth();
  const { data: transactionsData, isLoading: transactionsLoading, error, refetch } = useTransactions();
  const transactions = useMemo(
    () =>
      transactionsData?.data
        ? filterTransactionsByRole(transactionsData.data, user.role)
        : [],
    [transactionsData?.data, user.role]
  );
  const transactionIds = useMemo(
    () =>
      transactions
        .filter((t) => INSPECTION_RELEVANT_STATES.includes(t.current_state))
        .map((t) => t.transaction_id),
    [transactions]
  );

  const inspectionQueries = useQueries({
    queries: transactionIds.map((tid) => ({
      queryKey: ["transaction-inspections", tid, user.user_id, user.organization_id],
      queryFn: () => inspectionsApi.list(user, tid),
      enabled: !!user && !!tid,
      staleTime: STALE_TIME_DETAIL,
    })),
  });

  const allInspections: InspectionOverview[] = useMemo(() => {
    const list: InspectionOverview[] = [];
    inspectionQueries.forEach((q) => {
      if (q.data) list.push(...q.data);
    });
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [inspectionQueries]);

  const stats = useMemo(() => {
    let scheduled = 0;
    let inProgress = 0;
    let completed = 0;
    allInspections.forEach((i) => {
      const s = (i.status || "").toLowerCase();
      if (s === "scheduled") scheduled++;
      else if (s === "in_progress") inProgress++;
      else if (s === "completed") completed++;
    });
    return { scheduled, inProgress, completed };
  }, [allInspections]);

  const canViewInspections = [
    "INSPECTOR",
    "BUYER",
    "BUYER_AGENT",
    "SELLER",
    "SELLER_AGENT",
    "ADMIN",
  ].includes(user.role);

  const isLoading = transactionsLoading || (transactionIds.length > 0 && inspectionQueries.some((q) => q.isLoading));

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!canViewInspections) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground">Property inspection management</p>
        </div>
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="inbox"
              title="Access Restricted"
              description="Inspection management is not available for your role."
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
          <h1 className="text-3xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground">Schedule and manage property inspections</p>
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
          <h1 className="text-3xl font-bold tracking-tight">Inspections</h1>
          <p className="text-muted-foreground">Schedule and manage property inspections</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Scheduled</CardTitle>
            <Calendar className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.scheduled}</div>
            <p className="text-xs text-muted-foreground">upcoming inspections</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inProgress}</div>
            <p className="text-xs text-muted-foreground">being conducted</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completed}</div>
            <p className="text-xs text-muted-foreground">completed</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Inspections</CardTitle>
          <CardDescription>
            {user.role === "INSPECTOR"
              ? "Inspections assigned to you"
              : "Inspections on your transactions. Request an inspection from a transaction in due diligence."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingSpinner size="sm" />
          ) : allInspections.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No inspections yet"
              description="Inspections will appear here when scheduled. Open a transaction in due diligence to request an inspection."
            />
          ) : (
            <ul className="space-y-2">
              {allInspections.map((insp) => (
                <li
                  key={insp.inspection_id}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <ClipboardCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Badge variant="outline">{insp.status}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {insp.scheduled_at ? formatDateTime(insp.scheduled_at) : "—"} • {insp.inspection_id.slice(0, 8)}…
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/transactions/${insp.transaction_id}`}>
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
