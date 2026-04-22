"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import {
  useTransactions,
  useUploadDocument,
  useAllDocuments,
  useSignDocument,
  filterTransactionsByRole,
} from "@/hooks/use-transactions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { canSignDocument, getAllowedDocumentTypesForUpload } from "@/lib/permissions";
import { FileText, Upload, Clock, PenTool, FileCheck, PenLine } from "lucide-react";
import { toastError, toastSuccess } from "@/lib/toast";
import { DOCUMENT_TYPE_OPTIONS, getStateDisplayName } from "@/lib/utils";
import type { DocumentOverview } from "@/types/api";

export default function DocumentsPage() {
  const { user, isHydrated } = useAuth();
  const uploadCardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: transactionsData, isLoading: transactionsLoading } = useTransactions();
  const transactions = transactionsData?.data
    ? filterTransactionsByRole(transactionsData.data, user.role)
    : [];
  const [selectedTransactionId, setSelectedTransactionId] = useState<string>("");
  const [uploadDocType, setUploadDocType] = useState<string>("other");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [signingDocumentId, setSigningDocumentId] = useState<string | null>(null);

  const transactionId = selectedTransactionId || (transactions[0]?.transaction_id ?? "");
  const selectedTransaction = useMemo(
    () => transactions.find((t) => t.transaction_id === (selectedTransactionId || transactionId)),
    [transactions, selectedTransactionId, transactionId]
  );
  const uploadTransactionState = selectedTransaction?.current_state ?? "PRE_LISTING";
  const allowedUploadTypes = useMemo(
    () => getAllowedDocumentTypesForUpload(user.role, uploadTransactionState),
    [user.role, uploadTransactionState]
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
  const uploadDocMutation = useUploadDocument(transactionId);
  const signDocMutation = useSignDocument();
  const { data: allDocuments, isLoading: documentsLoading } = useAllDocuments();

  const userCanSign = canSignDocument(user.role);

  function isSignable(doc: DocumentOverview): boolean {
    if (!userCanSign || !doc.view_url) return false;
    const s = (doc.execution_status || "").toLowerCase();
    return s !== "signed" && s !== "fully_executed";
  }

  function executionStatusLabel(status: string): string {
    const s = (status || "").toLowerCase();
    if (s === "signed" || s === "fully_executed") return "Signed";
    if (s === "locked") return "Locked";
    if (s === "pending_signature" || s === "partially_signed") return "Pending signature";
    if (s === "void") return "Void";
    return status || "Draft";
  }

  const stats = (() => {
    const total = allDocuments?.length ?? 0;
    const draft = allDocuments?.filter((d) => d.execution_status === "draft").length ?? 0;
    const pendingSignature = allDocuments?.filter(
      (d) =>
        d.execution_status === "pending_signature" || d.execution_status === "partially_signed"
    ).length ?? 0;
    const executed = allDocuments?.filter(
      (d) => d.execution_status === "fully_executed" || d.execution_status === "signed"
    ).length ?? 0;
    return { total, draft, pendingSignature, executed };
  })();

  const handleUploadClick = () => {
    uploadCardRef.current?.scrollIntoView({ behavior: "smooth" });
    if (transactionId) setTimeout(() => fileInputRef.current?.click(), 300);
  };

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Manage transaction documents and signatures
          </p>
        </div>
        <Button onClick={handleUploadClick}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Document
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentsLoading ? "—" : stats.total}</div>
            <p className="text-xs text-muted-foreground">documents</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Draft</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentsLoading ? "—" : stats.draft}</div>
            <p className="text-xs text-muted-foreground">pending upload</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Signature</CardTitle>
            <PenTool className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentsLoading ? "—" : stats.pendingSignature}</div>
            <p className="text-xs text-muted-foreground">awaiting signatures</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Executed</CardTitle>
            <FileCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documentsLoading ? "—" : stats.executed}</div>
            <p className="text-xs text-muted-foreground">fully signed</p>
          </CardContent>
        </Card>
      </div>

      {/* Upload Document card — same pattern as property image upload */}
      <Card ref={uploadCardRef}>
        <CardHeader>
          <CardTitle>Upload Document</CardTitle>
          <CardDescription>
            Choose a transaction, document type, and file. PDF only. File is saved to MinIO/storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Transaction</label>
              <select
                className="flex h-9 w-[280px] rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={selectedTransactionId || transactionId}
                onChange={(e) => setSelectedTransactionId(e.target.value)}
                disabled={transactionsLoading || transactions.length === 0}
              >
                {transactions.length === 0 ? (
                  <option value="">No transactions</option>
                ) : (
                  transactions.map((t) => (
                    <option key={t.transaction_id} value={t.transaction_id}>
                      {getStateDisplayName(t.current_state)} — {t.transaction_id.slice(0, 8)}…
                    </option>
                  ))
                )}
              </select>
            </div>
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
              disabled={!transactionId || uploadDocMutation.isPending}
            >
              <FileText className="mr-2 h-4 w-4" />
              {uploadFile ? uploadFile.name : "Choose file"}
            </Button>
            <Button
              disabled={!transactionId || !uploadFile || uploadDocMutation.isPending}
              onClick={() => {
                if (!uploadFile || !transactionId) return;
                uploadDocMutation.mutate(
                  {
                    documentType: uploadDocType as import("@/types/api").DocumentType,
                    file: uploadFile,
                  },
                  {
                    onSuccess: () => {
                      setUploadFile(null);
                    },
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
          {transactions.length === 0 && !transactionsLoading && (
            <p className="text-sm text-muted-foreground">
              <Link href="/transactions/new" className="underline">
                Create a transaction
              </Link>{" "}
              to upload documents.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Documents List */}
      <Card>
        <CardHeader>
          <CardTitle>All Documents</CardTitle>
          <CardDescription>
            Documents across all your transactions. Open a transaction to see its documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documentsLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="lg" />
            </div>
          ) : allDocuments && allDocuments.length > 0 ? (
            <ul className="space-y-2">
              {allDocuments.map((d) => {
                const signable = isSignable(d);
                const statusLabel = d.view_url
                  ? executionStatusLabel(d.execution_status)
                  : "Upload pending";
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
                      <span className="font-medium capitalize">
                        {d.document_type.replace(/_/g, " ")}
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
                      <Link
                        href={`/transactions/${d.transaction_id}`}
                        className="text-sm text-muted-foreground hover:underline"
                      >
                        Transaction {d.transaction_id.slice(0, 8)}…
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon="file"
            title="No documents yet"
            description="Use the upload card above or go to a transaction’s Documents tab to upload."
          />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
