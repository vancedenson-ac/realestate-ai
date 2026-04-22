import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardPage from "@/app/page";

const mockTxResponse = {
  data: [
    {
      transaction_id: "c0000001-0000-0000-0000-000000000001",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      current_state: "DUE_DILIGENCE",
      state_entered_at: "2025-01-15T00:00:00Z",
      jurisdiction: null,
      offer_price: 500000,
      property_id: "d0000001-0000-0000-0000-000000000001",
      listing_id: "e0000001-0000-0000-0000-000000000001",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-15T00:00:00Z",
    },
  ],
  meta: { limit: 100, cursor: null },
};

let mockAuthUser: {
  user_id: string;
  email: string;
  full_name: string;
  organization_id: string;
  organization_name: string;
  role: string;
} = {
  user_id: "b0000001-0000-0000-0000-000000000001",
  email: "alice@acme.com",
  full_name: "Alice Agent",
  organization_id: "a0000001-0000-0000-0000-000000000001",
  organization_name: "Acme",
  role: "SELLER_AGENT",
};

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: mockAuthUser,
    isHydrated: true,
  }),
}));

jest.mock("@/lib/toast", () => ({
  toastError: jest.fn(),
}));

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe("DashboardPage (Phase B.1 B.2)", () => {
  beforeEach(() => {
    mockAuthUser = {
      user_id: "b0000001-0000-0000-0000-000000000001",
      email: "alice@acme.com",
      full_name: "Alice Agent",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      organization_name: "Acme",
      role: "SELLER_AGENT",
    };
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (typeof url !== "string") return Promise.reject(new Error("Unexpected"));
      if (url.includes("/transactions") && !url.includes("/offers")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve(mockTxResponse),
        });
      }
      if (url.includes("/listings")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () =>
            Promise.resolve({
              data: [],
              meta: { limit: 10, cursor: null },
            }),
        });
      }
      return Promise.reject(new Error("Unexpected URL: " + url));
    });
  });

  it("renders welcome and Quick Actions card", async () => {
    render(wrap(<DashboardPage />));
    await waitFor(() => {
      expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /quick actions/i })).toBeInTheDocument();
  });

  it("shows Create property and Create listing for SELLER_AGENT", async () => {
    render(wrap(<DashboardPage />));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /create property/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /create listing/i })).toHaveAttribute("href", "/listings/new");
    expect(screen.getByRole("link", { name: /create property/i })).toHaveAttribute("href", "/properties/new");
  });

  it("shows Make offer for BUYER", async () => {
    mockAuthUser = {
      user_id: "b0000001-0000-0000-0000-000000000002",
      email: "bob@example.com",
      full_name: "Bob",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      organization_name: "Acme",
      role: "BUYER",
    };
    render(wrap(<DashboardPage />));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /make offer/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /make offer/i })).toHaveAttribute("href", "/listings");
    expect(screen.queryByRole("link", { name: /create property/i })).not.toBeInTheDocument();
  });

  it("renders Transaction Pipeline and Recent Transactions", async () => {
    render(wrap(<DashboardPage />));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /transaction pipeline/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /recent transactions/i })).toBeInTheDocument();
  });

  it("View All link includes state param when pipeline state is selected", async () => {
    render(wrap(<DashboardPage />));
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /^view all$/i }).getAttribute("href")).toBe("/transactions");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /due diligence/i })).toBeInTheDocument();
    });
    const dueDiligenceBtn = screen.getByRole("button", { name: /due diligence/i });
    await userEvent.click(dueDiligenceBtn);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /clear filter/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /^view all$/i }).getAttribute("href")).toContain("state=DUE_DILIGENCE");
  });
});
