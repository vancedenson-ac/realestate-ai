"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import { Building2, Bed, Bath, Ruler, MapPin, Clock } from "lucide-react";
import type { ListingOverview } from "@/types/api";

interface ListingCardCompactProps {
  listing: ListingOverview;
  isSelected?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const ListingCardCompact = forwardRef<HTMLDivElement, ListingCardCompactProps>(
  function ListingCardCompact(
    { listing, isSelected, onClick, onMouseEnter, onMouseLeave },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "group cursor-pointer rounded-lg border bg-card p-3 transition-all hover:shadow-md",
          isSelected
            ? "border-primary ring-2 ring-primary/20 shadow-md"
            : "border-border hover:border-primary/40",
        )}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="flex gap-3">
          {/* Thumbnail */}
          <div className="h-20 w-24 flex-shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-green-500/20 to-green-500/5">
            {listing.cover_image_url ? (
              <img
                src={listing.cover_image_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Building2 className="h-8 w-8 text-green-500/30" />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-1">
              <span className="text-base font-bold text-primary">
                {formatCurrency(listing.list_price)}
              </span>
            </div>

            {(listing.address_line_1 || listing.city) && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {[listing.address_line_1, listing.city, listing.state_province]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </p>
            )}

            <div className="mt-1.5 flex items-center gap-2.5 text-xs text-muted-foreground">
              {listing.description && (
                <span className="truncate max-w-[140px]">
                  {/* Extract bedrooms / baths from property if available */}
                </span>
              )}
              {listing.days_on_market != null && (
                <span className="flex items-center gap-0.5 whitespace-nowrap">
                  <Clock className="h-3 w-3" />
                  {listing.days_on_market}d
                </span>
              )}
            </div>
          </div>
        </div>

        {/* View link on hover */}
        <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Link
            href={`/listings/${listing.listing_id}`}
            className="text-xs font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            View details →
          </Link>
        </div>
      </div>
    );
  },
);
