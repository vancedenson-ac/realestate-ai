import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OffersPage from "@/app/offers/page";

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

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: {
      user_id: "b0000001-0000-0000-0000-000000000002",
      email: "bob@example.com",
      full_name: "Bob",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      organization_name: "Acme",
      role: "BUYER",
    },
    isHydrated: true,
  }),
}));

describe("OffersPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/transactions") && !url.includes("/offers")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () =>
            Promise.resolve({
              data: [],
              meta: { limit: 20, cursor: null },
            }),
        });
      }
      if (url.includes("/offers")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve([]),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });
  });

  it("renders Offers page title (h1)", () => {
    render(wrap(<OffersPage />));
    const headings = screen.getAllByRole("heading", { name: /offers/i });
    expect(headings.some((h) => h.tagName === "H1")).toBe(true);
  });

  it("renders stats cards", async () => {
    render(wrap(<OffersPage />));
    await screen.findByRole("heading", { name: /pending/i });
    expect(screen.getByRole("heading", { name: /accepted/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /countered/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rejected/i })).toBeInTheDocument();
  });

  it("renders All Offers section", async () => {
    render(wrap(<OffersPage />));
    expect(await screen.findByText(/all offers/i)).toBeInTheDocument();
  });

  it("shows empty state when no offers", async () => {
    render(wrap(<OffersPage />));
    expect(await screen.findByText(/no offers yet/i)).toBeInTheDocument();
  });
});
