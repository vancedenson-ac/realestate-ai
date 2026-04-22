"use client";

import { use, useState, useRef, useEffect, useMemo } from "react";
import { useAuth } from "@/context/auth-context";
import {
  useTransaction,
  useTransactionTimeline,
  useTransactionDocumentChecklist,
  useTransitionTransaction,
  useTransactionDocuments,
  useUploadDocument,
  useSignDocument,
  useDocumentVersions,
  useTransactionInspections,
  useCreateInspection,
} from "@/hooks/use-transactions";
import {
  useTransactionOffers,
  useSubmitOffer,
  useCounterOffer,
  useWithdrawOffer,
  useRejectOffer,
  useAcceptOffer,
} from "@/hooks/use-offers";
import { useCreateAppraisal } from "@/hooks/use-appraisals";
import {
  useEligibleEscrowOfficers,
  useEscrowAssignments,
  useEscrowEarnestMoney,
  useEscrowFunding,
  useEscrowDisbursements,
  useAssignEscrowOfficer,
  useConfirmEarnestMoney,
  useConfirmFunding,
  useRecordDisbursement,
} from "@/hooks/use-escrow";
import {
  useTitleOrders,
  useTitleCommitments,
  useDeedRecordings,
  useOwnershipTransfers,
  useCreateTitleOrder,
  useCreateTitleCommitment,
  useRecordDeed,
  useRecordOwnershipTransfer,
  useAppraisalWaivers,
  useWaiveAppraisal,
} from "@/hooks/use-title";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { TransactionStateBadge } from "@/components/transaction-state-badge";
import { LoadingPage, LoadingSpinner } from "@/components/loading-spinner";
import { formatCurrency, formatDate, formatDateTime, getStateDisplayName, getRoleDisplayName, DOCUMENT_TYPE_OPTIONS } from "@/lib/utils";
import { SEED_USERS } from "@/lib/seed-users";
import { toastError, toastSuccess } from "@/lib/toast";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Clock,
  DollarSign,
  Building2,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  MessageSquare,
  Upload,
  ClipboardList,
  PenLine,
  FileSignature,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  Ban,
  Scale,
  Banknote,
  KeyRound,
  UserCheck,
  ClipboardCheck,
} from "lucide-react";
import type { TransactionState } from "@/types/api";
import { ApiException } from "@/lib/api";
import {
  canOrderAppraisal,
  canWaiveAppraisal,
  canSignDocument,
  canSubmitOffer,
  canCounterOrWithdrawOffer,
  canRejectOrAcceptOffer,
  getAllowedDocumentTypesForUpload,
} from "@/lib/permissions";

const STATE_ORDER: TransactionState[] = [
  "PRE_LISTING",
  "LISTED",
  "OFFER_MADE",
  "UNDER_CONTRACT",
  "DUE_DILIGENCE",
  "FINANCING",
  "CLEAR_TO_CLOSE",
  "CLOSED",
];

// Allowed transitions by state and role
const TRANSITIONS: Record<string, { to: TransactionState; action: string; roles: string[] }[]> = {
  PRE_LISTING: [
    { to: "LISTED", action: "publish_listing", roles: ["SELLER_AGENT"] },
    { to: "CANCELLED", action: "cancel_transaction", roles: ["SELLER", "SELLER_AGENT"] },
  ],
  LISTED: [
    { to: "OFFER_MADE", action: "submit_offer", roles: ["BUYER", "BUYER_AGENT"] },
    { to: "CANCELLED", action: "cancel_transaction", roles: ["SELLER", "SELLER_AGENT"] },
  ],
  OFFER_MADE: [
    { to: "LISTED", action: "reject_offer", roles: ["SELLER", "SELLER_AGENT"] },
    { to: "UNDER_CONTRACT", action: "accept_offer", roles: ["SELLER", "SELLER_AGENT"] },
    { to: "CANCELLED", action: "cancel_transaction", roles: ["BUYER", "BUYER_AGENT", "SELLER", "SELLER_AGENT"] },
  ],
  UNDER_CONTRACT: [
    { to: "DUE_DILIGENCE", action: "open_escrow", roles: ["ESCROW_OFFICER"] },
    { to: "CANCELLED", action: "cancel_transaction", roles: ["BUYER", "SELLER", "ESCROW_OFFICER"] },
  ],
  DUE_DILIGENCE: [
    { to: "FINANCING", action: "complete_due_diligence", roles: ["BUYER_AGENT"] },
  ],
  FINANCING: [
    { to: "CLEAR_TO_CLOSE", action: "approve_funding", roles: ["LENDER"] },
  ],
  CLEAR_TO_CLOSE: [
    { to: "CLOSED", action: "close_transaction", roles: ["ESCROW_OFFICER"] },
  ],
};

// Optional precondition hints for transition buttons (backend is authority; these are UX hints only).
const TRANSITION_HINTS: Partial<Record<TransactionState, string>> = {
  DUE_DILIGENCE: "Requires: escrow assigned, earnest money confirmed, escrow instructions signed.",
  FINANCING: "Requires: title ordered, appraisal completed or waived.",
  CLEAR_TO_CLOSE: "Requires: title cleared, signed loan commitment.",
  CLOSED: "Requires: funding confirmed, disbursement recorded, deed recorded, ownership transfer confirmed.",
};

export default function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, isHydrated } = useAuth();
  const { data: transaction, isLoading, error, refetch } = useTransaction(id);
  const { data: timeline } = useTransactionTimeline(id);
  const { data: checklist } = useTransactionDocumentChecklist(id);
  const { data: documents, isLoading: documentsLoading } = useTransactionDocuments(id);
  const transitionMutation = useTransitionTransaction(id);
  const uploadDocMutation = useUploadDocument(id);
  const signDocMutation = useSignDocument();
  const [uploadDocType, setUploadDocType] = useState<string>("other");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [signingDocumentId, setSigningDocumentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createAppraisalMutation = useCreateAppraisal(id);
  const canOrderAppraisalRole = canOrderAppraisal(user.role);
  const { data: appraisalWaivers = [] } = useAppraisalWaivers(id);
  const waiveAppraisalMutation = useWaiveAppraisal(id);
  const canWaiveAppraisalRole = canWaiveAppraisal(user.role);
  const isDueDiligence = transaction?.current_state === "DUE_DILIGENCE";
  const { data: offers = [], isLoading: offersLoading } = useTransactionOffers(id);
  const submitOfferMutation = useSubmitOffer(id);
  const counterOfferMutation = useCounterOffer();
  const withdrawOfferMutation = useWithdrawOffer();
  const rejectOfferMutation = useRejectOffer();
  const acceptOfferMutation = useAcceptOffer();
  const [acceptOfferId, setAcceptOfferId] = useState<string | null>(null);
  const [acceptDocId, setAcceptDocId] = useState<string>("");
  const [assignOfficerId, setAssignOfficerId] = useState<string>("");
  const [expandedVersionDocId, setExpandedVersionDocId] = useState<string | null>(null);
  const { data: documentVersions = [] } = useDocumentVersions(expandedVersionDocId);
  const { data: eligibleEscrowOfficers = [] } = useEligibleEscrowOfficers();
  const { data: escrowAssignments = [] } = useEscrowAssignments(id);
  const { data: earnestMoneyList = [] } = useEscrowEarnestMoney(id);
  const { data: fundingList = [] } = useEscrowFunding(id);
  const { data: disbursementsList = [] } = useEscrowDisbursements(id);
  const assignEscrowMutation = useAssignEscrowOfficer(id);
  const confirmEarnestMutation = useConfirmEarnestMoney(id);
  const confirmFundingMutation = useConfirmFunding(id);
  const recordDisbursementMutation = useRecordDisbursement(id);
  const { data: titleOrders = [] } = useTitleOrders(id);
  const { data: titleCommitments = [] } = useTitleCommitments(id);
  const { data: deedRecordings = [] } = useDeedRecordings(id);
  const { data: ownershipTransfers = [] } = useOwnershipTransfers(id);
  const createTitleOrderMutation = useCreateTitleOrder(id);
  const createCommitmentMutation = useCreateTitleCommitment(id);
  const recordDeedMutation = useRecordDeed(id);
  const recordTransferMutation = useRecordOwnershipTransfer(id);
  const { data: inspections = [] } = useTransactionInspections(id);
  const createInspectionMutation = useCreateInspection(id);
  const [requestInspectionOpen, setRequestInspectionOpen] = useState(false);
  const [inspectionInspectorId, setInspectionInspectorId] = useState("");
  const [inspectionScheduledAt, setInspectionScheduledAt] = useState("");
  const inspectorOptions = useMemo(() => SEED_USERS.filter((u) => u.role === "INSPECTOR"), []);
  // Phase A.3: Escrow/Title form dialogs (EMD amount, disbursement amount/recipient, deed recording reference)
  const [emdDialogOpen, setEmdDialogOpen] = useState(false);
  const [emdAmount, setEmdAmount] = useState<string>("");
  const [emdNotes, setEmdNotes] = useState("");
  const [disbursementDialogOpen, setDisbursementDialogOpen] = useState(false);
  const [disbursementAmount, setDisbursementAmount] = useState("");
  const [disbursementRecipient, setDisbursementRecipient] = useState("");
  const [disbursementNotes, setDisbursementNotes] = useState("");
  const [deedDialogOpen, setDeedDialogOpen] = useState(false);
  const [deedRecordingReference, setDeedRecordingReference] = useState("");
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferNotes, setTransferNotes] = useState("");

  const allowedUploadTypes = useMemo(
    () => getAllowedDocumentTypesForUpload(user.role, transaction?.current_state ?? "PRE_LISTING"),
    [user.role, transaction?.current_state]
  );
  const uploadTypeOptions = useMemo(
    () => DOCUMENT_TYPE_OPTIONS.filter((o) => allowedUploadTypes.includes(o.value)),
    [allowedUploadTypes]
  );
  useEffect(() => {
    if (allowedUploadTypes.length && !allowedUploadTypes.includes(uploadDocType)) {
      setUploadDocType(allowedUploadTypes[0] ?? "other");
    }
  }, [allowedUploadTypes, uploadDocType]);

  useEffect(() => {
    if (acceptOfferId) setAcceptDocId("");
  }, [acceptOfferId]);

  const userCanSign = canSignDocument(user.role);

  function isSignableDoc(d: { document_id: string; view_url: string | null; execution_status?: string }): boolean {
    if (!userCanSign || !d.view_url) return false;
    const s = (d.execution_status || "").toLowerCase();
    return s !== "signed" && s !== "fully_executed";
  }

  function docStatusLabel(status: string): string {
    const s = (status || "").toLowerCase();
    if (s === "signed" || s === "fully_executed") return "Signed";
    if (s === "locked") return "Locked";
    if (s === "pending_signature" || s === "partially_signed") return "Pending signature";
    if (s === "void") return "Void";
    return status || "Draft";
  }

  useEffect(() => {
    if (error) toastError(error, "Failed to load transaction");
  }, [error]);
  useEffect(() => {
    if (!error && !isLoading && !transaction) toastError(new Error("Transaction not found"));
  }, [error, isLoading, transaction]);

  if (!isHydrated || isLoading) {
    return <LoadingPage />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/transactions">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Transactions
          </Link>
        </Button>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/transactions">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Transactions
          </Link>
        </Button>
      </div>
    );
  }

  // Calculate progress
  const currentStateIndex = STATE_ORDER.indexOf(transaction.current_state);
  const progress = transaction.current_state === "CANCELLED" 
    ? 0 
    : ((currentStateIndex + 1) / STATE_ORDER.length) * 100;

  // Get available transitions for current user
  const availableTransitions = TRANSITIONS[transaction.current_state]?.filter(
    (t) => t.roles.includes(user.role)
  ) || [];

  const handleTransition = (toState: TransactionState, action: string) => {
    transitionMutation.mutate(
      { to_state: toState, action },
      {
        onError: (err) => toastError(err, "Transition failed"),
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/transactions">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Transaction Details</h1>
              <TransactionStateBadge state={transaction.current_state} />
            </div>
            <p className="text-sm text-muted-foreground">
              ID: {transaction.transaction_id}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/transactions/${id}/chat`}>
              <MessageSquare className="mr-2 h-4 w-4" />
              Chat
            </Link>
          </Button>
          {availableTransitions.length > 0 && (
            <div className="flex gap-2">
              {availableTransitions.map((t) => {
                const hint = TRANSITION_HINTS[t.to];
                const btn = (
                  <Button
                    key={t.to}
                    onClick={() => {
                      if (t.to === "CANCELLED") {
                        if (typeof window !== "undefined" && !window.confirm("Cancel this transaction? This cannot be undone.")) {
                          return;
                        }
                      }
                      handleTransition(t.to, t.action);
                    }}
                    disabled={transitionMutation.isPending}
                    variant={t.to === "CANCELLED" ? "destructive" : "default"}
                  >
                    {transitionMutation.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                    {t.action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Button>
                );
                return hint ? (
                  <Tooltip key={t.to}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      {hint}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={t.to}>{btn}</span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              {STATE_ORDER.map((state, i) => (
                <span
                  key={state}
                  className={
                    i <= currentStateIndex && transaction.current_state !== "CANCELLED"
                      ? "text-primary font-medium"
                      : ""
                  }
                >
                  {getStateDisplayName(state)}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase A.2: Precondition checklist for next transition */}
      {availableTransitions.length > 0 && availableTransitions[0].to !== "CANCELLED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next transition: {getStateDisplayName(availableTransitions[0].to)}</CardTitle>
            <CardDescription>
              {TRANSITION_HINTS[availableTransitions[0].to] ?? "Complete required steps above, then use the transition button."}
            </CardDescription>
          </CardHeader>
          {checklist && checklist.length > 0 && (
            <CardContent className="pt-0">
              <p className="text-sm font-medium mb-2">Requirements for this transition</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {checklist
                  .filter((item) => item.required_for_to_state === availableTransitions[0].to)
                  .map((item, i) =>
                    item.kind === "milestone" ? (
                      <li key={`m-${i}`} className="flex items-center gap-2">
                        {item.present ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0" />
                        )}
                        {item.label}
                        {!item.present && " (not yet done)"}
                      </li>
                    ) : (
                      <li key={`d-${i}`} className="flex items-center gap-2">
                        {item.present && item.signed ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : item.present ? (
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0" />
                        )}
                        {item.document_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        {!item.present && " (missing)"}
                        {item.present && !item.signed && " (unsigned)"}
                      </li>
                    )
                  )}
                {checklist.filter((item) => item.required_for_to_state === availableTransitions[0].to).length === 0 && (
                  <li>No requirements for this transition.</li>
                )}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="escrow">Escrow</TabsTrigger>
          <TabsTrigger value="title">Title</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Transaction Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Transaction Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">State</span>
                  <TransactionStateBadge state={transaction.current_state} />
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">State Since</span>
                  <span>{formatDateTime(transaction.state_entered_at)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDate(transaction.created_at)}</span>
                </div>
                {transaction.jurisdiction && (
                  <>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Jurisdiction</span>
                      <span>{transaction.jurisdiction}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Financial Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Financial</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Offer Price</span>
                  <span className="font-semibold">
                    {transaction.offer_price
                      ? formatCurrency(transaction.offer_price)
                      : "Not set"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Property/Listing */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Related</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {transaction.property_id ? (
                  <Link
                    href={`/properties/${transaction.property_id}`}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>Property</span>
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">No property linked</p>
                )}
                {transaction.listing_id && (
                  <Link
                    href={`/listings/${transaction.listing_id}`}
                    className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span>Listing</span>
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              </CardContent>
            </Card>
            {transaction.current_state === "DUE_DILIGENCE" && (
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5" />
                    Inspections
                  </CardTitle>
                  <CardDescription>Request and view inspections for this transaction</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {inspections.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {inspections.map((i) => (
                        <li key={i.inspection_id}>
                          {i.status} — {i.scheduled_at ? formatDateTime(i.scheduled_at) : "—"}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRequestInspectionOpen(true)}
                    disabled={createInspectionMutation.isPending}
                  >
                    {createInspectionMutation.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                    Request inspection
                  </Button>
                  <Dialog open={requestInspectionOpen} onOpenChange={setRequestInspectionOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Request inspection</DialogTitle>
                        <DialogDescription>Schedule an inspection for this transaction.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium">Inspector</label>
                          <select
                            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                            value={inspectionInspectorId}
                            onChange={(e) => setInspectionInspectorId(e.target.value)}
                          >
                            <option value="">Select…</option>
                            {inspectorOptions.map((u) => (
                              <option key={u.user_id} value={u.user_id}>
                                {u.full_name || u.email}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Scheduled at</label>
                          <input
                            type="datetime-local"
                            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                            value={inspectionScheduledAt}
                            onChange={(e) => setInspectionScheduledAt(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setRequestInspectionOpen(false)}>Cancel</Button>
                        <Button
                          disabled={!inspectionInspectorId || !inspectionScheduledAt || createInspectionMutation.isPending}
                          onClick={() => {
                            if (!inspectionInspectorId || !inspectionScheduledAt) return;
                            const scheduledAt = new Date(inspectionScheduledAt).toISOString();
                            createInspectionMutation.mutate(
                              { inspector_id: inspectionInspectorId, scheduled_at: scheduledAt },
                              {
                                onSuccess: () => {
                                  setRequestInspectionOpen(false);
                                  setInspectionInspectorId("");
                                  setInspectionScheduledAt("");
                                  toastSuccess("Inspection requested");
                                },
                                onError: (err) => toastError(err, "Failed to request inspection"),
                              }
                            );
                          }}
                        >
                          Request
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="offers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Offers</CardTitle>
              <CardDescription>
                Submit, counter, withdraw, reject, or accept offers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {transaction.current_state === "LISTED" && canSubmitOffer(user.role) && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
                  <Button
                    onClick={() =>
                      submitOfferMutation.mutate(
                        {},
                        {
                          onSuccess: () => toastSuccess("Offer submitted"),
                          onError: (err) => toastError(err, "Failed to submit offer"),
                        }
                      )
                    }
                    disabled={submitOfferMutation.isPending}
                  >
                    {submitOfferMutation.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                    <FileSignature className="mr-2 h-4 w-4" />
                    Submit offer
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Submit an offer on this listing. You can optionally upload an offer document in the Documents tab first and attach it when countering.
                  </p>
                </div>
              )}
              {offersLoading ? (
                <LoadingSpinner size="sm" />
              ) : offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No offers yet.</p>
              ) : (
                <ul className="space-y-3">
                  {offers.map((offer) => {
                    const isLatest =
                      offer.status === "SUBMITTED" ||
                      (offers.length > 0 && offers[0].offer_id === offer.offer_id);
                    const canCounterWithdraw =
                      canCounterOrWithdrawOffer(user.role) &&
                      isLatest &&
                      (offer.status === "SUBMITTED" || offer.status === "COUNTERED");
                    const canRejectAccept =
                      canRejectOrAcceptOffer(user.role) && isLatest && offer.status === "SUBMITTED";
                    return (
                      <li
                        key={offer.offer_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">Offer {offer.offer_id.slice(0, 8)}…</span>
                          <Badge variant="outline">{offer.status}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(offer.created_at)}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          {canCounterWithdraw && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={counterOfferMutation.isPending}
                                onClick={() => {
                                  counterOfferMutation.mutate(
                                    { offerId: offer.offer_id, terms: {} },
                                    {
                                      onError: (err) => toastError(err, "Counter failed"),
                                    }
                                  );
                                }}
                              >
                                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                Counter
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={withdrawOfferMutation.isPending}
                                onClick={() => {
                                  withdrawOfferMutation.mutate(
                                    { offerId: offer.offer_id },
                                    {
                                      onSuccess: () => toastSuccess("Offer withdrawn"),
                                      onError: (err) => toastError(err, "Withdraw failed"),
                                    }
                                  );
                                }}
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" />
                                Withdraw
                              </Button>
                            </>
                          )}
                          {canRejectAccept && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={rejectOfferMutation.isPending}
                                onClick={() => {
                                  rejectOfferMutation.mutate(
                                    { offerId: offer.offer_id },
                                    { onError: (err) => toastError(err, "Reject failed") }
                                  );
                                }}
                              >
                                <ThumbsDown className="mr-1 h-3.5 w-3.5" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => setAcceptOfferId(offer.offer_id)}
                              >
                                <ThumbsUp className="mr-1 h-3.5 w-3.5" />
                                Accept
                              </Button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Dialog open={!!acceptOfferId} onOpenChange={(open) => !open && setAcceptOfferId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Accept offer</DialogTitle>
                <DialogDescription>
                  Select a signed purchase agreement document to accept this offer.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-sm font-medium">Purchase agreement (signed)</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={acceptDocId}
                  onChange={(e) => setAcceptDocId(e.target.value)}
                >
                  <option value="">Select document…</option>
                  {documents
                    ?.filter(
                      (d) =>
                        d.document_type === "purchase_agreement" &&
                        ((d.execution_status || "").toLowerCase() === "signed" ||
                          (d.execution_status || "").toLowerCase() === "fully_executed")
                    )
                    .map((d) => (
                      <option key={d.document_id} value={d.document_id}>
                        Purchase agreement — {d.execution_status || "signed"}
                      </option>
                    ))}
                </select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAcceptOfferId(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!acceptOfferId || !acceptDocId || acceptOfferMutation.isPending}
                  onClick={() => {
                    if (!acceptOfferId || !acceptDocId) return;
                    acceptOfferMutation.mutate(
                      {
                        offerId: acceptOfferId,
                        purchase_agreement_document_id: acceptDocId,
                      },
                      {
                        onSuccess: () => {
                          setAcceptOfferId(null);
                          setAcceptDocId("");
                          toastSuccess("Offer accepted");
                        },
                        onError: (err) => toastError(err, "Failed to accept offer"),
                      }
                    );
                  }}
                >
                  {acceptOfferMutation.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                  Accept offer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="escrow" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Escrow
              </CardTitle>
              <CardDescription>Assignments, earnest money, funding, disbursements</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {escrowAssignments.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Assignments</p>
                  <ul className="space-y-1 text-sm">
                    {escrowAssignments.map((a) => (
                      <li key={a.assignment_id}>
                        Escrow officer assigned {formatDateTime(a.assigned_at)}
                        {a.is_active && <Badge className="ml-2">Active</Badge>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {user.role === "ESCROW_OFFICER" && transaction?.current_state === "UNDER_CONTRACT" && escrowAssignments.length === 0 && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                  <label className="text-sm font-medium">Assign escrow officer</label>
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    value={assignOfficerId}
                    onChange={(e) => setAssignOfficerId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {eligibleEscrowOfficers.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.full_name || u.email}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!assignOfficerId || assignEscrowMutation.isPending}
                    onClick={() => {
                      if (!assignOfficerId) return;
                      assignEscrowMutation.mutate(
                        { escrow_officer_id: assignOfficerId },
                        {
                          onSuccess: () => { setAssignOfficerId(""); toastSuccess("Escrow officer assigned"); },
                          onError: (err) => toastError(err, "Assign failed"),
                        }
                      );
                    }}
                  >
                    {assignEscrowMutation.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                    <UserCheck className="mr-2 h-4 w-4" />
                    Assign
                  </Button>
                </div>
              )}
              {earnestMoneyList.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Earnest money</p>
                  <ul className="space-y-1 text-sm">
                    {earnestMoneyList.map((e) => (
                      <li key={e.deposit_id}>
                        {e.amount != null ? formatCurrency(e.amount) : "—"} confirmed {formatDateTime(e.confirmed_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {user.role === "ESCROW_OFFICER" && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={confirmEarnestMutation.isPending} onClick={() => setEmdDialogOpen(true)}>
                    <DollarSign className="mr-1 h-4 w-4" />
                    Confirm earnest money
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={confirmFundingMutation.isPending}
                    onClick={() =>
                      confirmFundingMutation.mutate(
                        { verified: true },
                        { onSuccess: () => toastSuccess("Funding confirmed"), onError: (err) => toastError(err, "Confirm failed") }
                      )
                    }
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    Confirm funding
                  </Button>
                  <Button variant="outline" size="sm" disabled={recordDisbursementMutation.isPending} onClick={() => setDisbursementDialogOpen(true)}>
                    <Banknote className="mr-1 h-4 w-4" />
                    Record disbursement
                  </Button>
                </div>
              )}
              {fundingList.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Funding</p>
                  <ul className="space-y-1 text-sm">
                    {fundingList.map((f) => (
                      <li key={f.confirmation_id}>Confirmed {formatDateTime(f.confirmed_at)} {f.verified && "(verified)"}</li>
                    ))}
                  </ul>
                </div>
              )}
              {disbursementsList.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Disbursements</p>
                  <ul className="space-y-1 text-sm">
                    {disbursementsList.map((d) => (
                      <li key={d.disbursement_id}>
                        {d.amount != null ? formatCurrency(d.amount) : "—"} to {d.recipient || "—"} {formatDateTime(d.recorded_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phase A.3: EMD confirm dialog */}
          <Dialog open={emdDialogOpen} onOpenChange={setEmdDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm earnest money</DialogTitle>
                <DialogDescription>Enter amount and optional notes.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="emd-amount">Amount (optional)</Label>
                  <Input
                    id="emd-amount"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="e.g. 10000"
                    value={emdAmount}
                    onChange={(e) => setEmdAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="emd-notes">Notes (optional)</Label>
                  <Input id="emd-notes" value={emdNotes} onChange={(e) => setEmdNotes(e.target.value)} placeholder="Notes" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEmdDialogOpen(false)}>Cancel</Button>
                <Button
                  disabled={confirmEarnestMutation.isPending}
                  onClick={() => {
                    const amount = emdAmount ? parseFloat(emdAmount) : undefined;
                    confirmEarnestMutation.mutate(
                      { amount: Number.isFinite(amount) ? amount : undefined, notes: emdNotes.trim() || undefined },
                      {
                        onSuccess: () => {
                          toastSuccess("Earnest money confirmed");
                          setEmdDialogOpen(false);
                          setEmdAmount("");
                          setEmdNotes("");
                        },
                        onError: (err) => toastError(err, "Confirm failed"),
                      }
                    );
                  }}
                >
                  Confirm
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Phase A.3: Record disbursement dialog */}
          <Dialog open={disbursementDialogOpen} onOpenChange={setDisbursementDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record disbursement</DialogTitle>
                <DialogDescription>Enter amount, recipient, and optional notes.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="disb-amount">Amount (optional)</Label>
                  <Input
                    id="disb-amount"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="e.g. 50000"
                    value={disbursementAmount}
                    onChange={(e) => setDisbursementAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="disb-recipient">Recipient (optional)</Label>
                  <Input
                    id="disb-recipient"
                    value={disbursementRecipient}
                    onChange={(e) => setDisbursementRecipient(e.target.value)}
                    placeholder="Recipient name or account"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="disb-notes">Notes (optional)</Label>
                  <Input id="disb-notes" value={disbursementNotes} onChange={(e) => setDisbursementNotes(e.target.value)} placeholder="Notes" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDisbursementDialogOpen(false)}>Cancel</Button>
                <Button
                  disabled={recordDisbursementMutation.isPending}
                  onClick={() => {
                    const amount = disbursementAmount ? parseFloat(disbursementAmount) : NaN;
                    if (!Number.isFinite(amount)) {
                      toastError(new Error("Please enter a valid amount"));
                      return;
                    }
                    recordDisbursementMutation.mutate(
                      {
                        amount,
                        recipient: disbursementRecipient.trim() || "",
                        notes: disbursementNotes.trim() || undefined,
                      },
                      {
                        onSuccess: () => {
                          toastSuccess("Disbursement recorded");
                          setDisbursementDialogOpen(false);
                          setDisbursementAmount("");
                          setDisbursementRecipient("");
                          setDisbursementNotes("");
                        },
                        onError: (err) => toastError(err, "Record failed"),
                      }
                    );
                  }}
                >
                  Record
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="title" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Title &amp; Closing
              </CardTitle>
              <CardDescription>Title orders, commitments, deed recording, ownership transfer</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {titleOrders.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Title orders</p>
                  <ul className="space-y-1 text-sm">
                    {titleOrders.map((o) => (
                      <li key={o.title_order_id}>{o.status} — {formatDateTime(o.ordered_at)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {user.role === "ESCROW_OFFICER" && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={createTitleOrderMutation.isPending}
                    onClick={() =>
                      createTitleOrderMutation.mutate(
                        {},
                        { onSuccess: () => toastSuccess("Title order created"), onError: (err) => toastError(err, "Create failed") }
                      )
                    }
                  >
                    <FileText className="mr-1 h-4 w-4" />
                    Create title order
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={createCommitmentMutation.isPending}
                    onClick={() =>
                      createCommitmentMutation.mutate(
                        {},
                        { onSuccess: () => toastSuccess("Commitment added"), onError: (err) => toastError(err, "Create failed") }
                      )
                    }
                  >
                    <FileText className="mr-1 h-4 w-4" />
                    Add commitment
                  </Button>
                  <Button variant="outline" size="sm" disabled={recordDeedMutation.isPending} onClick={() => setDeedDialogOpen(true)}>
                    <KeyRound className="mr-1 h-4 w-4" />
                    Record deed
                  </Button>
                  <Button variant="outline" size="sm" disabled={recordTransferMutation.isPending} onClick={() => setTransferDialogOpen(true)}>
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    Confirm transfer
                  </Button>
                </div>
              )}
              {titleCommitments.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Commitments</p>
                  <ul className="space-y-1 text-sm">
                    {titleCommitments.map((c) => (
                      <li key={c.commitment_id}>Received {formatDateTime(c.received_at)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {deedRecordings.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Deed recordings</p>
                  <ul className="space-y-1 text-sm">
                    {deedRecordings.map((r) => (
                      <li key={r.recording_id}>{r.recording_reference || "Recorded"} {formatDateTime(r.recorded_at)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {ownershipTransfers.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Ownership transfers</p>
                  <ul className="space-y-1 text-sm">
                    {ownershipTransfers.map((t) => (
                      <li key={t.transfer_id}>Confirmed {formatDateTime(t.transferred_at)} {t.notes ? `— ${t.notes}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phase A.3: Record deed dialog (recording reference) */}
          <Dialog open={deedDialogOpen} onOpenChange={setDeedDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record deed</DialogTitle>
                <DialogDescription>Enter recording reference (e.g. book/page or instrument number).</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="deed-ref">Recording reference (optional)</Label>
                  <Input
                    id="deed-ref"
                    value={deedRecordingReference}
                    onChange={(e) => setDeedRecordingReference(e.target.value)}
                    placeholder="e.g. Book 1234 / Page 56"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeedDialogOpen(false)}>Cancel</Button>
                <Button
                  disabled={recordDeedMutation.isPending}
                  onClick={() => {
                    recordDeedMutation.mutate(
                      { recording_reference: deedRecordingReference.trim() || undefined },
                      {
                        onSuccess: () => {
                          toastSuccess("Deed recorded");
                          setDeedDialogOpen(false);
                          setDeedRecordingReference("");
                        },
                        onError: (err) => toastError(err, "Record failed"),
                      }
                    );
                  }}
                >
                  Record
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Phase A.3: Confirm ownership transfer dialog (notes) */}
          <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm ownership transfer</DialogTitle>
                <DialogDescription>Add optional notes for the transfer record.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="transfer-notes">Notes (optional)</Label>
                  <Input id="transfer-notes" value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} placeholder="Notes" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>Cancel</Button>
                <Button
                  disabled={recordTransferMutation.isPending}
                  onClick={() => {
                    recordTransferMutation.mutate(
                      { notes: transferNotes.trim() || undefined },
                      {
                        onSuccess: () => {
                          toastSuccess("Ownership transfer confirmed");
                          setTransferDialogOpen(false);
                          setTransferNotes("");
                        },
                        onError: (err) => toastError(err, "Record failed"),
                      }
                    );
                  }}
                >
                  Confirm
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>State History</CardTitle>
              <CardDescription>Timeline of state changes</CardDescription>
            </CardHeader>
            <CardContent>
              {timeline?.state_changes && timeline.state_changes.length > 0 ? (
                <div className="space-y-4">
                  {timeline.state_changes.map((change, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <ChevronRight className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <TransactionStateBadge state={change.from_state} />
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          <TransactionStateBadge state={change.to_state} />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDateTime(change.entered_at)}
                          <span>by {getRoleDisplayName(change.actor_role)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No state changes recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload Document</CardTitle>
              <CardDescription>Create a document and upload a file (saved to MinIO/storage)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type</label>
                  <select
                    className="flex h-9 w-[220px] rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                  >
                    {uploadTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="sr-only"
                  aria-hidden
                  onChange={(e) => {
                    setUploadFile(e.target.files?.[0] ?? null);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadDocMutation.isPending}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {uploadFile ? uploadFile.name : "Choose file"}
                </Button>
                <Button
                  disabled={!uploadFile || uploadDocMutation.isPending}
                  onClick={() => {
                    if (!uploadFile) return;
                    uploadDocMutation.mutate(
                      { documentType: uploadDocType as import("@/types/api").DocumentType, file: uploadFile },
                      {
                        onSuccess: () => setUploadFile(null),
                        onError: (err) => toastError(err, "Upload failed. Please try again."),
                      }
                    );
                  }}
                >
                  {uploadDocMutation.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </div>
            </CardContent>
          </Card>

          {canOrderAppraisalRole ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Appraisals
                </CardTitle>
                <CardDescription>
                  Only lenders and escrow officers can order an appraisal for this transaction.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  disabled={createAppraisalMutation.isPending}
                  onClick={() => {
                    createAppraisalMutation.mutate(
                      {},
                      {
                        onError: (err) => toastError(err, "Failed to order appraisal"),
                      }
                    );
                  }}
                >
                  {createAppraisalMutation.isPending ? (
                    <LoadingSpinner size="sm" className="mr-2" />
                  ) : null}
                  Order appraisal
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Appraisals
                </CardTitle>
                <CardDescription>
                  Only the lender or escrow officer can order an appraisal for this transaction. If you need an appraisal, ask your lender or escrow officer.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {isDueDiligence && canWaiveAppraisalRole ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5" />
                  Appraisal waiver
                </CardTitle>
                <CardDescription>
                  Waiving the appraisal allows the transaction to move to Financing when no appraisal is required. You can then use &quot;Complete due diligence&quot; to advance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {appraisalWaivers.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Appraisal waived on {formatDateTime(appraisalWaivers[0].waived_at)}
                    {appraisalWaivers[0].reason ? ` — ${appraisalWaivers[0].reason}` : ""}
                  </p>
                ) : (
                  <Button
                    variant="outline"
                    disabled={waiveAppraisalMutation.isPending}
                    onClick={() => {
                      waiveAppraisalMutation.mutate(
                        {},
                        {
                          onSuccess: () => toastSuccess("Appraisal waived"),
                          onError: (err) => toastError(err, "Failed to waive appraisal"),
                        }
                      );
                    }}
                  >
                    {waiveAppraisalMutation.isPending ? (
                      <LoadingSpinner size="sm" className="mr-2" />
                    ) : null}
                    Waive appraisal
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Transaction Documents</CardTitle>
              <CardDescription>Documents attached to this transaction</CardDescription>
            </CardHeader>
            <CardContent>
              {documentsLoading ? (
                <LoadingSpinner size="sm" />
              ) : documents && documents.length > 0 ? (
                <ul className="space-y-2">
                  {documents.map((d) => {
                    const signable = isSignableDoc(d);
                    const statusLabel = d.view_url ? docStatusLabel(d.execution_status || "") : "Upload pending";
                    const isSigned =
                      (d.execution_status || "").toLowerCase() === "signed" ||
                      (d.execution_status || "").toLowerCase() === "fully_executed";
                    return (
                      <li
                        key={d.document_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">
                            {d.document_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                          <Badge
                            variant={isSigned ? "default" : statusLabel === "Locked" ? "secondary" : "outline"}
                            className={isSigned ? "bg-green-600 hover:bg-green-600" : undefined}
                          >
                            {statusLabel}
                          </Badge>
                          {!userCanSign && d.view_url && !isSigned && (
                            <span className="text-xs text-muted-foreground" title="Only transaction parties can sign">
                              (Sign: party only)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {d.view_url ? (
                            <Button variant="outline" size="sm" asChild>
                              <a href={d.view_url} target="_blank" rel="noopener noreferrer">
                                View / Download
                              </a>
                            </Button>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                          {signable && (
                            <Button
                              size="sm"
                              disabled={signDocMutation.isPending}
                              onClick={() => {
                                setSigningDocumentId(d.document_id);
                                signDocMutation.mutate(d.document_id, {
                                  onSuccess: () => {
                                    setSigningDocumentId(null);
                                    toastSuccess("Document signed.");
                                  },
                                  onError: (err) => {
                                    setSigningDocumentId(null);
                                    toastError(err, "Failed to sign document");
                                  },
                                });
                              }}
                            >
                              {signingDocumentId === d.document_id ? (
                                <LoadingSpinner size="sm" className="mr-2" />
                              ) : (
                                <PenLine className="mr-2 h-4 w-4" />
                              )}
                              Sign
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedVersionDocId(
                                expandedVersionDocId === d.document_id ? null : d.document_id
                              )
                            }
                          >
                            Version history
                          </Button>
                        </div>
                        {expandedVersionDocId === d.document_id && (
                          <div className="mt-2 w-full border-t pt-2 text-sm">
                            {documentVersions.length === 0 ? (
                              <p className="text-muted-foreground">No versions yet.</p>
                            ) : (
                              <ul className="space-y-1 text-muted-foreground">
                                {documentVersions.map((v, i) => (
                                  <li key={v.version_id}>
                                    Version {documentVersions.length - i} — {formatDateTime(v.created_at)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No documents yet. Upload one above.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Document Checklist</CardTitle>
              <CardDescription>Required documents for state transitions</CardDescription>
            </CardHeader>
            <CardContent>
              {checklist && checklist.length > 0 ? (
                <div className="space-y-3">
                  {checklist.map((item, i) =>
                    item.kind === "milestone" ? (
                      <div
                        key={`m-${i}`}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-3">
                          {item.present ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              Required for: {getStateDisplayName(item.required_for_to_state)}
                            </p>
                          </div>
                        </div>
                        {item.present && <Badge variant="outline">Done</Badge>}
                      </div>
                    ) : (
                      <div
                        key={`d-${i}`}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="flex items-center gap-3">
                          {item.present && item.signed ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : item.present ? (
                            <AlertCircle className="h-5 w-5 text-amber-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">
                              {item.document_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Required for: {getStateDisplayName(item.required_for_to_state)}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {item.present && <Badge variant="outline">Present</Badge>}
                          {item.signed && <Badge variant="success">Signed</Badge>}
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No documents or milestones in checklist.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
