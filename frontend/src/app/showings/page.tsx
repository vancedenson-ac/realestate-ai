"use client";

import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useListings } from "@/hooks/use-listings";
import { useListingShowings } from "@/hooks/use-showings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatDateTime, getShowingTypeLabel } from "@/lib/utils";
import { Calendar, Clock, User, ExternalLink } from "lucide-react";

function ListingShowingsCard({
  listingId,
  listPrice,
  priceCurrency,
}: {
  listingId: string;
  listPrice: number;
  priceCurrency: string;
}) {
  const { data: showings = [], isLoading } = useListingShowings(listingId);
  if (isLoading || showings.length === 0) return null;
  // Show only the most recent (last) showing per card so cards don't grow without limit
  const sorted = [...showings].sort(
    (a, b) => new Date(b.scheduled_start_at).getTime() - new Date(a.scheduled_start_at).getTime()
  );
  const lastShowing = sorted[0];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>Listing {listingId.slice(0, 8)}…</span>
          <span className="text-sm font-normal text-muted-foreground">
            {formatCurrency(listPrice)} {priceCurrency}
          </span>
        </CardTitle>
        <CardDescription>Showings for this listing</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-2">
          <li
            key={lastShowing.showing_id}
            className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
          >
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>{formatDateTime(lastShowing.scheduled_start_at)}</span>
            <Badge variant="outline">{getShowingTypeLabel(lastShowing.showing_type)}</Badge>
            <Badge variant="secondary">{lastShowing.status}</Badge>
          </li>
        </ul>
        <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
          <Link href={`/listings/${listingId}`}>
            <ExternalLink className="mr-2 h-4 w-4" />
            View listing & schedule / feedback
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ShowingsPage() {
  const { isHydrated } = useAuth();
  const { data: listingsResponse, isLoading: listingsLoading } = useListings({ limit: 20 });

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const listings = listingsResponse?.data ?? [];
  const listingsWithShowings = listings.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Showings</h1>
          <p className="text-muted-foreground">
            Schedule and manage property showings. Open house and private showings; add feedback after each viewing.
          </p>
        </div>
        <Button asChild>
          <Link href="/listings">
            <Calendar className="mr-2 h-4 w-4" />
            Browse Listings
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Listings</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{listings.length}</div>
            <p className="text-xs text-muted-foreground">visible to you</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Showings</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{listingsWithShowings.length}</div>
            <p className="text-xs text-muted-foreground">listings checked for showings</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Actions</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Schedule from a listing; add feedback after each showing.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Showings by listing</CardTitle>
          <CardDescription>
            Showings across your listings. Schedule a showing or add feedback from the listing page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listingsLoading ? (
            <LoadingSpinner size="sm" />
          ) : listingsWithShowings.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No listings"
              description="Create or view listings to schedule showings."
              action={(
                <Button variant="outline" asChild>
                  <Link href="/listings">
                    <Calendar className="mr-2 h-4 w-4" />
                    Browse Listings
                  </Link>
                </Button>
              )}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listingsWithShowings.map((listing) => (
                <ListingShowingsCard
                  key={listing.listing_id}
                  listingId={listing.listing_id}
                  listPrice={listing.list_price}
                  priceCurrency={listing.price_currency}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
