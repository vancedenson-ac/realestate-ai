import React from "react";
import { render, screen } from "@testing-library/react";
import { TransactionStateBadge } from "@/components/transaction-state-badge";

describe("TransactionStateBadge", () => {
  it("renders with correct display name", () => {
    render(<TransactionStateBadge state="PRE_LISTING" />);
    expect(screen.getByText("Pre-Listing")).toBeInTheDocument();
  });

  it("renders UNDER_CONTRACT correctly", () => {
    render(<TransactionStateBadge state="UNDER_CONTRACT" />);
    expect(screen.getByText("Under Contract")).toBeInTheDocument();
  });

  it("renders DUE_DILIGENCE correctly", () => {
    render(<TransactionStateBadge state="DUE_DILIGENCE" />);
    expect(screen.getByText("Due Diligence")).toBeInTheDocument();
  });

  it("renders CLEAR_TO_CLOSE correctly", () => {
    render(<TransactionStateBadge state="CLEAR_TO_CLOSE" />);
    expect(screen.getByText("Clear to Close")).toBeInTheDocument();
  });

  it("renders terminal states correctly", () => {
    render(<TransactionStateBadge state="CLOSED" />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("renders CANCELLED correctly", () => {
    render(<TransactionStateBadge state="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(<TransactionStateBadge state="LISTED" className="custom-class" />);
    const badge = screen.getByText("Listed");
    expect(badge).toHaveClass("custom-class");
  });
});
