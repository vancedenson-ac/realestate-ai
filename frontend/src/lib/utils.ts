import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return formatDate(dateString);
}

export function getStateDisplayName(state: string): string {
  const stateNames: Record<string, string> = {
    PRE_LISTING: "Pre-Listing",
    LISTED: "Listed",
    OFFER_MADE: "Offer Made",
    UNDER_CONTRACT: "Under Contract",
    DUE_DILIGENCE: "Due Diligence",
    FINANCING: "Financing",
    CLEAR_TO_CLOSE: "Clear to Close",
    CLOSED: "Closed",
    CANCELLED: "Cancelled",
  };
  return stateNames[state] || state;
}

export function getStateBadgeClass(state: string): string {
  const classes: Record<string, string> = {
    PRE_LISTING: "state-badge-pre-listing",
    LISTED: "state-badge-listed",
    OFFER_MADE: "state-badge-offer-made",
    UNDER_CONTRACT: "state-badge-under-contract",
    DUE_DILIGENCE: "state-badge-due-diligence",
    FINANCING: "state-badge-financing",
    CLEAR_TO_CLOSE: "state-badge-clear-to-close",
    CLOSED: "state-badge-closed",
    CANCELLED: "state-badge-cancelled",
  };
  return `state-badge ${classes[state] || ""}`;
}

export function getRoleDisplayName(role: string): string {
  const roleNames: Record<string, string> = {
    BUYER: "Buyer",
    SELLER: "Seller",
    BUYER_AGENT: "Buyer Agent",
    SELLER_AGENT: "Seller Agent",
    ESCROW_OFFICER: "Escrow Officer",
    LENDER: "Lender",
    APPRAISER: "Appraiser",
    INSPECTOR: "Inspector",
    ADMIN: "Admin",
  };
  return roleNames[role] || role;
}

export function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    BUYER: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    SELLER: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    BUYER_AGENT: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    SELLER_AGENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    ESCROW_OFFICER: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    LENDER: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    APPRAISER: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    INSPECTOR: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    ADMIN: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return colors[role] || "bg-gray-100 text-gray-800";
}

export function truncateId(id: string, length: number = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

/** Document type options for dropdowns (includes pre_qualification_letter). */
export const DOCUMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "listing_agreement", label: "Listing agreement" },
  { value: "offer", label: "Offer" },
  { value: "purchase_agreement", label: "Purchase agreement" },
  { value: "escrow_instructions", label: "Escrow instructions" },
  { value: "inspection_report", label: "Inspection report" },
  { value: "appraisal_report", label: "Appraisal report" },
  { value: "loan_commitment", label: "Loan commitment" },
  { value: "funding_confirmation", label: "Funding confirmation" },
  { value: "deed", label: "Deed" },
  { value: "pre_qualification_letter", label: "Pre-qualification letter" },
  { value: "other", label: "Other" },
];

/** Showing type display labels. */
export function getShowingTypeLabel(type: string): string {
  return type === "OPEN_HOUSE" ? "Open house" : "Private";
}

/** Showing feedback rating labels. */
export const SHOWING_FEEDBACK_RATING_OPTIONS: { value: string; label: string }[] = [
  { value: "POSITIVE", label: "Positive" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "NEGATIVE", label: "Negative" },
  { value: "NO_SHOW", label: "No show" },
];

/** Format price for map marker pill: $550K, $1.2M, etc. */
export function formatPriceShort(price: number | null | undefined): string {
  if (price == null) return "$0";
  if (price >= 1_000_000) {
    const m = price / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (price >= 1_000) {
    const k = Math.round(price / 1_000);
    return `$${k}K`;
  }
  return `$${price}`;
}
