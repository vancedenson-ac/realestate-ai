import React from "react";
import { render } from "@testing-library/react";
import {
  LoadingSpinner,
  LoadingPage,
  LoadingCard,
} from "@/components/loading-spinner";

describe("LoadingSpinner", () => {
  it("renders with default size (md)", () => {
    const { container } = render(<LoadingSpinner />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("h-8", "w-8");
  });

  it("renders with size sm", () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("h-4", "w-4");
  });

  it("renders with size lg", () => {
    const { container } = render(<LoadingSpinner size="lg" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("h-12", "w-12");
  });

  it("applies custom className", () => {
    const { container } = render(
      <LoadingSpinner className="my-spinner" />
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("my-spinner");
  });

  it("has animate-spin for rotation", () => {
    const { container } = render(<LoadingSpinner />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("animate-spin");
  });
});

describe("LoadingPage", () => {
  it("renders a full-height centered spinner", () => {
    const { container } = render(<LoadingPage />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("flex", "h-full", "items-center", "justify-center");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("LoadingCard", () => {
  it("renders a bordered card with spinner", () => {
    const { container } = render(<LoadingCard />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("rounded-lg", "border", "bg-card");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
