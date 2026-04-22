"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useProperties, usePrefetchProperty } from "@/hooks/use-properties";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { toastError } from "@/lib/toast";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { Search, Plus, MapPin, Bed, Bath, Square, Building2 } from "lucide-react";
import { canCreateProperty } from "@/lib/permissions";

export default function PropertiesPage() {
  const { user, isHydrated } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: properties, isLoading, error, refetch } = useProperties({ limit: 50 });
  const prefetchProperty = usePrefetchProperty();

  useEffect(() => {
    if (error) toastError(error, "Failed to load properties");
  }, [error]);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Backend returns array; ensure we always have an array (RLS may return [] if no access)
  const list = Array.isArray(properties) ? properties : [];
  let filteredProperties = list;

  // Apply search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredProperties = filteredProperties.filter(
      (p) =>
        (p.address_line_1 ?? "").toLowerCase().includes(q) ||
        (p.city ?? "").toLowerCase().includes(q) ||
        (p.state_province ?? "").toLowerCase().includes(q)
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
          <p className="text-muted-foreground">
            Browse and manage properties
          </p>
        </div>
        {canCreateProperty(user.role) && (
          <Button asChild>
            <Link href="/properties/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Property
            </Link>
          </Button>
        )}
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by address, city, or state..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Properties Grid */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      ) : error ? (
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : filteredProperties.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon="search"
              title="No properties found"
              description={
                searchQuery
                  ? "Try adjusting your search."
                  : "No properties visible. Access is filtered by RLS; switch user in the header if you expect to see data."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredProperties.map((property) => (
            <Link
              key={property.property_id}
              href={`/properties/${property.property_id}`}
              className="block"
              onMouseEnter={() => prefetchProperty(property.property_id)}
            >
              <Card className="overflow-hidden transition-all hover:shadow-lg">
                <div className="relative h-48 bg-gradient-to-br from-primary/20 to-primary/5">
                  {property.cover_image_url ? (
                    <img
                      src={property.cover_image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Building2 className="h-16 w-16 text-primary/30" />
                    </div>
                  )}
                  <Badge
                    className="absolute right-3 top-3"
                    variant={property.status === "ACTIVE" ? "success" : "secondary"}
                  >
                    {property.status}
                  </Badge>
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold line-clamp-1">{property.address_line_1}</h3>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {property.city}, {property.state_province} {property.postal_code}
                  </p>
                  <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                    {property.bedrooms && (
                      <span className="flex items-center gap-1">
                        <Bed className="h-4 w-4" />
                        {property.bedrooms} bed
                      </span>
                    )}
                    {property.bathrooms_full && (
                      <span className="flex items-center gap-1">
                        <Bath className="h-4 w-4" />
                        {property.bathrooms_full} bath
                      </span>
                    )}
                    {property.living_area_sqft && (
                      <span className="flex items-center gap-1">
                        <Square className="h-4 w-4" />
                        {property.living_area_sqft.toLocaleString()} sqft
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge variant="outline">
                      {property.property_type.replace(/_/g, " ")}
                    </Badge>
                    {property.year_built && (
                      <span className="text-xs text-muted-foreground">
                        Built {property.year_built}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
