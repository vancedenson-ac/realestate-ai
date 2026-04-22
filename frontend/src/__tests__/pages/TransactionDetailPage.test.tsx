import React, { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TransactionDetailPage from "@/app/transactions/[id]/page";
import type { TransactionOverview } from "@/types/api";
import { TooltipProvider } from "@/components/ui/tooltip";

const TX_ID = "c0000001-0000-0000-0000-000000000005";

const mockTransactionDueDiligence: TransactionOverview = {
  transaction_id: TX_ID,
  organization_id: "a0000001-0000-0000-0000-000000000001",
  current_state: "DUE_DILIGENCE",
  listing_id: "l0000001-0000-0000-0000-000000000001",
  property_id: "p0000001-0000-0000-0000-000000000001",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  address_line_1: null,
  city: null,
  state_province: null,
  postal_code: null,
  list_price: null,
  price_currency: null,
};

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    use: <T,>(p: Promise<T> | T): T =>
      p && typeof (p as Promise<T>).then === "function" ? (undefined as unknown as T) : (p as T),
  };
});

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: {
      user_id: "b0000001-0000-0000-0000-000000000006",
      email: "bailey@acme.com",
      full_name: "Bailey Agent",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      organization_name: "Acme Realty",
      role: "BUYER_AGENT",
    },
    isHydrated: true,
    setUser: jest.fn(),
  }),
}));

function createMockFetch(responses: Record<string, unknown>) {
  return jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    const path = url.replace(/^.*\/realtrust-ai\/v1\//, "").replace(/\?.*$/, "").replace(/^\//, "");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")) || "GET";
    const isGetTransaction =
      method === "GET" && (path === `transactions/${TX_ID}` || path === `transactions/${TX_ID}/`);
    if (isGetTransaction) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(mockTransactionDueDiligence),
      });
    }
    if (path.includes("appraisals/waivers") && path.includes(TX_ID)) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(responses.waivers ?? []),
      });
    }
    if (path === `transactions/${TX_ID}/document-checklist`) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve([]),
      });
    }
    if (path === `transactions/${TX_ID}/documents`) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve([]),
      });
    }
    if (path === `transactions/${TX_ID}/timeline`) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ state_changes: [] }),
      });
    }
    if (path === `transactions/${TX_ID}/offers`) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve([]),
      });
    }
    if (path.includes("title/") || path.includes("closing/") || path.includes("escrow/")) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve([]),
      });
    }
    if (path === `transactions/${TX_ID}/inspections`) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve([]),
      });
    }
    return Promise.reject(new Error(`Unmocked: ${path}`));
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<div>Loading page…</div>}>{ui}</Suspense>
      </QueryClientProvider>
    </TooltipProvider>
  );
}

describe("TransactionDetailPage", () => {
  beforeEach(() => {
    global.fetch = createMockFetch({ waivers: [] }) as typeof fetch;
  });

  it("shows Appraisal waiver card and Waive appraisal button when state is DUE_DILIGENCE and user is BUYER_AGENT", async () => {
    renderWithProviders(
      <TransactionDetailPage params={{ id: TX_ID } as Promise<{ id: string }>} />
    );
    await waitFor(
      () => {
        expect(screen.getByRole("tab", { name: /documents/i })).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    const documentsTab = screen.getByRole("tab", { name: /documents/i });
    await userEvent.click(documentsTab);
    await waitFor(() => {
      expect(screen.getByText(/appraisal waiver/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /waive appraisal/i })).toBeInTheDocument();
  });

  it("shows Appraisal waived message when waivers list is non-empty", async () => {
    global.fetch = createMockFetch({
      waivers: [
        {
          waiver_id: "w0000001-0000-0000-0000-000000000001",
          transaction_id: TX_ID,
          waived_by_user_id: "b0000001-0000-0000-0000-000000000006",
          waived_at: "2025-02-01T12:00:00Z",
          reason: "Buyer waived",
        },
      ],
    }) as typeof fetch;

    renderWithProviders(
      <TransactionDetailPage params={{ id: TX_ID } as unknown as Promise<{ id: string }>} />
    );
    await waitFor(
      () => {
        expect(screen.getByRole("tab", { name: /documents/i })).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    const documentsTab = screen.getByRole("tab", { name: /documents/i });
    await userEvent.click(documentsTab);
    await waitFor(() => {
      expect(screen.getByText(/appraisal waiver/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/appraisal waived on/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /waive appraisal/i })).not.toBeInTheDocument();
  });

  it("shows Next transition card (Phase A.2 precondition checklist) when state has allowed transitions", async () => {
    renderWithProviders(
      <TransactionDetailPage params={{ id: TX_ID } as Promise<{ id: string }>} />
    );
    await waitFor(
      () => {
        expect(screen.getByText(/next transition/i)).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(screen.getByText(/next transition/i)).toBeInTheDocument();
  });
});
