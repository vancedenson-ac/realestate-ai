import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EscrowPage from "@/app/escrow/page";

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
      user_id: "b0000001-0000-0000-0000-000000000004",
      email: "dave@escrow.com",
      full_name: "Dave Escrow",
      organization_id: "a0000001-0000-0000-0000-000000000002",
      organization_name: "First Escrow",
      role: "ESCROW_OFFICER",
    },
    isHydrated: true,
  }),
}));

describe("EscrowPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/transactions") && !url.includes("/escrow")) {
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
      return Promise.reject(new Error("Unexpected URL"));
    });
  });

  it("renders Escrow page title (h1)", () => {
    render(wrap(<EscrowPage />));
    const headings = screen.getAllByRole("heading", { name: /escrow/i });
    expect(headings.some((h) => h.tagName === "H1")).toBe(true);
  });

  it("renders Escrow Transactions section", async () => {
    render(wrap(<EscrowPage />));
    expect(await screen.findByText(/escrow transactions/i)).toBeInTheDocument();
  });

  it("shows empty state when no escrow transactions", async () => {
    render(wrap(<EscrowPage />));
    expect(await screen.findByText(/no escrow transactions/i)).toBeInTheDocument();
  });
});
