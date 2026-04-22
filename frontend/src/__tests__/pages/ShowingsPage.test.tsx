import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ShowingsPage from "@/app/showings/page";

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
      user_id: "b0000001-0000-0000-0000-000000000001",
      email: "alice@example.com",
      full_name: "Alice",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      organization_name: "Acme",
      role: "SELLER_AGENT",
    },
    isHydrated: true,
  }),
}));

describe("ShowingsPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/listings") && !url.includes("/showings")) {
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
      if (url.includes("/showings")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve([]),
        });
      }
      return Promise.reject(new Error("Unexpected URL"));
    });
  });

  it("renders Showings page title (h1)", () => {
    render(wrap(<ShowingsPage />));
    const headings = screen.getAllByRole("heading", { name: /showings/i });
    expect(headings.some((h) => h.tagName === "H1")).toBe(true);
  });

  it("renders Browse Listings link", () => {
    render(wrap(<ShowingsPage />));
    expect(screen.getByRole("link", { name: /browse listings/i })).toBeInTheDocument();
  });

  it("renders Showings by listing section", async () => {
    render(wrap(<ShowingsPage />));
    expect(await screen.findByText(/showings by listing/i)).toBeInTheDocument();
  });

  it("shows empty state when no listings", async () => {
    render(wrap(<ShowingsPage />));
    expect(await screen.findByText(/no listings/i)).toBeInTheDocument();
  });
});
