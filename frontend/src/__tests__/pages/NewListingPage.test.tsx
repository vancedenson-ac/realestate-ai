import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewListingPage from "@/app/listings/new/page";
import type { SeedUser } from "@/types/api";

const mockUser: SeedUser = {
  user_id: "b0000001-0000-0000-0000-000000000001",
  email: "alice@acme.com",
  full_name: "Alice Agent",
  organization_id: "a0000001-0000-0000-0000-000000000001",
  organization_name: "Acme Realty",
  role: "SELLER_AGENT",
};

const mockMutate = jest.fn();

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: mockUser,
    isHydrated: true,
    setUser: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-listings", () => ({
  useCreateListing: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

jest.mock("@/hooks/use-properties", () => ({
  useProperties: () => ({ data: [], isLoading: false }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("NewListingPage", () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it("renders page title and back link", () => {
    renderWithProviders(<NewListingPage />);
    expect(screen.getByRole("heading", { name: /create listing/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to listings/i })).toHaveAttribute(
      "href",
      "/listings"
    );
  });

  it("renders form with property select and list price", () => {
    renderWithProviders(<NewListingPage />);
    expect(screen.getByLabelText(/property \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/list price \*/i)).toBeInTheDocument();
  });

  it("renders listing type select and public checkbox", () => {
    renderWithProviders(<NewListingPage />);
    expect(screen.getByLabelText(/listing type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/public/i)).toBeInTheDocument();
  });

  it("renders submit and cancel buttons", () => {
    renderWithProviders(<NewListingPage />);
    expect(screen.getByRole("button", { name: /create listing/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute("href", "/listings");
  });

  it("list price input accepts typical values (step=1, placeholder for e.g. 200000)", () => {
    renderWithProviders(<NewListingPage />);
    const listPriceInput = screen.getByLabelText(/list price \*/i);
    expect(listPriceInput).toBeInTheDocument();
    expect(listPriceInput).toHaveAttribute("type", "number");
    expect(listPriceInput).toHaveAttribute("step", "1");
    expect(listPriceInput).toHaveAttribute("min", "1");
    expect(listPriceInput.getAttribute("placeholder")?.toLowerCase()).toMatch(/200000|500000/);
  });
});
