# realtrust frontend — UI, Journey, and Pages

This document maps the UI routes, pages, and role-based behavior to the transaction journey and backend authority.

---

## 1. Route and page map

| Route | Page / purpose | Role visibility (UX only) |
|-------|----------------|---------------------------|
| `/` | Dashboard: pipeline summary, recent transactions, quick actions | All roles |
| `/transactions` | List transactions; filter by state; "New Transaction" links to `/transactions/new` | All; list filtered by `filterTransactionsByRole` (e.g. BUYER/BUYER_AGENT: hide PRE_LISTING) |
| `/transactions/new` | New transaction form: initial state, party role, optional property/listing; POST then redirect to detail | SELLER_AGENT, SELLER, ADMIN (UX); backend enforces |
| `/transactions/[id]` | Transaction detail: state, timeline, document checklist, transitions, parties, chat link. Documents tab: Type + "Choose file" (opens picker) + Upload; list shows View/Download when `view_url` present, "Upload pending" otherwise; simple upload failure message | Party or allowed role (backend RLS) |
| `/properties` | List properties; search; "Add Property" links to `/properties/new` | Per backend RLS |
| `/properties/new` | New property form: address, city, state, postal code, type, optional beds/baths/sqft/year; POST then redirect to detail | Per backend RLS (create) |
| `/properties/[id]` | Property detail; images displayed via `view_url`; "Upload pending" when no view_url; upload: file input or "Choose file" button that opens picker | Per backend RLS |
| `/listings` | List listings; "Create Listing" links to `/listings/new`; filter by status | Per backend RLS |
| `/listings/new` | Create listing form: property, list price, type, description, is_public (draft); POST then redirect to detail | SELLER_AGENT, SELLER, ADMIN (UX); backend enforces |
| `/listings/[id]` | Listing detail; "Publish listing" (DRAFT → ACTIVE + is_public) when role allows; interested buyers; view property | Per backend RLS |
| `/showings` | Showings (listing-scoped) | Per backend RLS |
| `/offers` | Offers (transaction-scoped) | Per backend RLS |
| `/documents` | Documents: upload card (transaction selector, document type, "Choose file" button opens picker, Upload); header "Upload Document" scrolls to card and can open picker; document list per transaction on transaction detail. RLS: lender MUST NOT see inspection_report (backend enforce) | Per backend RLS |
| `/inspections` | Inspections (transaction-scoped) | Nav: INSPECTOR, BUYER, BUYER_AGENT, SELLER, SELLER_AGENT, ADMIN |
| `/escrow` | Escrow assignments, EMD, funding, disbursements | Nav: ESCROW_OFFICER, BUYER, SELLER, BUYER_AGENT, SELLER_AGENT, ADMIN |
| `/title` | Title orders, commitment, deed recording, ownership transfer | Nav: ESCROW_OFFICER, BUYER, SELLER, BUYER_AGENT, SELLER_AGENT, LENDER, ADMIN |
| `/chat` | Chat rooms and messages | All (RLS per room) |
| `/recommendations` | User recommendations (matches) | Nav: BUYER, BUYER_AGENT |

---

## 2. Sidebar navigation (src/components/layout/sidebar.tsx)

- **navItems**: Array of `{ title, href, icon, roles? }`. If `roles` is set, item is shown only when `user.role` is in `roles`. Otherwise shown to all.
- **Current items**: Dashboard, Transactions, Properties, Listings, Showings, Offers, Documents, Inspections (role-filtered), Escrow (role-filtered), Title (role-filtered), Chat, Recommendations (BUYER, BUYER_AGENT only).

---

## 3. Transaction states in UI

- **Badge**: `TransactionStateBadge` in `src/components/transaction-state-badge.tsx`; use for `TransactionState` (PRE_LISTING … CLOSED, CANCELLED).
- **State order**: Use same order as backend/journey (e.g. PRE_LISTING → … → CLEAR_TO_CLOSE → CLOSED).
- **CLOSED meaning**: In UI copy and tooltips, CLOSED means deed recorded and ownership transfer confirmed (align with backend and ref 17).

---

## 4. Journey alignment

- **Dashboard**: Pipeline view by state; quick links to Transactions, Properties, Listings, Recommendations (if buyer), Chat.
- **Transaction detail**: Show current state, timeline (state changes + events), document checklist (required for next transition), transition button (backend will reject if illegal or wrong role).
- **Milestone screens**: Documents, Inspections, Escrow, Title pages reflect backend milestone facts; creating/submitting records calls backend; UI does not gate legality—backend does.

---

## 5. Loading, error, empty states

- **Loading**: Use `LoadingSpinner`; show while `isHydrated` is false or query `isLoading`.
- **Error**: Use `ErrorMessage` with optional retry (e.g. refetch). For API errors, show message from `ApiException` and optionally `code` (e.g. ILLEGAL_TRANSITION, NOT_FOUND).
- **Empty**: Use `EmptyState` when list or detail is empty (e.g. no transactions, no recommendations).

---

## 6. Auth UI (dev)

- **Switcher**: Header or sidebar may show current user (e.g. `displayName(user)`) and a dropdown to switch to another seed user via `setUser`. Use `getUniqueUsers()` for options. Persist selection to localStorage so it survives refresh.
