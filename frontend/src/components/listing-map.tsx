"use client";

import { useCallback, useRef, useState } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  NavigationControl,
  GeolocateControl,
  type MapRef,
  type ViewStateChangeEvent,
  type MapMouseEvent,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { ListingMapPopup } from "@/components/listing-map-popup";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { MapBounds, MapSearchResponse, MapListingFeature } from "@/types/api";

// Default viewport: Maricopa County, AZ (where seed data lives)
const DEFAULT_CENTER = { latitude: 33.4484, longitude: -111.9260 };
const DEFAULT_ZOOM = 10;

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/** Optional: when set, the map will fly to this point on load (e.g. from property/listing detail "Map" link). */
export interface MapFlyTo {
  lat: number;
  lng: number;
  zoom: number;
}

interface ListingMapProps {
  geojson: MapSearchResponse | null;
  isLoading: boolean;
  selectedListingId: string | null;
  hoveredListingId: string | null;
  onBoundsChange: (bounds: MapBounds, zoom: number) => void;
  onSelectListing: (listingId: string | null) => void;
  /** When set, fly to this center/zoom once the map has loaded. */
  flyTo?: MapFlyTo | null;
  className?: string;
}

/** Mapbox style layer: cluster circles */
const clusterCircleLayer: mapboxgl.CircleLayerSpecification = {
  id: "clusters",
  type: "circle",
  source: "listings",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": "#2563eb",
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["get", "point_count"],
      2, 18,
      10, 24,
      50, 32,
      200, 44,
    ],
    "circle-opacity": 0.85,
    "circle-stroke-width": 2,
    "circle-stroke-color": "#ffffff",
  },
};

/** Mapbox style layer: cluster count text */
const clusterCountLayer: mapboxgl.SymbolLayerSpecification = {
  id: "cluster-count",
  type: "symbol",
  source: "listings",
  filter: ["has", "point_count"],
  layout: {
    "text-field": "{point_count_abbreviated}",
    "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
    "text-size": 13,
  },
  paint: {
    "text-color": "#ffffff",
  },
};

/** Mapbox style layer: individual listing markers (price pill text) */
const listingMarkerLayer: mapboxgl.SymbolLayerSpecification = {
  id: "listing-markers",
  type: "symbol",
  source: "listings",
  filter: ["!", ["has", "point_count"]],
  layout: {
    "text-field": ["get", "price_short"],
    "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
    "text-size": 12,
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-ignore-placement": false,
  },
  paint: {
    "text-color": [
      "case",
      ["==", ["get", "listing_id"], ""],
      "#ffffff",
      "#1e293b",
    ],
    "text-halo-color": [
      "case",
      ["==", ["get", "listing_id"], ""],
      "#2563eb",
      "#ffffff",
    ],
    "text-halo-width": 4,
    "text-halo-blur": 0,
  },
};

export function ListingMap({
  geojson,
  isLoading,
  selectedListingId,
  hoveredListingId,
  onBoundsChange,
  onSelectListing,
  flyTo,
  className,
}: ListingMapProps) {
  const mapRef = useRef<MapRef>(null);
  const { resolvedTheme } = useTheme();
  const [popupFeature, setPopupFeature] = useState<MapListingFeature | null>(null);

  const mapStyle =
    resolvedTheme === "dark"
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/light-v11";

  // Extract bounds from the map after move/zoom
  const handleMoveEnd = useCallback(
    (evt: ViewStateChangeEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const b = map.getBounds();
      if (!b) return;
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      onBoundsChange(
        {
          sw_lat: sw.lat,
          sw_lng: sw.lng,
          ne_lat: ne.lat,
          ne_lng: ne.lng,
        },
        Math.round(evt.viewState.zoom),
      );
    },
    [onBoundsChange],
  );

  // Click on a listing marker → show popup + select
  const handleClick = useCallback(
    (evt: MapMouseEvent) => {
      const feature = evt.features?.[0] as unknown as MapListingFeature | undefined;
      if (!feature) {
        // Clicked empty space
        setPopupFeature(null);
        onSelectListing(null);
        return;
      }

      // If it's a cluster, zoom in
      if (feature.properties?.point_count) {
        const map = mapRef.current?.getMap();
        if (map) {
          const coords = feature.geometry.coordinates;
          map.flyTo({
            center: [coords[0], coords[1]],
            zoom: Math.min((map.getZoom() || 12) + 2, 18),
            duration: 500,
          });
        }
        return;
      }

      // Individual marker → popup
      const listingId = feature.properties?.listing_id;
      if (listingId) {
        setPopupFeature(feature);
        onSelectListing(listingId);
      }
    },
    [onSelectListing],
  );

  // Cursor changes
  const handleMouseEnter = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "pointer";
  }, []);
  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "";
  }, []);

  // Build GeoJSON for the source. When backend returns server-side clusters (zoom < 12),
  // include all features and add point_count_abbreviated so cluster circles show counts.
  // When backend returns individual points (zoom >= 12), filter to non-cluster and let Mapbox cluster.
  const isServerClustered = geojson?.meta?.clustered === true;
  const sourceData: GeoJSON.FeatureCollection = geojson
    ? {
        type: "FeatureCollection",
        features: (isServerClustered ? geojson.features : geojson.features.filter((f) => !f.properties?.cluster))
          .map((f) => {
            const props = { ...f.properties };
            const count = props.point_count;
            if (count != null && count > 1) {
              props.point_count_abbreviated = count >= 1000 ? "999+" : String(count);
            } else if (count === 1 && isServerClustered) {
              // Single-point server feature: render as listing marker (price pill), not cluster circle
              delete props.point_count;
              delete props.point_count_abbreviated;
            }
            return {
              type: "Feature" as const,
              geometry: f.geometry,
              properties: props,
            };
          }),
      }
    : { type: "FeatureCollection", features: [] };

  // If no Mapbox token, show a fallback message
  if (!MAPBOX_TOKEN) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/50 rounded-lg border",
          className,
        )}
      >
        <div className="text-center p-8">
          <p className="text-sm font-medium text-muted-foreground">
            Map view requires a Mapbox token.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add <code className="rounded bg-muted px-1 py-0.5">NEXT_PUBLIC_MAPBOX_TOKEN</code> to{" "}
            <code className="rounded bg-muted px-1 py-0.5">.env.local</code>
          </p>
        </div>
      </div>
    );
  }

  // Update selected/hovered marker styling dynamically
  const activeId = selectedListingId || hoveredListingId || "";
  const dynamicMarkerPaint: mapboxgl.SymbolLayerSpecification["paint"] = {
    "text-color": [
      "case",
      ["==", ["get", "listing_id"], activeId],
      "#ffffff",
      "#1e293b",
    ],
    "text-halo-color": [
      "case",
      ["==", ["get", "listing_id"], activeId],
      "#2563eb",
      "#ffffff",
    ],
    "text-halo-width": 4,
    "text-halo-blur": 0,
  };

  return (
    <div className={cn("relative", className)}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={mapStyle}
        initialViewState={{
          ...DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
        }}
        onMoveEnd={handleMoveEnd}
        onLoad={(evt) => {
          const map = evt.target;
          if (flyTo) {
            map.flyTo({
              center: [flyTo.lng, flyTo.lat],
              zoom: flyTo.zoom,
              duration: 800,
            });
            const pad = 0.005;
            onBoundsChange(
              {
                sw_lat: flyTo.lat - pad,
                sw_lng: flyTo.lng - pad,
                ne_lat: flyTo.lat + pad,
                ne_lng: flyTo.lng + pad,
              },
              flyTo.zoom,
            );
          } else {
            const b = map.getBounds();
            if (b) {
              const sw = b.getSouthWest();
              const ne = b.getNorthEast();
              onBoundsChange(
                { sw_lat: sw.lat, sw_lng: sw.lng, ne_lat: ne.lat, ne_lng: ne.lng },
                Math.round(map.getZoom()),
              );
            }
          }
        }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        interactiveLayerIds={["clusters", "listing-markers"]}
        style={{ width: "100%", height: "100%" }}
        reuseMaps
      >
        <NavigationControl position="top-left" />
        <GeolocateControl position="top-left" />

        <Source
          id="listings"
          type="geojson"
          data={sourceData}
          cluster={!isServerClustered}
          clusterMaxZoom={14}
          clusterRadius={50}
        >
          <Layer {...clusterCircleLayer} />
          <Layer {...clusterCountLayer} />
          <Layer
            {...listingMarkerLayer}
            paint={dynamicMarkerPaint}
          />
        </Source>

        {/* Popup for selected marker */}
        {popupFeature && popupFeature.properties?.listing_id && (
          <Popup
            longitude={popupFeature.geometry.coordinates[0]}
            latitude={popupFeature.geometry.coordinates[1]}
            anchor="bottom"
            offset={12}
            closeOnClick={false}
            onClose={() => {
              setPopupFeature(null);
              onSelectListing(null);
            }}
            className="listing-map-popup"
          >
            <ListingMapPopup
              listingId={popupFeature.properties.listing_id}
              price={popupFeature.properties.list_price ?? 0}
              address={popupFeature.properties.address_line_1 ?? ""}
              city={popupFeature.properties.city}
              stateProvince={popupFeature.properties.state_province}
              postalCode={popupFeature.properties.postal_code}
              bedrooms={popupFeature.properties.bedrooms}
              bathroomsFull={popupFeature.properties.bathrooms_full}
              livingAreaSqft={popupFeature.properties.living_area_sqft}
              propertyType={popupFeature.properties.property_type}
              description={popupFeature.properties.description}
            />
          </Popup>
        )}
      </Map>

      {/* Loading indicator overlay */}
      {isLoading && (
        <div className="absolute top-3 right-3 rounded-full bg-background/80 p-2 shadow-md backdrop-blur-sm">
          <LoadingSpinner size="sm" />
        </div>
      )}
    </div>
  );
}

/**
 * Fly the map to a specific listing coordinate.
 * Used when a sidebar card is clicked.
 */
export function flyToListing(
  mapRef: React.RefObject<MapRef | null>,
  lng: number,
  lat: number,
  zoom: number = 15,
) {
  const map = mapRef.current?.getMap();
  if (map) {
    map.flyTo({
      center: [lng, lat],
      zoom,
      duration: 800,
    });
  }
}
