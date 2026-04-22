"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { Building2, Bed, Bath, Ruler, ArrowRight } from "lucide-react";

interface ListingMapPopupProps {
  listingId: string;
  price: number;
  address: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  bedrooms?: number | null;
  bathroomsFull?: number | null;
  livingAreaSqft?: number | null;
  propertyType?: string;
  description?: string | null;
}

export function ListingMapPopup({
  listingId,
  price,
  address,
  city,
  stateProvince,
  postalCode,
  bedrooms,
  bathroomsFull,
  livingAreaSqft,
  propertyType,
  description,
}: ListingMapPopupProps) {
  return (
    <div className="min-w-[260px] max-w-[320px]">
      {/* Price + type */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-primary">
          {formatCurrency(price)}
        </span>
        {propertyType && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {propertyType.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Address */}
      <p className="mt-1 text-sm font-medium">
        {address}
      </p>
      {(city || stateProvince) && (
        <p className="text-xs text-muted-foreground">
          {[city, stateProvince, postalCode].filter(Boolean).join(", ")}
        </p>
      )}

      {/* Details row */}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        {bedrooms != null && (
          <span className="flex items-center gap-1">
            <Bed className="h-3.5 w-3.5" />
            {bedrooms} bd
          </span>
        )}
        {bathroomsFull != null && (
          <span className="flex items-center gap-1">
            <Bath className="h-3.5 w-3.5" />
            {bathroomsFull} ba
          </span>
        )}
        {livingAreaSqft != null && (
          <span className="flex items-center gap-1">
            <Ruler className="h-3.5 w-3.5" />
            {livingAreaSqft.toLocaleString()} sqft
          </span>
        )}
      </div>

      {/* Description preview */}
      {description && (
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
          {description}
        </p>
      )}

      {/* View listing link */}
      <Link
        href={`/listings/${listingId}`}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        View listing
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
