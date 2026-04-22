import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewPropertyPage from "@/app/properties/new/page";
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

jest.mock("@/hooks/use-properties", () => ({
  useCreateProperty: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("NewPropertyPage", () => {
  beforeEach(() => {
    mockMutate.mockClear();
  });

  it("renders page title and back link", () => {
    renderWithProviders(<NewPropertyPage />);
    expect(screen.getByRole("heading", { name: /add property/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to properties/i })).toHaveAttribute(
      "href",
      "/properties"
    );
  });

  it("renders required address fields", () => {
    renderWithProviders(<NewPropertyPage />);
    expect(screen.getByLabelText(/street address \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/city \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/state \/ province \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/postal code \*/i)).toBeInTheDocument();
  });

  it("renders property type select and optional fields", () => {
    renderWithProviders(<NewPropertyPage />);
    expect(screen.getByLabelText(/property type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/year built/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/living area/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bedrooms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bathrooms/i)).toBeInTheDocument();
  });

  it("renders submit and cancel buttons", () => {
    renderWithProviders(<NewPropertyPage />);
    expect(screen.getByRole("button", { name: /create property/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute("href", "/properties");
  });
});
