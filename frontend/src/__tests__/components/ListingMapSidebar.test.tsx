import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListingMapSidebar } from "@/components/listing-map-sidebar";
import type { ListingOverview } from "@/types/api";

const mockListings: ListingOverview[] = [
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
    latitude: 30.2672,
    longitude: -97.7431,
  },
  {
    listing_id: "e0000001-0000-0000-0000-000000000002",
    property_id: "d0000001-0000-0000-0000-000000000002",
    status: "ACTIVE",
    list_price: 420000,
    price_currency: "USD",
    listing_type: "FOR_SALE",
    days_on_market: 12,
    description: "Modern townhouse",
    is_public: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    cover_image_url: null,
    address_line_1: "456 Elm Ave",
    city: "Austin",
    state_province: "TX",
    postal_code: "78702",
    country: "US",
    latitude: 30.2711,
    longitude: -97.7403,
  },
];

describe("ListingMapSidebar", () => {
  it("renders listing count in header", () => {
    render(
      <ListingMapSidebar
        listings={mockListings}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={2}
      />
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/listings in this area/i)).toBeInTheDocument();
  });

  it("renders listing cards with prices", () => {
    render(
      <ListingMapSidebar
        listings={mockListings}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={2}
      />
    );
    expect(screen.getByText("$550,000")).toBeInTheDocument();
    expect(screen.getByText("$420,000")).toBeInTheDocument();
  });

  it("renders listing addresses", () => {
    render(
      <ListingMapSidebar
        listings={mockListings}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={2}
      />
    );
    expect(screen.getByText(/123 Oak St/)).toBeInTheDocument();
    expect(screen.getByText(/456 Elm Ave/)).toBeInTheDocument();
  });

  it("shows loading spinner when isLoading", () => {
    render(
      <ListingMapSidebar
        listings={[]}
        isLoading={true}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={0}
      />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows empty state when no listings", () => {
    render(
      <ListingMapSidebar
        listings={[]}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={0}
      />
    );
    expect(screen.getByText(/no listings in this area/i)).toBeInTheDocument();
  });

  it("calls onSelectListing when card is clicked", () => {
    const onSelect = jest.fn();
    render(
      <ListingMapSidebar
        listings={mockListings}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={onSelect}
        onHoverListing={jest.fn()}
        total={2}
      />
    );
    // Click the first listing card
    fireEvent.click(screen.getByText("$550,000"));
    expect(onSelect).toHaveBeenCalledWith("e0000001-0000-0000-0000-000000000001");
  });

  it("calls onHoverListing on mouse enter/leave", () => {
    const onHover = jest.fn();
    render(
      <ListingMapSidebar
        listings={mockListings}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={onHover}
        total={2}
      />
    );
    const firstCard = screen.getByText("$550,000").closest("[class*=cursor-pointer]");
    if (firstCard) {
      fireEvent.mouseEnter(firstCard);
      expect(onHover).toHaveBeenCalledWith("e0000001-0000-0000-0000-000000000001");
      fireEvent.mouseLeave(firstCard);
      expect(onHover).toHaveBeenCalledWith(null);
    }
  });

  it("shows footer with listing count", () => {
    render(
      <ListingMapSidebar
        listings={mockListings}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={2}
      />
    );
    expect(screen.getByText(/showing 2 of 2 in view/i)).toBeInTheDocument();
  });

  it("renders singular 'listing' when total is 1", () => {
    render(
      <ListingMapSidebar
        listings={[mockListings[0]]}
        isLoading={false}
        selectedListingId={null}
        onSelectListing={jest.fn()}
        onHoverListing={jest.fn()}
        total={1}
      />
    );
    expect(screen.getByText(/listing in this area/i)).toBeInTheDocument();
  });
});
