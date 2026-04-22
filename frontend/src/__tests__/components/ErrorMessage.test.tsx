import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorMessage } from "@/components/error-message";

describe("ErrorMessage", () => {
  it("renders default title and message", () => {
    render(<ErrorMessage message="Something went wrong." />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("renders custom title when provided", () => {
    render(
      <ErrorMessage title="Load failed" message="Could not load data." />
    );
    expect(screen.getByText("Load failed")).toBeInTheDocument();
    expect(screen.getByText("Could not load data.")).toBeInTheDocument();
  });

  it("does not render Retry button when onRetry is omitted", () => {
    render(<ErrorMessage message="Fail" />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders Retry button and calls onRetry when clicked", () => {
    const onRetry = jest.fn();
    render(<ErrorMessage message="Fail" onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: /retry/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("applies custom className", () => {
    const { container } = render(
      <ErrorMessage message="Fail" className="custom-error" />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("custom-error");
  });
});
