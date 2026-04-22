import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  getStateDisplayName,
  getStateBadgeClass,
  getRoleDisplayName,
  getRoleBadgeColor,
  getShowingTypeLabel,
  truncateId,
  formatPriceShort,
  DOCUMENT_TYPE_OPTIONS,
  SHOWING_FEEDBACK_RATING_OPTIONS,
} from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toContain("base");
    expect(cn("base", false && "hidden", "visible")).toContain("visible");
  });

  it("deduplicates tailwind classes with twMerge", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
});

describe("formatCurrency", () => {
  it("formats positive numbers as USD currency", () => {
    expect(formatCurrency(500000)).toBe("$500,000");
    expect(formatCurrency(1234567)).toBe("$1,234,567");
  });

  it("returns dash for null or undefined", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
  });

  it("formats zero correctly", () => {
    expect(formatCurrency(0)).toBe("$0");
  });
});

describe("formatDate", () => {
  it("formats date strings", () => {
    const result = formatDate("2024-03-15T10:30:00Z");
    expect(result).toContain("2024");
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });

  it("returns dash for null or undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formats date and time", () => {
    const result = formatDateTime("2024-03-15T14:30:00Z");
    expect(result).toContain("2024");
    expect(result).toContain("Mar");
    expect(result).toContain("15");
    expect(result).toMatch(/\d|1[0-4]/); // hour
  });

  it("returns dash for null or undefined", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatRelativeTime", () => {
  it('returns "just now" for very recent dates', () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe("just now");
  });

  it("returns minutes ago for recent date", () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - 5);
    expect(formatRelativeTime(d.toISOString())).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const d = new Date();
    d.setHours(d.getHours() - 2);
    expect(formatRelativeTime(d.toISOString())).toBe("2h ago");
  });

  it("returns days ago for older date", () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    expect(formatRelativeTime(d.toISOString())).toContain("d ago");
  });

  it("falls back to formatDate for dates older than a week", () => {
    const d = new Date("2020-01-01T12:00:00Z");
    const result = formatRelativeTime(d.toISOString());
    expect(result).toContain("2020");
    expect(result).toContain("Jan");
  });
});

describe("getStateDisplayName", () => {
  it("returns human-readable state names", () => {
    expect(getStateDisplayName("PRE_LISTING")).toBe("Pre-Listing");
    expect(getStateDisplayName("UNDER_CONTRACT")).toBe("Under Contract");
    expect(getStateDisplayName("DUE_DILIGENCE")).toBe("Due Diligence");
    expect(getStateDisplayName("CLEAR_TO_CLOSE")).toBe("Clear to Close");
  });

  it("returns original state for unknown states", () => {
    expect(getStateDisplayName("UNKNOWN_STATE")).toBe("UNKNOWN_STATE");
  });
});

describe("getStateBadgeClass", () => {
  it("returns correct classes for each state", () => {
    expect(getStateBadgeClass("PRE_LISTING")).toContain("state-badge");
    expect(getStateBadgeClass("LISTED")).toContain("state-badge-listed");
    expect(getStateBadgeClass("CLOSED")).toContain("state-badge-closed");
    expect(getStateBadgeClass("CANCELLED")).toContain("state-badge-cancelled");
  });
});

describe("getRoleDisplayName", () => {
  it("returns human-readable role names", () => {
    expect(getRoleDisplayName("BUYER")).toBe("Buyer");
    expect(getRoleDisplayName("SELLER_AGENT")).toBe("Seller Agent");
    expect(getRoleDisplayName("ESCROW_OFFICER")).toBe("Escrow Officer");
  });

  it("returns original role for unknown roles", () => {
    expect(getRoleDisplayName("UNKNOWN_ROLE")).toBe("UNKNOWN_ROLE");
  });
});

describe("getRoleBadgeColor", () => {
  it("returns color classes for roles", () => {
    expect(getRoleBadgeColor("BUYER")).toContain("bg-blue");
    expect(getRoleBadgeColor("SELLER")).toContain("bg-green");
    expect(getRoleBadgeColor("ESCROW_OFFICER")).toContain("bg-purple");
  });

  it("returns gray for unknown roles", () => {
    expect(getRoleBadgeColor("UNKNOWN")).toContain("bg-gray");
  });
});

describe("truncateId", () => {
  it("truncates long IDs", () => {
    const longId = "c0000001-0000-0000-0000-000000000001";
    expect(truncateId(longId)).toBe("c0000001...");
    expect(truncateId(longId, 12)).toBe("c0000001-000...");
  });

  it("returns short IDs unchanged", () => {
    expect(truncateId("short")).toBe("short");
    expect(truncateId("12345678", 10)).toBe("12345678");
  });
});

describe("getShowingTypeLabel", () => {
  it("returns Open house for OPEN_HOUSE", () => {
    expect(getShowingTypeLabel("OPEN_HOUSE")).toBe("Open house");
  });

  it("returns Private for PRIVATE and other values", () => {
    expect(getShowingTypeLabel("PRIVATE")).toBe("Private");
    expect(getShowingTypeLabel("OTHER")).toBe("Private");
  });
});

describe("DOCUMENT_TYPE_OPTIONS", () => {
  it("includes pre_qualification_letter for pre-qualification feature", () => {
    const preQual = DOCUMENT_TYPE_OPTIONS.find((o) => o.value === "pre_qualification_letter");
    expect(preQual).toBeDefined();
    expect(preQual?.label).toBe("Pre-qualification letter");
  });

  it("includes common document types", () => {
    const values = DOCUMENT_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain("inspection_report");
    expect(values).toContain("appraisal_report");
    expect(values).toContain("purchase_agreement");
    expect(values).toContain("other");
  });
});

describe("SHOWING_FEEDBACK_RATING_OPTIONS", () => {
  it("includes all feedback ratings for showing feedback feature", () => {
    const values = SHOWING_FEEDBACK_RATING_OPTIONS.map((o) => o.value);
    expect(values).toContain("POSITIVE");
    expect(values).toContain("NEUTRAL");
    expect(values).toContain("NEGATIVE");
    expect(values).toContain("NO_SHOW");
  });

  it("has labels for each option", () => {
    SHOWING_FEEDBACK_RATING_OPTIONS.forEach((o) => {
      expect(o.label.length).toBeGreaterThan(0);
    });
  });
});

describe("formatPriceShort", () => {
  it("formats millions with M suffix", () => {
    expect(formatPriceShort(1_000_000)).toBe("$1M");
    expect(formatPriceShort(1_200_000)).toBe("$1.2M");
    expect(formatPriceShort(2_500_000)).toBe("$2.5M");
    expect(formatPriceShort(10_000_000)).toBe("$10M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatPriceShort(550_000)).toBe("$550K");
    expect(formatPriceShort(425_000)).toBe("$425K");
    expect(formatPriceShort(1_000)).toBe("$1K");
    expect(formatPriceShort(285_000)).toBe("$285K");
    expect(formatPriceShort(999_999)).toBe("$1000K");
  });

  it("formats small amounts without suffix", () => {
    expect(formatPriceShort(500)).toBe("$500");
    expect(formatPriceShort(0)).toBe("$0");
  });

  it("handles null and undefined", () => {
    expect(formatPriceShort(null)).toBe("$0");
    expect(formatPriceShort(undefined)).toBe("$0");
  });
});
