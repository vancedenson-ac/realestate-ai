# Feature Spec: Map View for Listings Page

**Status:** Draft
**Author:** AI Assistant
**Date:** 2025-02-10
**Priority:** High — Core UX feature for property discovery

---

## 1. Overview

Add a Zillow-style interactive map to the **Listings page** (`/listings`) as the primary interface. The page layout changes from a card grid to a **split-pane design**: an interactive Mapbox GL JS map occupying the left ~60% of the viewport, and a vertically scrolling sidebar of listing cards on the right ~40%. Property markers on the map display price pills; clicking a marker highlights the corresponding sidebar card and vice versa.

### 1.1 Goals

- Enable spatial property discovery — users see listings geographically, not just as a flat list
- Match industry-standard UX (Zillow, Redfin, Realtor.com) with price pill markers and cluster aggregation
- Leverage existing PostGIS infrastructure (GIST index, `location` geography column) for performant bounding-box queries
- Maintain full RLS compliance — map queries use `get_db_with_rls` like all other endpoints
- Support the existing light/dark theme (Mapbox has matching dark map styles)

### 1.2 Non-Goals (out of scope for v1)

- Draw-to-search polygon boundaries (future enhancement)
- Street View integration
- Heatmap layers (price density, crime, schools)
- Neighborhood/ZIP boundary overlays (requires Mapbox Boundaries dataset)
- Mobile-specific map UX (responsive collapse is in scope; dedicated mobile map is not)
- Server-side vector tile generation (MVT) — use GeoJSON for v1; add MVT if dataset exceeds ~50K listings

---

## 2. Architecture

### 2.1 System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                         │
│                                                                    │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Map (Mapbox  │    │  Sidebar (React  │    │  React Query     │  │
│  │  GL JS via    │◄──►│  listing cards)  │    │  cache layer     │  │
│  │  react-map-gl)│    │                  │    │                  │  │
│  └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘  │
│         │ bounds change        │ scroll/click          │            │
│         ▼                      ▼                       ▼            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   useMapListings() hook                      │   │
│  │  Debounced bounding-box query → POST /v1/listings/map-search │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │ HTTPS + RLS headers
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Backend (FastAPI)                              │
│                                                                    │
│  ┌────────────────────────────────┐                                │
│  │ POST /listings/map-search      │                                │
│  │ • Accepts bounds, zoom, filters│                                │
│  │ • Uses get_db_with_rls         │                                │
│  │ • Returns GeoJSON Feature-     │                                │
│  │   Collection                   │                                │
│  └──────────────┬─────────────────┘                                │
│                 │                                                   │
│                 ▼                                                   │
│  ┌────────────────────────────────┐                                │
│  │ PostgreSQL + PostGIS           │                                │
│  │ • ST_Intersects on GIST index  │                                │
│  │ • ST_SnapToGrid for clusters   │                                │
│  │ • v_listing_overviews_v1 (ext) │                                │
│  └────────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

1. **Map loads** → Initial viewport centered on user's listings or default (Austin, TX for seed data)
2. **Map moves/zooms** → Frontend debounces (300ms), sends bounding-box + zoom + filters to `POST /listings/map-search`
3. **Backend** → Queries `listings JOIN properties` with `ST_Intersects` on the `location` geography column using GIST index; applies RLS, status filter, price/bedroom filters; returns GeoJSON FeatureCollection
4. **Frontend** → Renders markers on map (price pills at high zoom, clusters at low zoom); populates sidebar with listing cards from the same response
5. **Interaction** → Clicking a marker scrolls sidebar to that card (highlighted); clicking a sidebar card flies the map to that marker and opens a popup

---

## 3. Backend Changes

### 3.1 Extend `v_listing_overviews_v1` View

The current view joins `listings` with `properties` for address fields but **does not include** `latitude`, `longitude`. Add them.

**File:** `backend/scripts/02-schema.sql`

Add to the `v_listing_overviews_v1` SELECT:

```sql
  p.latitude,
  p.longitude,
```

This is a backward-compatible addition. Existing queries that don't use these columns are unaffected.

### 3.2 New Endpoint: `POST /listings/map-search`

**File:** `backend/src/realtrust_api/api/v1/endpoints/listings.py`

#### Request Schema

```python
class MapBounds(BaseModel):
    """Southwest and northeast corners of the visible map viewport."""
    sw_lat: float = Field(..., ge=-90, le=90)
    sw_lng: float = Field(..., ge=-180, le=180)
    ne_lat: float = Field(..., ge=-90, le=90)
    ne_lng: float = Field(..., ge=-180, le=180)

class MapSearchFilters(BaseModel):
    """Optional filters applied alongside bounding box."""
    status_filter: str | None = None          # e.g. "ACTIVE"
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    bedrooms_min: int | None = None
    property_types: list[str] | None = None

class MapSearchRequest(BaseModel):
    bounds: MapBounds
    zoom: int = Field(12, ge=1, le=22)
    filters: MapSearchFilters | None = None
    limit: int = Field(500, ge=1, le=2000)
```

#### Response Schema

Return a GeoJSON FeatureCollection so the frontend can feed it directly to Mapbox as a data source. Each Feature contains the listing data as properties.

```python
class MapListingFeature(BaseModel):
    """GeoJSON Feature for a single listing."""
    type: str = "Feature"
    geometry: dict  # {"type": "Point", "coordinates": [lng, lat]}
    properties: dict  # listing_id, property_id, list_price, address, bedrooms, etc.

class MapListingCluster(BaseModel):
    """GeoJSON Feature for a server-side cluster."""
    type: str = "Feature"
    geometry: dict  # {"type": "Point", "coordinates": [centroid_lng, centroid_lat]}
    properties: dict  # cluster: true, point_count, avg_price, min_price, max_price

class MapSearchResponse(BaseModel):
    type: str = "FeatureCollection"
    features: list[dict]  # MapListingFeature | MapListingCluster
    meta: dict  # total_in_bounds, clustered, zoom
```

#### Query Logic

```python
@router.post("/map-search", response_model=MapSearchResponse)
async def map_search_listings(
    body: MapSearchRequest,
    db: AsyncSession = Depends(get_db_with_rls),
) -> MapSearchResponse:
    """
    Bounding-box search for map display.
    - zoom >= 12: return individual listings as GeoJSON Features
    - zoom < 12: return server-side clusters via ST_SnapToGrid
    """
    bounds = body.bounds
    filters = body.filters or MapSearchFilters()
    limit = min(body.limit, 2000)

    # Base query: listings + properties with location in bounds
    # Uses GIST index on properties.location
    bbox_filter = text("""
        ST_Intersects(
            p.location,
            ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326)::geography
        )
    """)

    if body.zoom >= 12:
        # Individual markers
        q = (
            select(Listing, Property)
            .join(Property, Listing.property_id == Property.property_id)
            .where(Listing.status == (filters.status_filter or "ACTIVE"))
            .where(Property.latitude.isnot(None))
            .where(bbox_filter)
            .limit(limit)
        )
        # Apply optional filters...
        # Build GeoJSON features from results
    else:
        # Server-side clustering via ST_SnapToGrid
        grid_size = _grid_size_for_zoom(body.zoom)  # e.g. zoom 5 → 2.0°, zoom 10 → 0.05°
        cluster_q = text("""
            SELECT
                ST_X(ST_Centroid(ST_Collect(p.location::geometry))) AS centroid_lng,
                ST_Y(ST_Centroid(ST_Collect(p.location::geometry))) AS centroid_lat,
                COUNT(*) AS point_count,
                AVG(l.list_price) AS avg_price,
                MIN(l.list_price) AS min_price,
                MAX(l.list_price) AS max_price
            FROM listings l
            JOIN properties p ON p.property_id = l.property_id
            WHERE l.status = :status
              AND p.latitude IS NOT NULL
              AND ST_Intersects(
                  p.location,
                  ST_MakeEnvelope(:sw_lng, :sw_lat, :ne_lng, :ne_lat, 4326)::geography
              )
            GROUP BY ST_SnapToGrid(p.location::geometry, :grid_size)
        """)
        # Build GeoJSON cluster features from results
```

#### Grid Size Lookup

```python
def _grid_size_for_zoom(zoom: int) -> float:
    """Map zoom level to ST_SnapToGrid cell size (degrees)."""
    grid_map = {
        1: 20.0, 2: 15.0, 3: 10.0, 4: 5.0, 5: 2.0,
        6: 1.0, 7: 0.5, 8: 0.2, 9: 0.1, 10: 0.05, 11: 0.02,
    }
    return grid_map.get(zoom, 0.01)
```

### 3.3 Update Pydantic Schemas

**File:** `backend/src/realtrust_api/domain/properties/schemas.py`

Add `latitude` and `longitude` to `ListingOverview`:

```python
class ListingOverview(BaseModel):
    # ... existing fields ...
    # Property geo (from view join)
    latitude: Decimal | None = None
    longitude: Decimal | None = None
```

This makes lat/lng available on the existing `/listings` endpoint too, which the sidebar uses.

### 3.4 RLS Compliance

The new endpoint MUST use `get_db_with_rls` for the database session. The underlying `listings` and `properties` tables already have RLS policies. The `v_listing_overviews_v1` view uses `security_invoker = true`, so session-level RLS context applies automatically.

### 3.5 Seed Data Enhancement

**File:** `backend/scripts/03-seed.sql`

Add more properties with diverse lat/lng across a metro area so the map has meaningful content at various zoom levels. Recommend adding 8-12 additional seed properties in Austin, TX:

```sql
-- Additional properties for map demo (diverse Austin, TX locations)
INSERT INTO properties (
    property_id, status, address_line_1, city, state_province, postal_code, country,
    property_type, year_built, living_area_sqft, bedrooms, bathrooms_full,
    latitude, longitude, data_source
) VALUES
    ('d0000001-0000-0000-0000-000000000003'::uuid, 'ACTIVE',
     '789 Congress Ave', 'Austin', 'TX', '78701', 'US',
     'CONDO', 2018, 1200, 2, 2, 30.2669, -97.7428, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000004'::uuid, 'ACTIVE',
     '1200 South Lamar Blvd', 'Austin', 'TX', '78704', 'US',
     'TOWNHOUSE', 2015, 1650, 3, 2, 30.2530, -97.7680, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000005'::uuid, 'ACTIVE',
     '3400 Red River St', 'Austin', 'TX', '78705', 'US',
     'SINGLE_FAMILY', 1960, 1800, 3, 2, 30.2950, -97.7275, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000006'::uuid, 'ACTIVE',
     '8500 Shoal Creek Blvd', 'Austin', 'TX', '78757', 'US',
     'SINGLE_FAMILY', 1985, 2800, 5, 3, 30.3580, -97.7410, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000007'::uuid, 'ACTIVE',
     '2100 E Riverside Dr', 'Austin', 'TX', '78741', 'US',
     'CONDO', 2020, 950, 1, 1, 30.2390, -97.7250, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000008'::uuid, 'ACTIVE',
     '11400 Domain Dr', 'Austin', 'TX', '78758', 'US',
     'CONDO', 2022, 1100, 2, 2, 30.4020, -97.7250, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000009'::uuid, 'ACTIVE',
     '4300 Bull Creek Rd', 'Austin', 'TX', '78731', 'US',
     'SINGLE_FAMILY', 1975, 3200, 4, 3, 30.3430, -97.7650, 'MANUAL'),
    ('d0000001-0000-0000-0000-000000000010'::uuid, 'ACTIVE',
     '600 W 28th St', 'Austin', 'TX', '78705', 'US',
     'MULTI_FAMILY', 2005, 4500, 6, 4, 30.2920, -97.7470, 'MANUAL')
ON CONFLICT (property_id) DO NOTHING;

-- Corresponding listings with varied prices
INSERT INTO listings (
    listing_id, property_id, status, list_price, listing_type, description,
    listing_agent_id, listing_broker_id, is_public
) VALUES
    ('e0000001-0000-0000-0000-000000000003'::uuid,
     'd0000001-0000-0000-0000-000000000003'::uuid,
     'ACTIVE', 425000.00, 'FOR_SALE', 'Modern downtown condo with city views.',
     'b0000001-0000-0000-0000-000000000001'::uuid,
     'a0000001-0000-0000-0000-000000000001'::uuid, true),
    -- ... (one listing per new property)
ON CONFLICT (listing_id) DO NOTHING;
```

This gives 10 total listings spread across Austin for a meaningful map demo.

---

## 4. Frontend Changes

### 4.1 New Dependencies

```bash
npm install react-map-gl mapbox-gl
npm install -D @types/mapbox-gl    # if needed (mapbox-gl ships types)
```

**Package versions (latest stable as of writing):**
- `react-map-gl` ^7.x (supports Mapbox GL JS v3)
- `mapbox-gl` ^3.x

### 4.2 Environment Variable

Add `NEXT_PUBLIC_MAPBOX_TOKEN` to `.env.local` (and document in Quickstart).

```env
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1Ijoi...your_token...
```

The Mapbox token is a **public** client token (pk.*). It is safe to expose in the browser and in git for development. Production deployments should use domain-restricted tokens via the Mapbox dashboard.

### 4.3 Next.js Config Update

**File:** `frontend/next.config.ts`

Add Mapbox CDN to the Content Security Policy (if CSP is set) and to `images.remotePatterns` if map tile thumbnails are used. Also add the Mapbox CSS import.

### 4.4 New Types

**File:** `frontend/src/types/api.ts`

```typescript
// ============================================================================
// Map types
// ============================================================================

export interface MapBounds {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
}

export interface MapSearchFilters {
  status_filter?: string;
  price_min?: number;
  price_max?: number;
  bedrooms_min?: number;
  property_types?: string[];
}

export interface MapSearchRequest {
  bounds: MapBounds;
  zoom: number;
  filters?: MapSearchFilters;
  limit?: number;
}

/** GeoJSON FeatureCollection from POST /listings/map-search */
export interface MapSearchResponse {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
  meta: {
    total_in_bounds: number;
    clustered: boolean;
    zoom: number;
  };
}
```

Update `ListingOverview` to include lat/lng:

```typescript
export interface ListingOverview {
  // ... existing fields ...
  /** Property latitude (from view join). */
  latitude?: number | null;
  /** Property longitude (from view join). */
  longitude?: number | null;
}
```

### 4.5 New API Client Methods

**File:** `frontend/src/lib/api.ts`

```typescript
export const listingsApi = {
  // ... existing methods ...

  /** Bounding-box search for map display. Returns GeoJSON FeatureCollection. */
  mapSearch: (user: SeedUser, data: MapSearchRequest) =>
    apiFetch<MapSearchResponse>("/listings/map-search", {
      user,
      method: "POST",
      body: data,
    }),
};
```

### 4.6 New Hook: `useMapListings`

**File:** `frontend/src/hooks/use-listings.ts`

```typescript
import { useQuery } from "@tanstack/react-query";

export function useMapListings(
  bounds: MapBounds | null,
  zoom: number,
  filters?: MapSearchFilters,
) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["listings", "map", user.user_id, user.organization_id, bounds, zoom, filters],
    queryFn: () =>
      listingsApi.mapSearch(user, {
        bounds: bounds!,
        zoom,
        filters,
      }),
    enabled: !!user && !!bounds,
    staleTime: STALE_TIME_LIST,
    // Keep previous data while new bounds load (prevents map flash)
    placeholderData: (prev) => prev,
  });
}
```

Key design decisions:
- **`placeholderData: (prev) => prev`**: Keeps the previous data visible while new data loads (no flash/blink when panning)
- **`enabled: !!bounds`**: Don't fire until the map reports its initial bounds
- **Query key includes bounds + zoom**: React Query deduplicates and caches per viewport
- **Debouncing**: Handled at the component level (300ms after map `onMoveEnd`), not in the hook

### 4.7 New Component: `ListingMap`

**File:** `frontend/src/components/listing-map.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│ ListingMap (wrapper)                                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ <Map> from react-map-gl                             │    │
│  │                                                     │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │    │
│  │  │ $550K    │  │ $425K    │  │ 5 listings│          │    │
│  │  │ (marker) │  │ (marker) │  │ (cluster) │          │    │
│  │  └──────────┘  └──────────┘  └──────────┘          │    │
│  │                                                     │    │
│  │  ┌────────────────────────┐                         │    │
│  │  │ Popup (on marker click)│                         │    │
│  │  │ • Image thumbnail      │                         │    │
│  │  │ • Price, beds, baths   │                         │    │
│  │  │ • Address              │                         │    │
│  │  │ • "View listing" link  │                         │    │
│  │  └────────────────────────┘                         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Controls: zoom +/-, geolocate, fullscreen, navigation     │
└─────────────────────────────────────────────────────────────┘
```

**Props:**

```typescript
interface ListingMapProps {
  geojson: GeoJSON.FeatureCollection | null;
  isLoading: boolean;
  selectedListingId: string | null;
  onBoundsChange: (bounds: MapBounds, zoom: number) => void;
  onSelectListing: (listingId: string | null) => void;
  className?: string;
}
```

**Implementation notes:**

- Use `react-map-gl` `<Map>` with `mapStyle` toggled by theme:
  - Light: `mapbox://styles/mapbox/light-v11`
  - Dark: `mapbox://styles/mapbox/dark-v11`
- GeoJSON source with Mapbox native clustering (for v1, client-side clustering is simpler; server-side clusters become relevant at >10K listings):
  ```jsx
  <Source
    id="listings"
    type="geojson"
    data={geojson}
    cluster={true}
    clusterMaxZoom={14}
    clusterRadius={50}
  >
    {/* Cluster circles */}
    <Layer id="clusters" type="circle" filter={["has", "point_count"]} paint={{...}} />
    {/* Cluster count labels */}
    <Layer id="cluster-count" type="symbol" filter={["has", "point_count"]} layout={{...}} />
    {/* Individual price pill markers */}
    <Layer id="listing-markers" type="symbol" filter={["!", ["has", "point_count"]]} layout={{...}} />
  </Source>
  ```
- For **price pill markers**: Use Mapbox `symbol` layer with `text-field: ["concat", "$", ["get", "price_short"]]` where `price_short` is pre-formatted (e.g. "550K", "1.2M") in the GeoJSON properties
- **Selected marker**: Different color/size via `["case", ["==", ["get", "listing_id"], selectedId], ...]` expression
- **Popup**: On click, show a small card with image, price, address, beds/baths, and a Link to `/listings/{id}`
- **onMoveEnd**: Debounced callback that extracts bounds from `map.getBounds()` and calls `onBoundsChange`

### 4.8 New Component: `ListingMapSidebar`

**File:** `frontend/src/components/listing-map-sidebar.tsx`

A scrollable sidebar showing listing cards that correspond to the markers currently visible on the map.

```
┌──────────────────────────────┐
│ 12 listings in this area     │  ← count header
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ [img] $550,000           │ │  ← listing card (compact)
│ │ 123 Oak St, Austin, TX   │ │
│ │ 4 bd · 3 ba · 2,200 sqft│ │
│ │ 5 days on market         │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ [img] $425,000           │ │  ← highlighted (map selected)
│ │ 789 Congress Ave, Austin │ │
│ │ 2 bd · 2 ba · 1,200 sqft│ │
│ └──────────────────────────┘ │
│ ...                          │  ← scrollable
├──────────────────────────────┤
│ Showing 12 of 12 in view    │  ← footer
└──────────────────────────────┘
```

**Props:**

```typescript
interface ListingMapSidebarProps {
  listings: ListingOverview[];
  isLoading: boolean;
  selectedListingId: string | null;
  onSelectListing: (listingId: string) => void;
  onHoverListing: (listingId: string | null) => void;
  total: number;
}
```

**Behavior:**
- Cards are compact (horizontal image + text, not the tall grid cards)
- When a map marker is clicked → sidebar scrolls to that card (via `scrollIntoView`)
- When a sidebar card is clicked → map flies to that marker, opens popup
- When a sidebar card is hovered → marker on map is highlighted (larger/colored)
- The list uses the `listings` array extracted from the GeoJSON response (or a parallel query)

### 4.9 Redesigned Listings Page

**File:** `frontend/src/app/listings/page.tsx`

The page layout changes to a full-height split pane:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Header bar: "Listings" title | filters (search, status, price) | + New   │
├─────────────────────────────────────────┬─────────────────────────────────┤
│                                         │                                 │
│                                         │  12 listings in this area       │
│                                         │  ┌───────────────────────────┐  │
│                                         │  │ $550,000                  │  │
│        Interactive Map                  │  │ 123 Oak St, Austin TX     │  │
│        (react-map-gl)                   │  │ 4 bd · 3 ba · 2,200 sqft │  │
│                                         │  └───────────────────────────┘  │
│     [$550K]   [$425K]                   │  ┌───────────────────────────┐  │
│                                         │  │ $425,000                  │  │
│            [$375K]   [$890K]            │  │ 789 Congress, Austin TX   │  │
│                                         │  │ 2 bd · 2 ba · 1,200 sqft │  │
│                                         │  └───────────────────────────┘  │
│        [$1.2M]                          │  ...                            │
│                                         │                                 │
│                                         │                                 │
├─────────────────────────────────────────┴─────────────────────────────────┤
│ (no page footer — full viewport height)                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key layout details:**

- The page takes **full available viewport height** (minus the app header/sidebar): `h-[calc(100vh-<header-height>)]`
- Map pane: `flex-[3]` (~60%)
- Sidebar pane: `flex-[2]` (~40%), with `overflow-y-auto` for scrolling
- Filter bar sits above the split pane (sticky)
- On screens < `md` breakpoint: stack vertically — map on top (50vh), sidebar below (scrollable)
- The existing grid layout is preserved as a toggle: users can switch between "Map view" and "Grid view" via a toggle button in the filter bar

**State management:**

```typescript
export default function ListingsPage() {
  const { user, isHydrated } = useAuth();
  const [viewMode, setViewMode] = useState<"map" | "grid">("map");
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [zoom, setZoom] = useState(12);
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [priceRange, setPriceRange] = useState<[number?, number?]>([]);
  const [bedroomsMin, setBedroomsMin] = useState<number | undefined>();

  // Map view data
  const { data: mapData, isLoading: mapLoading } = useMapListings(
    viewMode === "map" ? bounds : null,
    zoom,
    { status_filter: statusFilter, price_min: priceRange[0], price_max: priceRange[1], bedrooms_min: bedroomsMin }
  );

  // Grid view data (existing infinite list)
  const infinite = useInfiniteListings(
    viewMode === "grid" ? (statusFilter !== "all" ? statusFilter : undefined) : undefined
  );

  // Extract listing data from GeoJSON for sidebar
  const mapListings: ListingOverview[] = useMemo(() => {
    if (!mapData?.features) return [];
    return mapData.features
      .filter((f) => !f.properties?.cluster)
      .map((f) => featureToListingOverview(f));
  }, [mapData]);

  // Debounced bounds change handler
  const handleBoundsChange = useDebouncedCallback(
    (newBounds: MapBounds, newZoom: number) => {
      setBounds(newBounds);
      setZoom(newZoom);
    },
    300
  );

  // ...render
}
```

### 4.10 Price Formatting for Markers

Utility function for short price strings on map markers:

**File:** `frontend/src/lib/utils.ts`

```typescript
/** Format price for map marker pill: $550K, $1.2M, etc. */
export function formatPriceShort(price: number): string {
  if (price >= 1_000_000) {
    const m = price / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (price >= 1_000) {
    const k = price / 1_000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(0)}K`;
  }
  return `$${price}`;
}
```

### 4.11 Theme Integration

The map style must match the app's light/dark theme:

```typescript
import { useTheme } from "next-themes";

function ListingMap({ ... }: ListingMapProps) {
  const { resolvedTheme } = useTheme();
  const mapStyle = resolvedTheme === "dark"
    ? "mapbox://styles/mapbox/dark-v11"
    : "mapbox://styles/mapbox/light-v11";

  return (
    <Map mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN} mapStyle={mapStyle} ...>
      ...
    </Map>
  );
}
```

### 4.12 CSS / Mapbox GL CSS

Mapbox GL JS requires its CSS. Import in the map component or in `globals.css`:

```css
@import "mapbox-gl/dist/mapbox-gl.css";
```

Or dynamically in the component:

```typescript
import "mapbox-gl/dist/mapbox-gl.css";
```

Custom marker/popup styles should use Tailwind classes where possible, or scoped CSS for Mapbox-specific overrides (e.g. `.mapboxgl-popup-content`).

---

## 5. File Inventory

### 5.1 New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/listing-map.tsx` | Map component (react-map-gl wrapper) |
| `frontend/src/components/listing-map-sidebar.tsx` | Scrollable sidebar of listing cards |
| `frontend/src/components/listing-map-popup.tsx` | Marker popup card |
| `frontend/src/components/listing-card-compact.tsx` | Compact horizontal listing card (shared by sidebar) |

### 5.2 Modified Files

| File | Change |
|------|--------|
| `backend/scripts/02-schema.sql` | Add `p.latitude, p.longitude` to `v_listing_overviews_v1` |
| `backend/src/realtrust_api/domain/properties/schemas.py` | Add `latitude, longitude` to `ListingOverview`; add `MapBounds`, `MapSearchFilters`, `MapSearchRequest`, `MapSearchResponse` schemas |
| `backend/src/realtrust_api/api/v1/endpoints/listings.py` | Add `POST /map-search` endpoint |
| `backend/scripts/03-seed.sql` | Add 8 more properties + listings with diverse lat/lng |
| `frontend/package.json` | Add `react-map-gl`, `mapbox-gl` |
| `frontend/src/types/api.ts` | Add `MapBounds`, `MapSearchRequest`, `MapSearchResponse`; add `latitude/longitude` to `ListingOverview` |
| `frontend/src/lib/api.ts` | Add `listingsApi.mapSearch()` |
| `frontend/src/hooks/use-listings.ts` | Add `useMapListings()` hook |
| `frontend/src/app/listings/page.tsx` | Redesign to split-pane map + sidebar layout |
| `frontend/src/lib/utils.ts` | Add `formatPriceShort()` |
| `frontend/.env.local` | Add `NEXT_PUBLIC_MAPBOX_TOKEN` |
| `docker-compose.yml` | Pass `NEXT_PUBLIC_MAPBOX_TOKEN` to frontend service (optional) |
| `Quickstart.md` | Document Mapbox token setup |

### 5.3 New Test Files

| File | Purpose |
|------|---------|
| `backend/tests/test_map_search.py` | Test bounding-box search, clustering, filters, RLS |
| `frontend/src/__tests__/pages/ListingsPage.test.tsx` | Update existing or add map view tests |
| `frontend/src/__tests__/components/ListingMap.test.tsx` | Unit test for map component (mock mapbox-gl) |

---

## 6. Detailed Component Specifications

### 6.1 Price Pill Marker Design

```
┌─────────────────┐
│   $550K         │  ← White bg, dark text, rounded-full, shadow-md
│                 │    Hover: scale(1.1), shadow-lg
└─────────────────┘    Selected: primary color bg, white text

┌─────────────────┐
│  12 listings    │  ← Cluster: circle, primary color bg, white text
│                 │    Size scales with point_count
└─────────────────┘
```

Marker styling via Mapbox paint/layout expressions:

- **Individual marker text**: `["get", "price_short"]` — pre-formatted in GeoJSON properties
- **Background**: Use `icon-image` with a generated SDF icon or `text-halo` for the pill shape
- **Selected state**: `["case", ["==", ["get", "listing_id"], selectedId], "#2563eb", "#ffffff"]`
- **Cluster circle**: `circle-radius` interpolated by `point_count`: `["interpolate", ["linear"], ["get", "point_count"], 2, 20, 50, 40, 200, 60]`

### 6.2 Popup Design

When a marker is clicked, show a popup anchored to the marker:

```
┌──────────────────────────────────┐
│ ┌──────────┐                     │
│ │  [image]  │  $550,000          │
│ │           │  123 Oak St        │
│ │           │  Austin, TX 78701  │
│ └──────────┘  4 bd · 3 ba       │
│               2,200 sqft         │
│                                  │
│  [View Listing →]                │
└──────────────────────────────────┘
```

Implemented as a `react-map-gl` `<Popup>` with a React component inside (not raw HTML). Uses Tailwind classes. The "View Listing" link navigates to `/listings/{id}`.

### 6.3 Responsive Behavior

| Breakpoint | Layout |
|-----------|--------|
| `>= lg` (1024px) | Side-by-side: map 60% left, sidebar 40% right |
| `>= md` (768px) | Side-by-side: map 55% left, sidebar 45% right |
| `< md` (mobile) | Stacked: map 50vh top, sidebar scrollable below; or toggle (map/list) |

On mobile, consider a **toggle** between map and list rather than split:

```
[Map] [List]  ← tab toggle at top
```

### 6.4 Loading States

- **Initial load**: Map shows with default center (Austin, TX); sidebar shows skeleton cards
- **Panning/zooming**: Previous data stays visible (`placeholderData`); subtle loading indicator in corner
- **No results in bounds**: Sidebar shows "No listings in this area. Try zooming out or adjusting filters."
- **API error**: Toast via `toastError`; Retry button in sidebar

---

## 7. Performance Considerations

### 7.1 Backend

- **GIST index**: Already exists on `properties.location` — bounding-box queries are O(log n)
- **Limit**: Cap at 2000 features per response; at low zoom use server-side clustering
- **Response size**: A GeoJSON Feature with 15 properties is ~500 bytes; 500 features ≈ 250KB (acceptable)
- **Caching**: Consider adding `Cache-Control: max-age=30` for map responses (listings don't change every second)

### 7.2 Frontend

- **Debounce**: 300ms after `onMoveEnd` before firing API request (prevents request per frame during pan)
- **`placeholderData`**: Keeps previous data visible → no flash during transitions
- **Client-side clustering**: Mapbox GL JS native clustering handles up to ~50K points smoothly in WebGL
- **Marker rendering**: Use Mapbox `symbol` layers (GPU-rendered) not React `<Marker>` components (DOM-rendered) for >100 markers
- **Map instance**: Do NOT recreate the `<Map>` component on re-render; use `useMemo` or stable refs for the map state

### 7.3 Scaling Path

| Dataset size | Strategy |
|-------------|----------|
| < 5K listings | Client-side clustering (Mapbox GL native); GeoJSON response |
| 5K – 50K | Server-side clustering at low zoom; individual features at high zoom |
| 50K – 500K | Vector tiles (MVT) via PostGIS `ST_AsMVT` or pg_tileserv; deck.gl overlay |
| > 500K | Dedicated tile server (Martin, pg_tileserv); pre-generated PMTiles on S3 |

For v1 (seed data + early production), the GeoJSON approach with 500-feature cap is sufficient.

---

## 8. Testing Plan

### 8.1 Backend Tests

**File:** `backend/tests/test_map_search.py`

| Test | Assertion |
|------|-----------|
| `test_map_search_returns_geojson` | Response is valid FeatureCollection; features have geometry + properties |
| `test_map_search_bounds_filter` | Only properties within bounding box are returned |
| `test_map_search_out_of_bounds_empty` | Bounding box in ocean returns empty features list |
| `test_map_search_status_filter` | Only ACTIVE listings returned when filter set |
| `test_map_search_price_filter` | Price range filters work correctly |
| `test_map_search_rls_applied` | Different user/org sees different results (RLS) |
| `test_map_search_limit_respected` | Response contains at most `limit` features |
| `test_map_search_cluster_at_low_zoom` | zoom < 12 returns cluster features with `point_count` |
| `test_map_search_individual_at_high_zoom` | zoom >= 12 returns individual listing features |
| `test_listing_overview_includes_lat_lng` | Existing `/listings` endpoint now returns latitude/longitude |

### 8.2 Frontend Tests

**File:** `frontend/src/__tests__/pages/ListingsPage.test.tsx` (update)

| Test | Assertion |
|------|-----------|
| `test_renders_map_view_by_default` | Map container and sidebar are present |
| `test_view_toggle_switches_to_grid` | Clicking "Grid view" shows card grid |
| `test_sidebar_shows_listing_cards` | Sidebar renders listing cards from mock data |
| `test_filter_updates_query` | Changing status/price filter triggers new query |

**File:** `frontend/src/__tests__/components/ListingMap.test.tsx` (new)

| Test | Assertion |
|------|-----------|
| `test_renders_without_crash` | Component mounts with null geojson |
| `test_calls_onBoundsChange` | Moving map triggers callback |

Note: `mapbox-gl` must be mocked in Jest (it requires WebGL). Use `jest.mock("mapbox-gl")` or a lightweight stub.

### 8.3 Manual QA Checklist

- [ ] Map loads and shows markers for seed listings in Austin, TX
- [ ] Price pills display correctly formatted prices ($550K, $1.2M)
- [ ] Clicking a marker opens a popup with listing details
- [ ] Clicking "View Listing" in popup navigates to listing detail page
- [ ] Sidebar scrolls to the selected listing card when a marker is clicked
- [ ] Clicking a sidebar card flies the map to that marker
- [ ] Hovering a sidebar card highlights the marker on the map
- [ ] Panning/zooming the map updates sidebar listing count
- [ ] Status filter (ACTIVE/DRAFT/etc.) works for both map and sidebar
- [ ] Search box filters sidebar results
- [ ] Dark mode: map switches to dark style; markers and popup are readable
- [ ] Responsive: below md breakpoint, layout stacks or toggles
- [ ] "Grid view" toggle shows the original card grid layout
- [ ] Empty area (zoom to middle of ocean): sidebar shows "No listings" empty state
- [ ] RLS: switching user in header shows different listings on map
- [ ] Performance: no visible lag with 10 markers during pan/zoom
- [ ] Mapbox token missing: graceful error message (not crash)

---

## 9. Migration / Rollout

### 9.1 Database Migration

The only schema change is adding `p.latitude, p.longitude` to the `v_listing_overviews_v1` view. This is done by `DROP VIEW IF EXISTS` + `CREATE VIEW` (already the pattern in `02-schema.sql`). No data migration needed.

### 9.2 Backward Compatibility

- The existing `/listings` endpoint gains two new optional fields (`latitude`, `longitude`) — fully backward compatible
- The new `/listings/map-search` endpoint is additive
- The frontend defaults to map view but provides a grid toggle — no existing workflow is removed
- If `NEXT_PUBLIC_MAPBOX_TOKEN` is not set, the page should fall back to grid view with a console warning

### 9.3 Deployment Order

1. **Backend first**: Deploy schema change + new endpoint (no frontend impact)
2. **Frontend second**: Deploy new UI with map (requires Mapbox token in environment)
3. **Seed data**: Re-run seed script for new properties (dev/staging only)

---

## 10. Open Questions / Future Enhancements

| # | Question / Enhancement | Notes |
|---|------------------------|-------|
| 1 | **Mapbox token management**: Should we use a domain-restricted token for production? | Yes. Create separate dev (unrestricted) and prod (restricted to app domain) tokens in Mapbox dashboard. |
| 2 | **Geocoding / address search**: Should the search bar geocode to map coordinates? | Future: Mapbox Geocoding API to center map on a searched city/address. |
| 3 | **Draw-to-search**: Allow users to draw a polygon and search within it? | Future: Use `@mapbox/mapbox-gl-draw` for freehand/polygon search. |
| 4 | **Saved map position**: Remember user's last map viewport (center, zoom) in localStorage? | Nice UX; implement in v1 if time permits. |
| 5 | **URL sync**: Reflect map bounds/zoom in URL params for shareable links? | Future: `?lat=30.27&lng=-97.74&z=12`. |
| 6 | **Neighborhood overlays**: Show ZIP code, school district, flood zone boundaries? | Requires Mapbox Boundaries or custom GeoJSON datasets. |
| 7 | **Heatmap layer**: Price density or demand heatmap? | Future: deck.gl HeatmapLayer on top of the base map. |
| 8 | **Map on property detail page**: Small map showing property location? | Low effort; reuse `ListingMap` component with single marker. |
| 9 | **Cluster click behavior**: Click cluster → zoom to expand, or show list popup? | v1: zoom to expand (Mapbox default). Future: list popup option. |
| 10 | **SSR considerations**: `react-map-gl` requires browser APIs; ensure `"use client"` and dynamic import if needed. | Standard Next.js pattern; map component is client-only. |

---

## 11. Implementation Order

Recommended step-by-step implementation sequence:

1. **Backend: Extend view + schemas** — Add lat/lng to `v_listing_overviews_v1` and `ListingOverview` Pydantic schema
2. **Backend: New endpoint** — Implement `POST /listings/map-search` with bounding-box query
3. **Backend: Seed data** — Add 8 more properties/listings in Austin
4. **Backend: Tests** — Write `test_map_search.py`
5. **Frontend: Dependencies** — Install `react-map-gl` + `mapbox-gl`; add env var
6. **Frontend: Types + API** — Add map types, `listingsApi.mapSearch`, `useMapListings` hook
7. **Frontend: Map component** — Build `ListingMap` with markers, clusters, popups, theme
8. **Frontend: Sidebar** — Build `ListingMapSidebar` with compact cards, scroll sync
9. **Frontend: Page redesign** — Rewrite listings page with split-pane layout + view toggle
10. **Frontend: Tests** — Update page tests; add map component tests
11. **Polish** — Responsive, loading states, error handling, accessibility
12. **Documentation** — Update Quickstart.md with Mapbox token setup

---

*End of specification.*
