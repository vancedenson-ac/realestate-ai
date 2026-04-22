import React, { Suspense } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditListingPage from "@/app/listings/[id]/edit/page";
import type { SeedUser } from "@/types/api";
import type { ListingOverview } from "@/types/api";

const LISTING_ID = "l0000001-0000-0000-0000-000000000001";

const mockUser: SeedUser = {
  user_id: "b0000001-0000-0000-0000-000000000001",
  email: "alice@acme.com",
  full_name: "Alice Agent",
  organization_id: "a0000001-0000-0000-0000-000000000001",
  organization_name: "Acme Realty",
  role: "SELLER_AGENT",
};

const mockListing: ListingOverview = {
  listing_id: LISTING_ID,
  property_id: "p0000001-0000-0000-0000-000000000001",
  status: "DRAFT",
  list_price: 350000,
  price_currency: "USD",
  listing_type: "FOR_SALE",
  days_on_market: null,
  description: "Original description",
  is_public: false,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  cover_image_url: null,
};

const mockMutate = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();

// React 18 does not have use(); mock so use(params) returns params. Tests pass plain { id }.
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    use: <T,>(p: Promise<T> | T): T => (p && typeof (p as Promise<T>).then === "function" ? (undefined as unknown as T) : (p as T)),
  };
});

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: mockUser,
    isHydrated: true,
    setUser: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-listings", () => ({
  useListing: (id: string) => ({
    data: id === LISTING_ID ? mockListing : undefined,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
  useUpdateListing: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: jest.fn(),
  }),
}));

const mockToastError = jest.fn();
jest.mock("@/lib/toast", () => ({
  toastError: (...args: unknown[]) => mockToastError(...args),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>Loading page…</div>}>{ui}</Suspense>
    </QueryClientProvider>
  );
}

describe("EditListingPage", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockToastError.mockClear();
  });

  it("renders page title and back link", async () => {
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /edit listing/i })).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to listing/i });
    expect(backLink).toHaveAttribute("href", `/listings/${LISTING_ID}`);
  });

  it("renders form with list price, description, and public checkbox", async () => {
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/list price \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description \(optional\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/public \(visible to buyers\)/i)).toBeInTheDocument();
  });

  it("prefills form from listing data", async () => {
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    const listPriceInput = screen.getByLabelText(/list price \*/i);
    const descriptionInput = screen.getByLabelText(/description \(optional\)/i);
    const publicCheckbox = screen.getByLabelText(/public \(visible to buyers\)/i);
    expect(listPriceInput).toHaveValue(350000);
    expect(descriptionInput).toHaveValue("Original description");
    expect(publicCheckbox).not.toBeChecked();
  });

  it("renders Save changes and Cancel buttons", async () => {
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute(
      "href",
      `/listings/${LISTING_ID}`
    );
  });

  it("calls update mutation with edited values and redirects on success", async () => {
    const user = userEvent.setup();
    mockMutate.mockImplementation((payload, { onSuccess }: { onSuccess?: () => void }) => {
      onSuccess?.();
    });
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    const descriptionInput = screen.getByLabelText(/description \(optional\)/i);
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Updated description");
    const submitButton = screen.getByRole("button", { name: /save changes/i });
    await user.click(submitButton);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [payload] = mockMutate.mock.calls[0];
    expect(payload.description).toBe("Updated description");
    expect(payload.list_price).toBe(350000);
    expect(payload.is_public).toBe(false);
    expect(mockPush).toHaveBeenCalledWith(`/listings/${LISTING_ID}`);
  });

  it("disables submit when list price is zero and does not call mutation", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    const listPriceInput = screen.getByLabelText(/list price \*/i);
    await user.clear(listPriceInput);
    await user.type(listPriceInput, "0");
    const submitButton = screen.getByRole("button", { name: /save changes/i });
    expect(submitButton).toBeDisabled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("calls toastError on mutation error (onError path)", async () => {
    const user = userEvent.setup();
    const err = new Error("Update failed");
    mockMutate.mockImplementation((_payload: unknown, { onError }: { onError?: (e: Error) => void }) => {
      onError?.(err);
    });
    renderWithProviders(
      <EditListingPage params={{ id: LISTING_ID } as Promise<{ id: string }>} />
    );
    await waitFor(() => {
      expect(screen.queryByText(/loading page…/i)).not.toBeInTheDocument();
    });
    const submitButton = screen.getByRole("button", { name: /save changes/i });
    await user.click(submitButton);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(err, "Failed to update listing");
  });
});
