import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SavedPropertiesPage from "@/app/saved/page";

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

const mockRefetch = jest.fn();
const mockToastError = jest.fn();
const mockUseSavedListings = jest.fn();

jest.mock("@/context/auth-context", () => ({
  useAuth: () => ({
    user: {
      user_id: "b0000001-0000-0000-0000-000000000002",
      email: "bob@example.com",
      full_name: "Bob Buyer",
      organization_id: "a0000001-0000-0000-0000-000000000001",
      organization_name: "Acme",
      role: "BUYER",
    },
    isHydrated: true,
  }),
}));

jest.mock("@/hooks/use-recommendations", () => ({
  useSavedListings: (...args: unknown[]) => mockUseSavedListings(...args),
  useUnsaveListing: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("@/lib/toast", () => ({
  toastError: (...args: unknown[]) => mockToastError(...args),
}));

describe("SavedPropertiesPage", () => {
  beforeEach(() => {
    mockRefetch.mockClear();
    mockToastError.mockClear();
    mockUseSavedListings.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  it("renders Saved Properties heading", () => {
    render(wrap(<SavedPropertiesPage />));
    expect(screen.getByRole("heading", { name: /saved properties/i })).toBeInTheDocument();
  });

  it("shows empty state when user has no saved listings", async () => {
    mockUseSavedListings.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
    render(wrap(<SavedPropertiesPage />));
    expect(await screen.findByText(/no saved listings/i)).toBeInTheDocument();
  });

  it("shows Retry button and calls toastError when load fails", () => {
    const loadError = new Error("Failed to load");
    mockUseSavedListings.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: loadError,
      refetch: mockRefetch,
    });
    render(wrap(<SavedPropertiesPage />));
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalledWith(loadError, "Failed to load saved listings");
  });

  it("calls refetch when Retry is clicked", async () => {
    const loadError = new Error("Failed to load");
    mockUseSavedListings.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: loadError,
      refetch: mockRefetch,
    });
    const user = userEvent.setup();
    render(wrap(<SavedPropertiesPage />));
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
