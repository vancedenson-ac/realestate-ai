"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useListing, useUpdateListing } from "@/hooks/use-listings";
import { useSavedListings, useSaveListing, useUnsaveListing } from "@/hooks/use-recommendations";
import { useListingShowings, useScheduleShowing, useShowingFeedback, useAddShowingFeedback } from "@/hooks/use-showings";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/loading-spinner";
import { formatCurrency, formatDate, formatDateTime, getShowingTypeLabel, SHOWING_FEEDBACK_RATING_OPTIONS } from "@/lib/utils";
import { ApiException } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { ArrowLeft, Building2, Calendar, Clock, DollarSign, Eye, EyeOff, FileText, MessageSquare, Pencil, Plus, Send, Bookmark, BookmarkCheck, FileSignature, MapIcon } from "lucide-react";
import { canAddShowingFeedback, canMakeOffer, canScheduleShowing, canUpdateListing } from "@/lib/permissions";
import type { ShowingFeedbackRating, UserRole } from "@/types/api";

function ShowingFeedbackBlock({
  showingId,
  listingId,
  userRole,
}: {
  showingId: string;
  listingId: string;
  userRole: UserRole;
}) {
  const { data: feedbackList = [] } = useShowingFeedback(showingId);
  const addMutation = useAddShowingFeedback(showingId, listingId);
  const [rating, setRating] = useState<ShowingFeedbackRating>("NEUTRAL");
  const [notes, setNotes] = useState("");
  const canAdd = canAddShowingFeedback(userRole);

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare className="h-4 w-4" />
        Feedback ({feedbackList.length})
      </div>
      {feedbackList.length > 0 && (
        <ul className="space-y-1 text-sm">
          {feedbackList.map((f) => (
            <li key={f.feedback_id} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{f.rating ?? "—"}</Badge>
              {f.notes && <span className="text-muted-foreground">{f.notes}</span>}
              <span className="text-xs text-muted-foreground">{formatDateTime(f.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="flex flex-wrap items-end gap-2">
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={rating}
            onChange={(e) => setRating(e.target.value as ShowingFeedbackRating)}
          >
            {SHOWING_FEEDBACK_RATING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            className="h-8 flex-1 min-w-[120px] rounded-md border border-input bg-background px-2 text-sm"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            size="sm"
            disabled={addMutation.isPending}
            onClick={() => {
              addMutation.mutate(
                { rating, notes: notes.trim() || undefined },
                {
                  onSuccess: () => setNotes(""),
                  onError: (err) => toastError(err, "Failed to add feedback"),
                }
              );
            }}
          >
            {addMutation.isPending ? <LoadingSpinner size="sm" className="mr-1" /> : null}
            Add feedback
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, isHydrated } = useAuth();
  const { data: listing, isLoading, error, refetch } = useListing(id);
  const updateMutation = useUpdateListing(id);
  const { data: savedListings } = useSavedListings();
  const saveMutation = useSaveListing();
  const unsaveMutation = useUnsaveListing();
  const savedListingIds = new Set((savedListings ?? []).map((s) => s.listing_id));
  const isSaved = savedListingIds.has(id);
  const canSaveListing = (user.role === "BUYER" || user.role === "BUYER_AGENT") && listing?.is_public && listing?.status !== "DRAFT";

  const { data: showings = [], isLoading: showingsLoading } = useListingShowings(id);
  const scheduleMutation = useScheduleShowing(id);
  const createTransactionMutation = useCreateTransaction();
  const router = useRouter();
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleType, setScheduleType] = useState<"PRIVATE" | "OPEN_HOUSE">("PRIVATE");
  const [scheduleNotes, setScheduleNotes] = useState("");

  useEffect(() => {
    if (error) toastError(error, "Failed to load listing");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    const isNotFound =
      error instanceof ApiException && error.status === 404;
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/listings" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Listings
          </Link>
        </Button>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!listing) {
    return null;
  }

  const canPublish =
    canUpdateListing(user.role) && listing.status === "DRAFT";
  const canUnpublish =
    canUpdateListing(user.role) && listing.status === "ACTIVE";
  const showMakeOffer =
    canMakeOffer(user.role) && listing.status === "ACTIVE" && listing.is_public;

  const handleMakeOffer = () => {
    createTransactionMutation.mutate(
      {
        organization_id: user.organization_id,
        initial_state: "LISTED",
        listing_id: id,
        initial_party_role: user.role,
      },
      {
        onSuccess: (txn) => {
          router.push(`/transactions/${txn.transaction_id}`);
        },
        onError: (err) => toastError(err, "Failed to start offer"),
      }
    );
  };

  const handlePublish = () => {
    updateMutation.mutate(
      { status: "ACTIVE", is_public: true },
      { onError: (err) => toastError(err, "Failed to publish listing") }
    );
  };

  const handleUnpublish = () => {
    updateMutation.mutate(
      { status: "DRAFT", is_public: false },
      { onError: (err) => toastError(err, "Failed to unpublish listing") }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/listings">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Listing Details</h1>
            <p className="text-muted-foreground">
              Listing {listing.listing_id.slice(0, 8)}…
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {listing.latitude != null && listing.longitude != null && (
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/listings?map=1&lat=${listing.latitude}&lng=${listing.longitude}&zoom=15&listing_id=${id}`}
              >
                <MapIcon className="mr-2 h-4 w-4" />
                Map
              </Link>
            </Button>
          )}
          {showMakeOffer && (
            <Button
              onClick={handleMakeOffer}
              disabled={createTransactionMutation.isPending}
            >
              {createTransactionMutation.isPending ? (
                <LoadingSpinner size="sm" className="mr-2" />
              ) : (
                <FileSignature className="mr-2 h-4 w-4" />
              )}
              Make offer
            </Button>
          )}
          {canUpdateListing(user.role) && (
            <Button variant="outline" asChild>
              <Link href={`/listings/${id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit listing
              </Link>
            </Button>
          )}
          {canSaveListing && (
            <Button
              variant={isSaved ? "secondary" : "outline"}
              onClick={() => {
                if (isSaved) unsaveMutation.mutate(id, { onError: (err) => toastError(err, "Failed to update saved listing") });
                else saveMutation.mutate(id, { onError: (err) => toastError(err, "Failed to save listing") });
              }}
              disabled={saveMutation.isPending || unsaveMutation.isPending}
            >
              {saveMutation.isPending || unsaveMutation.isPending ? (
                <LoadingSpinner size="sm" className="mr-2" />
              ) : isSaved ? (
                <BookmarkCheck className="mr-2 h-4 w-4 fill-current" />
              ) : (
                <Bookmark className="mr-2 h-4 w-4" />
              )}
              {isSaved ? "Saved" : "Save"}
            </Button>
          )}
          {canPublish && (
            <Button
              onClick={handlePublish}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Publishing…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Publish listing
                </>
              )}
            </Button>
          )}
          {canUnpublish && (
            <Button
              variant="outline"
              onClick={handleUnpublish}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Unpublishing…
                </>
              ) : (
                <>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Unpublish listing
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Overview
            </CardTitle>
            <CardDescription>Price, type, and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={listing.status === "ACTIVE" ? "success" : "secondary"}
              >
                {listing.status}
              </Badge>
              <Badge variant="outline">{listing.listing_type.replace(/_/g, " ")}</Badge>
              {listing.is_public && (
                <Badge variant="outline">
                  <Eye className="mr-1 h-3 w-3" />
                  Public
                </Badge>
              )}
            </div>
            {listing.next_open_house_at && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>Next open house: {formatDateTime(listing.next_open_house_at)}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-2xl font-bold text-primary">
              <DollarSign className="h-6 w-6" />
              {formatCurrency(listing.list_price)} {listing.price_currency}
            </div>
            {listing.days_on_market != null && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {listing.days_on_market} days on market
              </p>
            )}
            <div className="text-sm text-muted-foreground">
              <span>Listed </span>
              {formatDate(listing.created_at)}
              <span> · Updated </span>
              {formatDate(listing.updated_at)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Description
            </CardTitle>
            <CardDescription>Listing copy</CardDescription>
          </CardHeader>
          <CardContent>
            {listing.description ? (
              <p className="whitespace-pre-wrap text-sm">{listing.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Showings
          </CardTitle>
          <CardDescription>Schedule and manage showings; add feedback after each viewing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">Schedule a showing</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Start (date & time)</label>
                <input
                  type="datetime-local"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={scheduleStart}
                  onChange={(e) => setScheduleStart(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Type</label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as "PRIVATE" | "OPEN_HOUSE")}
                >
                  <option value="PRIVATE">{getShowingTypeLabel("PRIVATE")}</option>
                  <option value="OPEN_HOUSE">{getShowingTypeLabel("OPEN_HOUSE")}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notes (optional)</label>
                <input
                  className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Notes"
                  value={scheduleNotes}
                  onChange={(e) => setScheduleNotes(e.target.value)}
                />
              </div>
              <Button
                disabled={!scheduleStart || scheduleMutation.isPending}
                onClick={() => {
                  const start = new Date(scheduleStart);
                  const end = new Date(start.getTime() + 60 * 60 * 1000);
                  scheduleMutation.mutate(
                    {
                      scheduled_start_at: start.toISOString(),
                      scheduled_end_at: end.toISOString(),
                      showing_type: scheduleType,
                      notes: scheduleNotes.trim() || undefined,
                    },
                    {
                      onSuccess: () => {
                        setScheduleStart("");
                        setScheduleNotes("");
                      },
                      onError: (err) => toastError(err, "Failed to schedule showing"),
                    }
                  );
                }}
              >
                {scheduleMutation.isPending ? <LoadingSpinner size="sm" className="mr-2" /> : null}
                <Plus className="mr-2 h-4 w-4" />
                Schedule
              </Button>
            </div>
          </div>
          {showingsLoading ? (
            <LoadingSpinner size="sm" />
          ) : showings.length > 0 ? (
            <ul className="space-y-4">
              {showings.map((s) => (
                <li key={s.showing_id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{formatDateTime(s.scheduled_start_at)}</span>
                    <Badge variant="outline">{getShowingTypeLabel(s.showing_type)}</Badge>
                    <Badge variant="secondary">{s.status}</Badge>
                  </div>
                  {s.notes && <p className="mt-1 text-sm text-muted-foreground">{s.notes}</p>}
                  <ShowingFeedbackBlock showingId={s.showing_id} listingId={id} userRole={user.role} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No showings yet. Schedule one above.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Property ID: <code className="rounded bg-muted px-1.5 py-0.5">{listing.property_id}</code>
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href={`/properties/${listing.property_id}`}>
                View property
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
