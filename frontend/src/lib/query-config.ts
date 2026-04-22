/**
 * React Query cache tuning for performance and smooth UX.
 * - Lists: longer stale so back navigation shows cached data; detail prefetch makes navigation instant.
 * - Detail: moderate stale; mutations invalidate so users see updates after actions.
 * - Static (preferences, saved): longer stale to reduce refetches.
 * - Realtime (chat): short stale; chat also uses refetchInterval.
 */

export const MS = 1000;
export const MIN = 60 * MS;

/** List pages (properties, listings, transactions). Kept fresh enough but avoids refetch on every visit. */
export const STALE_TIME_LIST = 2 * MIN; // 2 min

/** Single resource (property, listing, transaction). Mutations invalidate; this is for passive viewing. */
export const STALE_TIME_DETAIL = 90 * MS; // 1.5 min

/** Rarely changing (preferences, saved listings). */
export const STALE_TIME_STATIC = 5 * MIN; // 5 min

/** More dynamic (recommendations, chat room list). */
export const STALE_TIME_DYNAMIC = 1 * MIN; // 1 min

/** Chat messages: already polled; short stale for when polling is off. */
export const STALE_TIME_CHAT = 30 * MS; // 30 s

/** How long inactive cache stays in memory. Keeps list/detail cache for back navigation. */
export const GC_TIME = 10 * MIN; // 10 min (React Query default is 5 min)

/** Default for queries that don't specify: balance freshness and fewer requests. */
export const STALE_TIME_DEFAULT = 1 * MIN; // 1 min

// ---------------------------------------------------------------------------
// List pagination / initial load (production heavy-use)
// ---------------------------------------------------------------------------
/** Initial page size for cursor-based lists (transactions, listings). Keeps first load small; "Load more" fetches next page. */
export const DEFAULT_LIST_PAGE_SIZE = 25;

/** Dashboard only needs enough for pipeline counts + recent 5; avoid fetching 100. */
export const DASHBOARD_TRANSACTIONS_LIMIT = 30;

/** Dashboard listings: enough for "Active Listings" card. */
export const DASHBOARD_LISTINGS_LIMIT = 10;

// ---------------------------------------------------------------------------
// Prefetch (list card hover) — production-safe
// ---------------------------------------------------------------------------
/** Debounce hover so we prefetch at most one item per sweep (avoids N requests when moving across many cards). */
export const PREFETCH_DEBOUNCE_MS = 150;

/**
 * When true, prefetch on list card hover runs (debounced, cache-only prime).
 * Set NEXT_PUBLIC_PREFETCH_ON_HOVER=false or 0 in production to rely only on caching and avoid any hover-triggered requests.
 */
export function isPrefetchOnHoverEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = process.env.NEXT_PUBLIC_PREFETCH_ON_HOVER;
  return v !== "false" && v !== "0";
}
