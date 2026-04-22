# realtrust frontend — API Contract (Paths, Headers, Types, Errors)

This document specifies how the frontend talks to the realtrust-ai backend API.

---

## 1. Base URL and prefix

- **Env**: `NEXT_PUBLIC_API_BASE` (e.g. `http://localhost:8000` or empty when same-origin).
- **Prefix**: `API_V1_PREFIX = "/realtrust-ai/v1"` (hardcoded in `src/lib/api.ts`).
- **Full URL**: `buildApiUrl(path)` → `getBaseUrl() + API_V1_PREFIX + path`. Path must start with `/` or be normalized (e.g. `transactions` → `/transactions`).

---

## 2. RLS headers (MUST on every request)

The backend uses these to set PostgreSQL session context (`SET LOCAL`). Frontend MUST send them for every API call.

| Header | Source | Notes |
|--------|--------|------|
| `X-User-Id` | `user.user_id` | UUID |
| `X-Organization-Id` | `user.organization_id` | UUID |
| `X-Role` | `user.role` | e.g. BUYER, SELLER_AGENT, ESCROW_OFFICER, LENDER |
| `Content-Type` | `application/json` | For requests with body |
| `Accept` | `application/json` | |

Optional (if backend supports): `X-License-State`, `X-Risk-Clearance`. Production: identity MUST come from verified token; headers may be overridden by backend from token claims.

---

## 3. Path alignment with backend router

Backend mounts some routers **with** a prefix (e.g. `prefix="/transactions"`) and others **with no prefix** (offers, showings, documents, inspections, appraisals, events, escrow, title). For no-prefix routers, the path is exactly as in the endpoint (e.g. `transactions/{id}/offers`). Frontend MUST use the same path; **do not** prepend the domain (e.g. use `transactions/${id}/offers`, not `offers/transactions/${id}/offers`).

### 3.1 Exact path table (path segment only; base URL + API_V1_PREFIX applied by buildApiUrl)

| Domain | Method | Path (use in apiFetch/buildApiUrl) |
|--------|--------|-----------------------------------|
| Transactions | GET | `transactions`, `transactions/${id}` |
| Transactions | POST | `transactions`, `transactions/${id}/transitions`, `transactions/${id}/parties` |
| Transactions | GET | `transactions/${id}/document-checklist`, `transactions/${id}/timeline`, `transactions/${id}/ai/insights`, `transactions/${id}/chat` |
| Properties | GET/POST | `properties`, `properties/${id}`; PATCH `properties/${id}` |
| Properties | POST | `properties/search`, `properties/${id}/images/upload`, `properties/search/by-image` |
| Properties | GET/PATCH/DELETE | `properties/${id}/images`, `properties/${id}/images/${imageId}` |
| Listings | GET/POST | `listings`, `listings/${id}`; PATCH `listings/${id}`; GET `listings/${id}/interested-buyers` |
| Documents | GET/POST | `transactions/${tid}/documents`; GET `documents/${id}`; POST `documents/${id}/upload-url`, `documents/${id}/versions`, `documents/${id}/lock`, `documents/${id}/signatures` |
| Inspections | POST | `transactions/${tid}/inspections`; GET `inspections/${id}`; POST `inspections/${id}/submit` |
| Appraisals | POST | `transactions/${tid}/appraisals`; GET `appraisals/${id}`; POST `appraisals/${id}/submit` |
| Events | GET | `transactions/${tid}/events` |
| Offers | GET/POST | `transactions/${tid}/offers`; POST `offers/${id}/counter`, `offers/${id}/withdraw`, `offers/${id}/reject`, `offers/${id}/accept` |
| Showings | GET/POST | `listings/${lid}/showings`; PATCH `showings/${id}` |
| Escrow | POST | `transactions/${tid}/escrow/assignments`, `transactions/${tid}/escrow/earnest-money/confirm`, `transactions/${tid}/escrow/funding/confirm`, `transactions/${tid}/escrow/disbursements` |
| Title | POST | `transactions/${tid}/title/orders`, `transactions/${tid}/title/commitments`, `transactions/${tid}/closing/deed-recorded`, `transactions/${tid}/closing/ownership-transfer`, `transactions/${tid}/appraisals/waive` |
| Title | PATCH | `title/orders/${orderId}` |
| Users/me | GET/POST/PATCH/DELETE | `users/me/preferences`, `users/me/preferences/${id}`; `users/me/recommendations`, `users/me/recommendations/${matchId}/feedback`; `users/me/saved-listings`, `users/me/saved-listings/${listingId}`; GET `users/me/eligible-escrow-officers`; GET `users/me/champagne-moments` |
| Chat | GET/POST/PATCH/DELETE | `chat/rooms`, `chat/rooms/${id}`, `chat/rooms/${id}/members`, `chat/rooms/${id}/members/${userId}`; `chat/rooms/${id}/messages`, `chat/messages/${id}`; `chat/rooms/${id}/mark-read`; `chat/attachments/upload`; `chat/rooms/${id}/attachments` |
| AI | POST | `ai/insights/${insightId}/approve` |

When adding a new endpoint: check backend `api/v1/router.py` and the endpoint file for the exact path string; add to this table and to `src/lib/api.ts` with the same path (no extra prefix).

### 3.2 Compliance (RBAC/ABAC alignment)

- **RLS headers** are required on every request; backend sets PostgreSQL session context from them (or from verified token in production). Without correct headers, RLS may deny access or return empty results.
- **Do not send role or user_id in request body** for role-scoped operations (e.g. state transitions, offer submit). Backend derives actor from session (X-Role, X-User-Id). Sending role in body would undermine auditability and spec compliance (06-authorization-and-data-access, 18-authorization-audit).

---

## 4. Types (src/types/api.ts)

Types MUST mirror backend Pydantic response/request schemas. Key names:

- **Auth**: `SeedUser`, `UserRole`
- **Transaction**: `TransactionState`, `TransactionOverview`, `TransactionListResponse`, `TransactionCreate` (requires `organization_id`; use `user.organization_id` on create), `TransitionRequest`, `PartyCreate`, `DocumentChecklistItem`, `TransactionTimeline`
- **Property, Listing, Offer, Showing, Document, Inspection, Appraisal, Escrow, Title, Chat, Preferences, Recommendations, Events**: Overview/Create/Update/List types as in backend schemas. **Property images**: `PropertyImageOverview` includes `view_url: string | null` (presigned GET for display when upload complete). **Documents**: `DocumentOverview` includes `view_url: string | null` (presigned GET for latest version when at least one version exists).
- **Errors**: `ApiError` with `error?: { code?, message?, details? }`, `detail?`

When backend adds or changes a field, update `api.ts` and `types/api.ts` accordingly.

---

## 5. Error handling

- **HTTP non-2xx**: `apiFetch` throws `ApiException(message, status, code?, details?)`. Response body parsed as JSON; `detail.error.code` and `detail.error.message` and `detail.error.details` extracted. FastAPI validation errors may return `detail` as a string or as an array of `{ msg, type, loc, ... }`; `getApiErrorMessageFromResponse` in api.ts handles both for user-facing text.
- **Canonical codes** (from backend): `UNAUTHENTICATED`, `UNAUTHORIZED`, `FORBIDDEN_BY_POLICY`, `ILLEGAL_TRANSITION`, `PRECONDITION_FAILED`, `CONFLICT`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.
- **UI**: All errors surface as brief bottom toasts (`toastError`); `getApiErrorMessage` produces the message. Failed queries show Retry only; mutations use onError with toastError. No inline error text. Backend codes are mapped in getApiErrorMessage (e.g. ILLEGAL_TRANSITION → “This state change is not allowed.”). Do not rely on frontend to prevent illegal actions—backend rejects them.

---

## 6. API module (src/lib/api.ts)

- **buildApiUrl(path, params?)**: Builds full URL with optional query params.
- **getRlsHeaders(user)**: Returns object with `X-User-Id`, `X-Organization-Id`, `X-Role`, `Content-Type`, `Accept`.
- **apiFetch<T>(path, { user, method?, body?, params? })**: Calls `fetch`, attaches RLS headers, throws `ApiException` on !res.ok, returns parsed JSON or undefined.
- **getApiErrorMessage(error, fallback?)**: Returns a user-facing string from `ApiException` (message/code mapping) or generic Error; used by `toastError` for consistent copy.
- **getApiErrorMessageFromResponse(err, status)**: Parses `ApiError` body (detail.error.message, detail string, or detail array of validation items) for toast message.
- **Domain objects**: `transactionsApi`, `propertiesApi`, `listingsApi`, `offersApi`, `showingsApi`, `documentsApi`, `inspectionsApi`, `appraisalsApi`, `escrowApi`, `titleApi`, `chatApi`, `preferencesApi`, `recommendationsApi`, `eventsApi`, `aiApi`. Each method takes `user: SeedUser` as first argument and path/body as needed.

When adding a new endpoint: add the path (aligned with backend), add types if needed, add a method to the appropriate `*Api` object, and use it from a hook that passes `user` from `useAuth()`.
