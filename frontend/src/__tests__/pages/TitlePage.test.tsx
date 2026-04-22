import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TitlePage from "@/app/title/page";

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

describe("TitlePage", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/transactions") && !url.includes("/title") && !url.includes("/closing")) {
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

  it("renders Title page title (h1)", () => {
    render(wrap(<TitlePage />));
    const headings = screen.getAllByRole("heading", { name: /title/i });
    expect(headings.some((h) => h.tagName === "H1")).toBe(true);
  });

  it("renders Title & Closing section", async () => {
    render(wrap(<TitlePage />));
    expect(await screen.findByText(/title & closing/i)).toBeInTheDocument();
  });

  it("shows empty state when no title transactions", async () => {
    render(wrap(<TitlePage />));
    expect(await screen.findByText(/no title transactions/i)).toBeInTheDocument();
  });
});
