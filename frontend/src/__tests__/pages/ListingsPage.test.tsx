import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// react-map-gl and mapbox-gl are mocked via jest moduleNameMapper → src/__mocks__/

// Mock next-themes before component import
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: jest.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock next/dynamic to render components synchronously (avoids React.lazy issues in tests)
jest.mock("next/dynamic", () => {
  return (_importFn: () => Promise<any>, _opts?: any) => {
    // Return a component that renders the ListingMap mock (from __mocks__/react-map-gl.js)
    return function DynamicMockComponent(props: any) {
      return React.createElement("div", { "data-testid": "dynamic-listing-map" });
    };
  };
});

// Mock auth context
const mockUser = {
  user_id: "b0000001-0000-0000-0000-000000000001",
  email: "alice@test.com",
  full_name: "Alice Agent",
  organization_id: "a0000001-0000-0000-0000-000000000001",
  organization_name: "Acme Realty",
  role: "SELLER_AGENT",
};

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser, setUser: jest.fn(), isHydrated: true }),
}));

// Mock permissions
jest.mock("@/lib/permissions", () => ({
  canCreateListing: () => true,
}));

// Mock toast
jest.mock("@/lib/toast", () => ({
  toastError: jest.fn(),
  toastSuccess: jest.fn(),
}));

// Mock the listings hooks
const mockMapData = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [-97.7431, 30.2672] as [number, number] },
      properties: {
        listing_id: "e0000001-0000-0000-0000-000000000001",
        property_id: "d0000001-0000-0000-0000-000000000001",
        list_price: 550000,
        price_short: "$550K",
        status: "ACTIVE",
        listing_type: "FOR_SALE",
        address_line_1: "123 Oak St",
        city: "Austin",
        state_province: "TX",
        postal_code: "78701",
        bedrooms: 4,
        bathrooms_full: 3,
        living_area_sqft: 2200,
        property_type: "SINGLE_FAMILY",
        days_on_market: 5,
      },
    },
    {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [-97.7403, 30.2711] as [number, number] },
      properties: {
        listing_id: "e0000001-0000-0000-0000-000000000002",
        property_id: "d0000001-0000-0000-0000-000000000002",
        list_price: 420000,
        price_short: "$420K",
        status: "ACTIVE",
        listing_type: "FOR_SALE",
        address_line_1: "456 Elm Ave",
        city: "Austin",
        state_province: "TX",
        postal_code: "78702",
        bedrooms: 3,
        bathrooms_full: 2,
        living_area_sqft: 1800,
        property_type: "TOWNHOUSE",
        days_on_market: 12,
      },
    },
  ],
  meta: { total_in_bounds: 2, clustered: false, zoom: 14 },
};

const mockInfiniteData = {
  pages: [
    {
      data: [
        {
          listing_id: "e0000001-0000-0000-0000-000000000001",
          property_id: "d0000001-0000-0000-0000-000000000001",
          status: "ACTIVE",
          list_price: 550000,
          price_currency: "USD",
          listing_type: "FOR_SALE",
          days_on_market: 5,
          description: "Spacious family home",
          is_public: true,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          cover_image_url: null,
          address_line_1: "123 Oak St",
          city: "Austin",
          state_province: "TX",
          postal_code: "78701",
          country: "US",
        },
      ],
      meta: { limit: 25, cursor: null },
    },
  ],
  pageParams: [undefined],
};

jest.mock("@/hooks/use-listings", () => ({
  useMapListings: () => ({
    data: mockMapData,
    isLoading: false,
    error: null,
  }),
  useInfiniteListings: () => ({
    data: mockInfiniteData,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  usePrefetchListing: () => jest.fn(),
}));

import ListingsPage from "@/app/listings/page";

describe("ListingsPage", () => {
  it("renders the Listings heading", () => {
    render(<ListingsPage />);
    expect(screen.getByRole("heading", { name: /listings/i })).toBeInTheDocument();
  });

  it("shows map and grid view toggle buttons", () => {
    render(<ListingsPage />);
    expect(screen.getByRole("button", { name: /map/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /grid/i })).toBeInTheDocument();
  });

  it("defaults to map view with sidebar listing count", () => {
    render(<ListingsPage />);
    // The sidebar should show the listing count from mock data
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/listings in this area/i)).toBeInTheDocument();
  });

  it("sidebar shows listing cards from GeoJSON data", () => {
    render(<ListingsPage />);
    expect(screen.getByText("$550,000")).toBeInTheDocument();
    expect(screen.getByText("$420,000")).toBeInTheDocument();
  });

  it("switches to grid view when Grid button is clicked", () => {
    render(<ListingsPage />);
    const gridButton = screen.getByRole("button", { name: /grid/i });
    fireEvent.click(gridButton);
    // In grid view, should show the listing card with full address
    expect(screen.getByText(/123 Oak St/)).toBeInTheDocument();
  });

  it("shows Create Listing button for SELLER_AGENT", () => {
    render(<ListingsPage />);
    expect(screen.getByRole("link", { name: /new/i })).toBeInTheDocument();
  });

  it("has a search input", () => {
    render(<ListingsPage />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("has a status filter dropdown", () => {
    render(<ListingsPage />);
    // The select trigger should show "ACTIVE" as default
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders the dynamically loaded map component container in map view", () => {
    render(<ListingsPage />);
    // The dynamic import mock renders a div with data-testid="dynamic-listing-map"
    const maps = screen.getAllByTestId("dynamic-listing-map");
    expect(maps.length).toBeGreaterThan(0);
  });

  it("grid view shows listing cards from infinite query", () => {
    render(<ListingsPage />);
    const gridButton = screen.getByRole("button", { name: /grid/i });
    fireEvent.click(gridButton);
    expect(screen.getByText("Spacious family home")).toBeInTheDocument();
  });
});
