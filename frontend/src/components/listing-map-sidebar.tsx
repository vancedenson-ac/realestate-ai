"use client";

import { useRef, useEffect, useCallback } from "react";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { ListingCardCompact } from "@/components/listing-card-compact";
import type { ListingOverview } from "@/types/api";

interface ListingMapSidebarProps {
  listings: ListingOverview[];
  isLoading: boolean;
  selectedListingId: string | null;
  onSelectListing: (listingId: string) => void;
  onHoverListing: (listingId: string | null) => void;
  total: number;
  /** True when backend returned server-side clusters (zoom < 12); list shows only when zoomed in. */
  isClustered?: boolean;
  /** True when user has an active search query (show search-specific empty state when no results). */
  searchActive?: boolean;
}

export function ListingMapSidebar({
  listings,
  isLoading,
  selectedListingId,
  onSelectListing,
  onHoverListing,
  total,
  isClustered = false,
  searchActive = false,
}: ListingMapSidebarProps) {
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to selected listing when it changes (e.g. marker click)
  useEffect(() => {
    if (!selectedListingId) return;
    const el = cardRefs.current.get(selectedListingId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedListingId]);

  const setCardRef = useCallback(
    (listingId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardRefs.current.set(listingId, el);
      } else {
        cardRefs.current.delete(listingId);
      }
    },
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-card px-4 py-3">
        <p className="text-sm font-medium">
          {isLoading ? (
            <span className="text-muted-foreground">Loading...</span>
          ) : (
            <>
              <span className="font-bold">{total}</span>{" "}
              <span className="text-muted-foreground">
                {total === 1 ? "listing" : "listings"} in this area
              </span>
            </>
          )}
        </p>
      </div>

      {/* Scrollable list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-2"
      >
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <LoadingSpinner size="md" />
          </div>
        ) : listings.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="search"
              title={
                searchActive
                  ? "No listings match your search"
                  : isClustered && total > 0
                    ? "Zoom in to see listings"
                    : "No listings in this area"
              }
              description={
                searchActive
                  ? "Try a different address, city, state, or ZIP."
                  : isClustered && total > 0
                    ? "The map is showing clusters. Zoom in to see individual listings in this list."
                    : "Try zooming out or adjusting your filters to see more results."
              }
            />
          </div>
        ) : (
          listings.map((listing) => (
            <ListingCardCompact
              key={listing.listing_id}
              ref={setCardRef(listing.listing_id)}
              listing={listing}
              isSelected={listing.listing_id === selectedListingId}
              onClick={() => onSelectListing(listing.listing_id)}
              onMouseEnter={() => onHoverListing(listing.listing_id)}
              onMouseLeave={() => onHoverListing(null)}
            />
          ))
        )}
      </div>

      {/* Footer: show count when we have listings or when clustered (0 of N) */}
      {!isLoading && total > 0 && (
        <div className="flex-shrink-0 border-t bg-card px-4 py-2">
          <p className="text-xs text-muted-foreground text-center">
            {listings.length > 0
              ? `Showing ${listings.length} of ${total} in view`
              : isClustered
                ? `Zoom in to list ${total} ${total === 1 ? "listing" : "listings"}`
                : `Showing 0 of ${total} in view`}
          </p>
        </div>
      )}
    </div>
  );
}
