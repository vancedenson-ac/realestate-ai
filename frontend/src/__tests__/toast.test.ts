/**
 * Toast helpers (toastError, toastSuccess, toastChampagne) used for API/load errors and champagne moments.
 * Sonner is mocked; we assert the right message is passed from getApiErrorMessage and custom champagne options.
 */

import { toast as sonnerToast } from "sonner";
import { toastError, toastSuccess, toastChampagne } from "@/lib/toast";
import { ApiException } from "@/lib/api";
import type { ChampagneMomentOverview } from "@/types/api";

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    custom: jest.fn(),
  },
}));

describe("toastError", () => {
  beforeEach(() => {
    (sonnerToast.error as jest.Mock).mockClear();
  });

  it("calls sonner.error with message from ApiException", () => {
    const err = new ApiException("Listing not found", 404, "NOT_FOUND");
    toastError(err);
    expect(sonnerToast.error).toHaveBeenCalledTimes(1);
    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Listing not found",
      expect.objectContaining({ duration: 5000, position: "bottom-center" })
    );
  });

  it("uses fallback when provided", () => {
    toastError(null, "Failed to load listings");
    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Failed to load listings",
      expect.any(Object)
    );
  });

  it("uses getApiErrorMessage for generic Error", () => {
    toastError(new Error("Network error"));
    expect(sonnerToast.error).toHaveBeenCalledWith("Network error", expect.any(Object));
  });

  it("uses default fallback for unknown and empty error", () => {
    toastError(undefined);
    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Something went wrong. Please try again.",
      expect.any(Object)
    );
  });
});

describe("toastSuccess", () => {
  beforeEach(() => {
    (sonnerToast.success as jest.Mock).mockClear();
  });

  it("calls sonner.success with message and options", () => {
    toastSuccess("Listing created");
    expect(sonnerToast.success).toHaveBeenCalledTimes(1);
    expect(sonnerToast.success).toHaveBeenCalledWith(
      "Listing created",
      expect.objectContaining({ duration: 3000, position: "bottom-center" })
    );
  });
});

describe("toastChampagne", () => {
  beforeEach(() => {
    (sonnerToast.custom as jest.Mock).mockClear();
  });

  it("calls sonner.custom with a render function and top-center options", () => {
    const moment: ChampagneMomentOverview = {
      event_id: "e0000001-0000-0000-0000-000000000001",
      event_type: "TransactionClosed",
      emitted_at: "2025-02-05T12:00:00Z",
      transaction_id: "c0000001-0000-0000-0000-000000000008",
      property_address: "123 Palm Ave, Beverly Hills",
      amount: 1500000,
      title: "Champagne Moment!",
      message: "Escrow Closed: 123 Palm Ave, Beverly Hills - $1.5M - Congratulations!",
    };
    toastChampagne(moment);
    expect(sonnerToast.custom).toHaveBeenCalledTimes(1);
    const [renderFn, options] = (sonnerToast.custom as jest.Mock).mock.calls[0];
    expect(typeof renderFn).toBe("function");
    expect(options).toEqual(
      expect.objectContaining({
        duration: 8000,
        position: "top-center",
      })
    );
  });

  it("passes moment into custom render (component receives correct data)", () => {
    const moment: ChampagneMomentOverview = {
      event_id: "e2",
      event_type: "TransactionClosed",
      emitted_at: "2025-02-05T12:00:00Z",
      transaction_id: "tx1",
      property_address: null,
      amount: null,
      title: "Champagne Moment!",
      message: "Escrow Closed",
    };
    toastChampagne(moment);
    const [renderFn] = (sonnerToast.custom as jest.Mock).mock.calls[0];
    const result = renderFn();
    expect(result.props.moment).toEqual(moment);
  });
});
