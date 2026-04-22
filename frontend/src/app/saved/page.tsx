"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { useSavedListings, useUnsaveListing } from "@/hooks/use-recommendations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { Building2, MapPin, BookmarkCheck } from "lucide-react";

export default function SavedPropertiesPage() {
  const { user, isHydrated } = useAuth();
  const { data: saved, isLoading, error, refetch } = useSavedListings();
  const unsaveMutation = useUnsaveListing();

  useEffect(() => {
    if (error) toastError(error, "Failed to load saved listings");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const canSave = user.role === "BUYER" || user.role === "BUYER_AGENT";
  const savedIds = new Set((saved ?? []).map((s) => s.listing_id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Saved Properties</h1>
        <p className="text-muted-foreground">
          Listings you’ve saved for later
        </p>
      </div>

      {!canSave && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Saving listings is available when signed in as a buyer or buyer’s agent. Switch user in the header to see saved properties.
            </p>
          </CardContent>
        </Card>
      )}

      {canSave && (
        <>
          {isLoading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          )}

          {error && (
            <div className="flex justify-center py-4">
              <Button variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && saved && saved.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>No saved listings</CardTitle>
                <CardDescription>
                  Save listings from the Listings or Property pages to see them here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon="file"
                  title="Nothing saved yet"
                  description="Browse listings and click Save to add them here."
                />
              </CardContent>
            </Card>
          )}

          {!isLoading && !error && saved && saved.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {saved.map((item) => (
                <Card key={item.listing_id} className="flex flex-col">
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <CardTitle className="text-base font-medium leading-tight">
                      {item.address_line_1}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      disabled={unsaveMutation.isPending}
                      onClick={() =>
                        unsaveMutation.mutate(item.listing_id, {
                          onError: (err) => toastError(err, "Failed to remove from saved"),
                        })
                      }
                      title="Remove from saved"
                    >
                      <BookmarkCheck className="h-4 w-4 fill-primary text-primary" />
                    </Button>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2">
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {item.city}, {item.state_province} {item.postal_code}
                    </p>
                    <p className="text-lg font-semibold text-primary">
                      {formatCurrency(item.list_price)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Saved {formatDate(item.saved_at)}
                    </p>
                    <div className="flex gap-2 pt-2">
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link href={`/listings/${item.listing_id}`}>
                          View listing
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link href={`/properties/${item.property_id}`}>
                          <Building2 className="mr-1 h-3.5 w-3.5" />
                          Property
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
