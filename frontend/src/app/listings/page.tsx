"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useDebounce } from "@/hooks/use-debounce";
import { useInfiniteListings, useMapListings } from "@/hooks/use-listings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingSpinner } from "@/components/loading-spinner";
import { EmptyState } from "@/components/empty-state";
import { ListingMapSidebar } from "@/components/listing-map-sidebar";
import { toastError } from "@/lib/toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Search,
  Plus,
  Calendar,
  Eye,
  Building2,
  MapPin,
  MapIcon,
  LayoutGrid,
  X,
} from "lucide-react";
import { canCreateListing, canSeeDraftListings } from "@/lib/permissions";
import type { MapBounds, MapSearchFilters, ListingOverview, MapListingFeature } from "@/types/api";

/** Build URL to open Listings page in map view zoomed to a location (and optionally select a listing). */
export function listingsMapFocusUrl(params: {
  lat: number;
  lng: number;
  zoom?: number;
  listing_id?: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("map", "1");
  sp.set("lat", String(params.lat));
  sp.set("lng", String(params.lng));
  if (params.zoom != null) sp.set("zoom", String(params.zoom));
  if (params.listing_id) sp.set("listing_id", params.listing_id);
  return `/listings?${sp.toString()}`;
}

// Initial map view (Maricopa County) — used so map-search runs on first paint before the map mounts
const INITIAL_MAP_BOUNDS: MapBounds = {
  sw_lat: 33.2,
  sw_lng: -112.5,
  ne_lat: 33.9,
  ne_lng: -111.6,
};
const INITIAL_MAP_ZOOM = 10;
const SEARCH_DEBOUNCE_MS = 300;

// Dynamically import the map component (requires browser APIs — no SSR)
const ListingMap = dynamic(
  () => import("@/components/listing-map").then((mod) => mod.ListingMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-muted/30 rounded-lg">
        <LoadingSpinner size="lg" />
      </div>
    ),
  },
);

/** Convert a GeoJSON Feature from the map response to a ListingOverview for the sidebar. */
function featureToListingOverview(f: MapListingFeature): ListingOverview {
  const p = f.properties;
  return {
    listing_id: p.listing_id ?? "",
    property_id: p.property_id ?? "",
    status: (p.status ?? "ACTIVE") as ListingOverview["status"],
    list_price: p.list_price ?? p.avg_price ?? 0,
    price_currency: "USD",
    listing_type: (p.listing_type ?? "FOR_SALE") as ListingOverview["listing_type"],
    days_on_market: p.days_on_market ?? null,
    description: p.description ?? null,
    is_public: true,
    created_at: "",
    updated_at: "",
    cover_image_url: null,
    address_line_1: p.address_line_1,
    city: p.city,
    state_province: p.state_province,
    postal_code: p.postal_code,
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
  };
}

export default function ListingsPage() {
  const { user, isHydrated } = useAuth();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<"map" | "grid">("map");
  const [bounds, setBounds] = useState<MapBounds | null>(INITIAL_MAP_BOUNDS);
  const [zoom, setZoom] = useState(INITIAL_MAP_ZOOM);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");

  // RLS: BUYER/BUYER_AGENT cannot see DRAFT; align UX by hiding DRAFT and resetting if selected
  useEffect(() => {
    if (!user) return;
    if (!canSeeDraftListings(user.role) && statusFilter === "DRAFT") {
      setStatusFilter("ACTIVE");
    }
  }, [user, statusFilter]);

  // When opening from property/listing detail "Map" link (?map=1&lat=&lng=&zoom=&listing_id=)
  useEffect(() => {
    if (!searchParams) return;
    const mapParam = searchParams.get("map");
    const latParam = searchParams.get("lat");
    const lngParam = searchParams.get("lng");
    const zoomParam = searchParams.get("zoom");
    const listingIdParam = searchParams.get("listing_id");
    const lat = latParam != null ? Number(latParam) : NaN;
    const lng = lngParam != null ? Number(lngParam) : NaN;
    if (mapParam === "1" && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      setViewMode("map");
      const z = zoomParam != null ? Number(zoomParam) : 15;
      const pad = 0.01;
      setBounds({
        sw_lat: lat - pad,
        sw_lng: lng - pad,
        ne_lat: lat + pad,
        ne_lng: lng + pad,
      });
      setZoom(z);
      if (listingIdParam) setSelectedListingId(listingIdParam);
    }
  }, [searchParams]);

  // Pass to map so it flies to this point on load (from URL)
  const flyTo = useMemo(() => {
    if (!searchParams) return null;
    const latParam = searchParams.get("lat");
    const lngParam = searchParams.get("lng");
    const zoomParam = searchParams.get("zoom");
    const lat = latParam != null ? Number(latParam) : NaN;
    const lng = lngParam != null ? Number(lngParam) : NaN;
    if (!Number.isNaN(lat) && !Number.isNaN(lng))
      return { lat, lng, zoom: zoomParam != null ? Number(zoomParam) : 15 };
    return null;
  }, [searchParams]);

  // Debounce timer for bounds changes
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map view data (search is server-side via filters; cached by query key)
  const mapFilters = useMemo<MapSearchFilters>(
    () => ({
      status_filter: statusFilter !== "all" ? statusFilter : undefined,
      search: debouncedSearch.trim() || undefined,
    }),
    [statusFilter, debouncedSearch],
  );
  const { data: mapData, isLoading: mapLoading, error: mapError } = useMapListings(
    viewMode === "map" ? bounds : null,
    zoom,
    mapFilters,
  );

  // Grid view data (search is server-side; cached by query key)
  const {
    data: infiniteData,
    isLoading: gridLoading,
    error: gridError,
    refetch: gridRefetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteListings(
    viewMode === "grid" ? (statusFilter !== "all" ? statusFilter : undefined) : undefined,
    debouncedSearch,
  );

  // Surface errors via toast
  useEffect(() => {
    if (mapError) toastError(mapError, "Failed to load map listings");
  }, [mapError]);
  useEffect(() => {
    if (gridError) toastError(gridError, "Failed to load listings");
  }, [gridError]);

  // Extract listing data from GeoJSON for sidebar (only features with listing_id;
  // at low zoom backend returns server clusters without listing_id, so we show no cards until zoomed in)
  const mapListings: ListingOverview[] = useMemo(() => {
    if (!mapData?.features) return [];
    return mapData.features
      .filter((f) => !f.properties?.cluster && f.properties?.listing_id)
      .map((f) => featureToListingOverview(f));
  }, [mapData]);

  // Map sidebar shows server-filtered results (no client-side filter)
  const filteredMapListings = mapListings;

  // Debounced bounds change handler (pan/zoom) so we don't fetch on every frame
  const handleBoundsChange = useCallback(
    (newBounds: MapBounds, newZoom: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        setBounds(newBounds);
        setZoom(newZoom);
      }, 300);
    },
    [],
  );

  // Handle sidebar card click → fly map to that listing
  const handleSidebarSelect = useCallback((listingId: string) => {
    setSelectedListingId(listingId);
  }, []);

  if (!isHydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Grid view data (server-filtered by search; no client-side filter)
  const gridListings = infiniteData?.pages.flatMap((p) => p.data) ?? [];
  const hasActiveSearch = debouncedSearch.trim().length > 0;

  return (
    <div className="flex h-full flex-col -m-4 sm:-m-6 overflow-hidden">
      {/* Header bar */}
      <div className="flex-shrink-0 space-y-3 px-4 pt-4 pb-3 lg:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Listings</h1>
            <p className="text-sm text-muted-foreground">
              Discover properties {viewMode === "map" ? "on the map" : "in the grid"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border bg-muted/50 p-0.5">
              <Button
                variant={viewMode === "map" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("map")}
                className="gap-1.5"
              >
                <MapIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Map</span>
              </Button>
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="gap-1.5"
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">Grid</span>
              </Button>
            </div>
            {canCreateListing(user.role) && (
              <Button asChild size="sm">
                <Link href="/listings/new">
                  <Plus className="mr-1 h-4 w-4" />
                  New
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden />
            <Input
              type="search"
              placeholder="Search by address, city, state, or ZIP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-10 pr-9 text-sm"
              aria-label="Search listings by address, city, state, or ZIP"
              autoComplete="off"
            />
            {searchQuery.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-full sm:w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {user && canSeeDraftListings(user.role) && (
                <SelectItem value="DRAFT">Draft</SelectItem>
              )}
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="SOLD">Sold</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
              <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content area */}
      {viewMode === "map" ? (
        /* ============= MAP VIEW ============= */
        <div className="flex flex-1 min-h-0">
          {/* Map pane (60%) */}
          <div className="hidden md:block md:flex-[3] min-h-0">
            <ListingMap
              geojson={mapData ?? null}
              isLoading={mapLoading}
              selectedListingId={selectedListingId}
              hoveredListingId={hoveredListingId}
              onBoundsChange={handleBoundsChange}
              onSelectListing={setSelectedListingId}
              flyTo={flyTo ?? undefined}
              className="h-full w-full"
            />
          </div>

          {/* Sidebar pane (40%) */}
          <div className="flex-1 md:flex-[2] min-h-0 border-l">
            {/* Mobile: show small map above sidebar */}
            <div className="block md:hidden h-[40vh] border-b">
              <ListingMap
                geojson={mapData ?? null}
                isLoading={mapLoading}
                selectedListingId={selectedListingId}
                hoveredListingId={hoveredListingId}
                onBoundsChange={handleBoundsChange}
                onSelectListing={setSelectedListingId}
                flyTo={flyTo ?? undefined}
                className="h-full w-full"
              />
            </div>

            <ListingMapSidebar
              listings={filteredMapListings}
              isLoading={mapLoading}
              selectedListingId={selectedListingId}
              onSelectListing={handleSidebarSelect}
              onHoverListing={setHoveredListingId}
              total={mapData?.meta?.total_in_bounds ?? 0}
              isClustered={mapData?.meta?.clustered === true}
              searchActive={hasActiveSearch}
            />
          </div>
        </div>
      ) : (
        /* ============= GRID VIEW ============= */
        <div className="flex-1 overflow-y-auto px-4 pb-6 lg:px-6">
          {gridLoading ? (
            <div className="flex h-64 items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          ) : gridError ? (
            <Button variant="outline" onClick={() => gridRefetch()}>
              Retry
            </Button>
          ) : gridListings.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <EmptyState
                  icon="search"
                  title={hasActiveSearch ? "No listings match your search" : "No listings found"}
                  description={
                    hasActiveSearch
                      ? "Try a different address, city, state, or ZIP."
                      : statusFilter !== "all"
                        ? "Try adjusting your filters."
                        : "No listings visible for your role."
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 pt-2">
                {gridListings.map((listing) => (
                  <Link
                    key={listing.listing_id}
                    href={`/listings/${listing.listing_id}`}
                    className="block"
                  >
                    <Card className="overflow-hidden transition-all hover:shadow-lg">
                      <div className="relative h-48 bg-gradient-to-br from-green-500/20 to-green-500/5">
                        {listing.cover_image_url ? (
                          <img
                            src={listing.cover_image_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Building2 className="h-16 w-16 text-green-500/30" />
                          </div>
                        )}
                        <Badge
                          className="absolute right-3 top-3"
                          variant={listing.status === "ACTIVE" ? "success" : "secondary"}
                        >
                          {listing.status}
                        </Badge>
                        {listing.is_public && (
                          <Badge className="absolute left-3 top-3" variant="outline">
                            <Eye className="mr-1 h-3 w-3" />
                            Public
                          </Badge>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold text-primary">
                            {formatCurrency(listing.list_price)}
                          </span>
                          <Badge variant="outline">{listing.listing_type}</Badge>
                        </div>
                        {(listing.address_line_1 || listing.city) && (
                          <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="line-clamp-1">
                              {[
                                listing.address_line_1,
                                listing.address_line_2,
                                listing.city,
                                listing.state_province,
                                listing.postal_code,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          </p>
                        )}
                        {listing.description && (
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                            {listing.description}
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(listing.created_at)}
                          </span>
                          {listing.days_on_market != null && (
                            <span>{listing.days_on_market} days on market</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
              {hasNextPage && (
                <div className="flex justify-center pt-6">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <span className="inline-flex items-center gap-2">
                        <LoadingSpinner size="sm" />
                        Loading…
                      </span>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
