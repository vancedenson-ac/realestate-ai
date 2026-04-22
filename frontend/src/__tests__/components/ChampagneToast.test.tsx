import React from "react";
import { render, screen } from "@testing-library/react";
import { ChampagneToastContent } from "@/components/champagne-toast";
import type { ChampagneMomentOverview } from "@/types/api";

describe("ChampagneToastContent", () => {
  const defaultMoment: ChampagneMomentOverview = {
    event_id: "e0000001-0000-0000-0000-000000000001",
    event_type: "TransactionClosed",
    emitted_at: "2025-02-05T12:00:00Z",
    transaction_id: "c0000001-0000-0000-0000-000000000008",
    property_address: "123 Palm Ave, Beverly Hills",
    amount: 1500000,
    title: "Champagne Moment!",
    message: "Escrow Closed: 123 Palm Ave, Beverly Hills - $1.5M - Congratulations!",
  };

  it("renders title from moment", () => {
    render(<ChampagneToastContent moment={defaultMoment} />);
    expect(screen.getByText("Champagne Moment!")).toBeInTheDocument();
  });

  it("renders message from moment", () => {
    render(<ChampagneToastContent moment={defaultMoment} />);
    expect(
      screen.getByText(/Escrow Closed: 123 Palm Ave, Beverly Hills - \$1\.5M - Congratulations!/)
    ).toBeInTheDocument();
  });

  it("has role alert and aria-live polite for accessibility", () => {
    render(<ChampagneToastContent moment={defaultMoment} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "polite");
  });

  it("renders with minimal moment (null address and amount)", () => {
    const minimal: ChampagneMomentOverview = {
      ...defaultMoment,
      property_address: null,
      amount: null,
      message: "Escrow Closed",
    };
    render(<ChampagneToastContent moment={minimal} />);
    expect(screen.getByText("Champagne Moment!")).toBeInTheDocument();
    expect(screen.getByText("Escrow Closed")).toBeInTheDocument();
  });
});
