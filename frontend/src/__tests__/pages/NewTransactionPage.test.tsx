import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewTransactionPage from "@/app/transactions/new/page";
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

jest.mock("@/hooks/use-transactions", () => ({
  useCreateTransaction: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
  useTransactions: () => ({ data: { data: [] }, isLoading: false, error: null, refetch: jest.fn() }),
  filterTransactionsByRole: (data: unknown[]) => data,
}));

jest.mock("@/hooks/use-properties", () => ({
  useProperties: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/use-listings", () => ({
  useListings: () => ({ data: { data: [] }, isLoading: false }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("NewTransactionPage", () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it("renders page title and back link", () => {
    renderWithProviders(<NewTransactionPage />);
    expect(screen.getByRole("heading", { name: /new transaction/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to transactions/i })).toHaveAttribute(
      "href",
      "/transactions"
    );
  });

  it("renders form with initial state and party role selects", () => {
    renderWithProviders(<NewTransactionPage />);
    expect(screen.getByLabelText(/initial state/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your role/i)).toBeInTheDocument();
  });

  it("renders optional property and listing selects", () => {
    renderWithProviders(<NewTransactionPage />);
    expect(screen.getByLabelText(/property \(optional\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/listing \(optional\)/i)).toBeInTheDocument();
  });

  it("renders submit and cancel buttons", () => {
    renderWithProviders(<NewTransactionPage />);
    expect(screen.getByRole("button", { name: /create transaction/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute("href", "/transactions");
  });
});
