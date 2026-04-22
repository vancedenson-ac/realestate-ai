# realtrust ai — Exposed Views and API Contracts (Backend-Only)

This document specifies the backend “read views” and API contracts for realtrust ai.

Goals:

- stable, versioned API surfaces that can be audited and tested
- view resources aligned with RLS and data classification
- command endpoints that enforce legality via DB functions

Non-goals:

- frontend UX design
- client-driven authorization (the backend does not rely on it)

**Implementation note:** Transaction parties are managed transaction-scoped (e.g. create transaction with initial party; add/update via transaction endpoints). Buyer preferences and recommendations are exposed under `/v1/users/me/preferences` and `/v1/users/me/recommendations` (see 6.11).

---

## 1. API design principles

### 1.1 Command vs query separation

- **Commands** mutate authoritative state and MUST be explicit endpoints (e.g., transition state).
- **Queries** return view resources and MUST be read-only and RLS-constrained.

### 1.2 Versioning

APIs MUST be versioned (e.g., `/v1/...`). The base path may be configurable (e.g. `/realtrust-ai/v1`); the version segment remains `/v1`.

Breaking changes require a new version.

### 1.3 Idempotency

Write endpoints SHOULD support idempotency keys to prevent duplicate commands.

- Header: `Idempotency-Key: <uuid>`

The system MUST store command dedupe metadata in PostgreSQL (authoritative) for a bounded time window.

Redis MAY be used as a cache, but MUST NOT be the sole source of truth for idempotency.

### 1.4 Correlation and audit traceability

Every request SHOULD carry a correlation id:

- Header: `X-Correlation-Id: <string>`

The API MUST propagate this into:

- audit events
- domain events (where applicable)
- logs/metrics

---

## 2. Authentication and authorization

### 2.1 Authentication

Clients authenticate via OAuth2/OIDC bearer tokens:

- Header: `Authorization: Bearer <token>`

### 2.2 Authorization enforcement

The API MUST:

- authenticate the caller
- resolve effective role(s) in context
- set DB session variables for RLS enforcement (MUST be transaction-scoped; `SET LOCAL`)
- call DB command functions for authoritative mutations

The DB remains final authority; the API is not trusted as the sole enforcement mechanism.

See `06-authorization-and-data-access.md`.

---

## 3. Standard response and error model

### 3.1 Success response shape

Response bodies SHOULD be JSON and include:

- `data` (resource or list)
- `meta` (pagination, version)
- `links` (optional)

### 3.2 Error response shape (recommended)

```json
{
  "error": {
    "code": "ILLEGAL_TRANSITION",
    "message": "Illegal transition OFFER_MADE → CLOSED by role BUYER_AGENT",
    "details": {
      "transaction_id": "..."
    }
  }
}
```

### 3.3 Error codes (canonical set)

- `UNAUTHENTICATED`
- `UNAUTHORIZED`
- `FORBIDDEN_BY_POLICY` (explicit deny)
- `ILLEGAL_TRANSITION`
- `PRECONDITION_FAILED`
- `CONFLICT` (optimistic concurrency / idempotency mismatch)
- `NOT_FOUND` (note: with RLS, invisibility may appear as not found)
- `VALIDATION_ERROR`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

---

## 4. Pagination and filtering (queries)

List endpoints MUST support stable pagination.

Recommended approach:

- cursor-based pagination with `cursor` + `limit`

Filtering SHOULD be explicit and allow only safe queryable fields; avoid free-form SQL-like filters.

---

## 5. Canonical “view resources” (read models)

These view resources are the backend contract for “what a caller is allowed to know” about a transaction.

All views MUST respect:

- RLS
- classification rules
- explicit denies (inspection → lender)

### 5.1 Transaction overview view

Resource: `TransactionOverview`

Fields (example; policy-filtered):

- transaction_id
- current_state
- jurisdiction
- key dates (created_at, state_entered_at, close_date if visible)
- party summary (roles and redacted identities per policy)
- milestone flags (e.g., “required documents outstanding”)

Suggested DB view:

- `v_transaction_overview`

### 5.2 Document checklist view

Resource: `TransactionDocumentChecklist`

Shows required documents for the next legal transitions and close prerequisites:

- document_type
- required_for_state(s)
- present (bool)
- signed (bool)
- locked (bool)

Suggested DB view:

- `v_transaction_document_checklist`

### 5.3 Transaction timeline view (evidence)

Resource: `TransactionTimeline`

Derived from:

- transaction_state_history (authoritative)
- domain_events (evidence)

Suggested DB view:

- `v_transaction_timeline`

The timeline MUST NOT leak restricted payloads to unauthorized roles.

### 5.4 Audit timeline view (compliance export)

Resource: `AuditTimeline`

Derived from:

- audit_events
- access_decisions (if enabled)

Suggested DB view:

- `v_audit_timeline`

### 5.5 Property search results view

Resource: `PropertySearchResults`

Fields:

- listing_id, property_id
- address, city, state, postal_code
- list_price, price_per_sqft
- bedrooms, bathrooms, living_area_sqft
- property_type, year_built
- primary_image_url, image_count
- days_on_market, listing_status
- distance_miles (when searching by location)

### 5.6 Chat room view

Resource: `ChatRoomView`

Fields:

- room_id, room_type, name
- transaction_id (if applicable)
- members (list with user_id, display_name, role)
- last_message (preview)
- unread_count (for current user)
- is_muted

### 5.7 Recommendation view

Resource: `PropertyRecommendation`

Fields:

- listing (nested ListingDetails)
- property (nested PropertyDetails)
- match_score (0.0 to 1.0)
- match_explanation (AI-generated text)
- score_breakdown (price, features, semantic, location)
- recommended_at

---

## 6. API endpoints (v1)

This section specifies the recommended endpoint surface area. Exact naming MAY vary, but semantics MUST hold.

### 6.1 Transactions

#### Create transaction

- `POST /v1/transactions`

Creates a new transaction in an initial state (typically PRE_LISTING or LISTED depending on origin).

The API MUST:

- set jurisdiction/compliance context
- bind initial parties (seller and seller agent at minimum)
- emit a domain event (`TransactionCreated` or equivalent)

#### Get transaction overview

- `GET /v1/transactions/{transaction_id}`

Returns `TransactionOverview` under policy filtering.

#### List transactions (scoped to caller)

- `GET /v1/transactions?cursor=...&limit=...`

RLS ensures only visible transactions appear.

#### Transition transaction state (command)

- `POST /v1/transactions/{transaction_id}/transitions`

Request:

```json
{
  "to_state": "UNDER_CONTRACT",
  "action": "accept_offer",
  "metadata": {
    "reason": "..."
  }
}
```

Rules:

- API MUST reject transitions not present in the canonical spec for better UX.
- API MUST derive the effective actor role(s) from validated identity + transaction relationship; clients MUST NOT be trusted to supply roles.
- DB transition function is final authority; it MUST enforce legality and invariants.
- On success, the DB MUST emit the domain event within the same commit.

### 6.2 Transaction parties

#### Add or update party binding (command; policy-controlled)

- `POST /v1/transactions/{transaction_id}/parties`

This endpoint is sensitive; it changes relationship and therefore visibility boundaries. It MUST be strictly policy-governed and audited.

### 6.3 Documents and versions

#### Create document metadata record

- `POST /v1/transactions/{transaction_id}/documents`

Creates a `documents` row with classification, type, visibility, and an initial version placeholder.

#### Add document version (upload reference)

- `POST /v1/documents/{document_id}/versions`

The API may integrate with object storage using presigned URLs, but the authoritative record is the DB metadata + checksum.

#### Lock document (command)

- `POST /v1/documents/{document_id}/lock`

Locks editing and emits `DocumentLocked`.

#### Sign document (command)

- `POST /v1/documents/{document_id}/signatures`

Creates signature evidence and emits `SignatureCompleted` (or equivalent).

Visibility rules MUST ensure signatures do not leak restricted info to unauthorized roles.

### 6.4 Inspections

#### Create inspection assignment (command)

- `POST /v1/transactions/{transaction_id}/inspections`

#### Submit inspection findings/report (command)

- `POST /v1/inspections/{inspection_id}/submit`

This MUST:

- store findings (structured)
- create/attach inspection report document (CONFIDENTIAL_ROLE)
- emit `InspectionReportSubmitted`
- preserve explicit deny to lenders

### 6.5 Appraisals

- `POST /v1/transactions/{transaction_id}/appraisals`
- `POST /v1/appraisals/{appraisal_id}/submit`

### 6.6 Events (read-only)

#### List transaction events

- `GET /v1/transactions/{transaction_id}/events?since=...`

This endpoint MUST be carefully filtered; event payloads must not create a side channel around RLS.

### 6.7 AI advisory APIs (bounded)

#### List AI insights for a transaction

- `GET /v1/transactions/{transaction_id}/ai/insights`

Only returns insights whose visibility_scope allows the caller.

#### Approve AI insight (if policy requires human approval)

- `POST /v1/ai/insights/{insight_id}/approve`

Approval actions MUST be audited and emit an `AI_InsightApproved` event for downstream notification.

### 6.8 Properties and listings

#### List properties (search)

- `POST /v1/properties/search`

Request:

```json
{
  "location": {
    "city": "San Francisco",
    "state": "CA",
    "radius_miles": 10
  },
  "filters": {
    "price_min": 500000,
    "price_max": 1500000,
    "bedrooms_min": 3,
    "property_types": ["SINGLE_FAMILY", "TOWNHOUSE"]
  },
  "sort": { "field": "list_price", "direction": "asc" },
  "pagination": { "cursor": "...", "limit": 20 }
}
```

Returns `PropertySearchResults` with matching listings.

#### Get property details

- `GET /v1/properties/{property_id}`

Returns `PropertyDetails` including images, listing info, and location.

#### Create property (agents)

- `POST /v1/properties`

Creates a new property record. MUST be associated with an organization.

#### Update property

- `PATCH /v1/properties/{property_id}`

Updates property attributes. Emits `PropertyUpdated` event.

#### Property images

- `POST /v1/properties/{property_id}/images/upload` — Get presigned upload URL
- `GET /v1/properties/{property_id}/images` — List images with variants
- `DELETE /v1/properties/{property_id}/images/{image_id}` — Remove image
- `PATCH /v1/properties/{property_id}/images/{image_id}` — Update caption, order, primary

#### Search by image similarity

- `POST /v1/properties/search/by-image`

Upload an image to find visually similar properties using embedding similarity.

### 6.9 Listings

#### Create listing

- `POST /v1/listings`

Creates a listing for a property. Triggers embedding generation.

#### Update listing

- `PATCH /v1/listings/{listing_id}`

Updates listing details (price, description, status).

#### Get listing

- `GET /v1/listings/{listing_id}`

Returns `ListingDetails` with property and image data.

#### List active listings

- `GET /v1/listings?status=ACTIVE&cursor=...&limit=...`

Public endpoint for browsing active listings.

### 6.10 Chat and messaging

#### Chat rooms

- `POST /v1/chat/rooms` — Create direct or group chat
- `GET /v1/chat/rooms` — List user's chat rooms
- `GET /v1/chat/rooms/{room_id}` — Get room details and members
- `PATCH /v1/chat/rooms/{room_id}` — Update room (name, archive)
- `POST /v1/chat/rooms/{room_id}/members` — Add members (group only)
- `DELETE /v1/chat/rooms/{room_id}/members/{user_id}` — Remove member

#### Messages

- `GET /v1/chat/rooms/{room_id}/messages?cursor=...&limit=...` — List messages (paginated)
- `POST /v1/chat/rooms/{room_id}/messages` — Send message (REST fallback)
- `PATCH /v1/chat/messages/{message_id}` — Edit message
- `DELETE /v1/chat/messages/{message_id}` — Soft delete message

#### Read status

- `POST /v1/chat/rooms/{room_id}/mark-read` — Mark messages as read

#### Attachments

- `POST /v1/chat/attachments/upload` — Get presigned upload URL
- `GET /v1/chat/rooms/{room_id}/attachments` — List room attachments

#### Transaction chat

- `GET /v1/transactions/{transaction_id}/chat` — Get or create transaction chat room

#### WebSocket (real-time)

- `WebSocket /ws/chat` — Real-time messaging

WebSocket events:

```
# Inbound
- message.send { room_id, content, message_type, reply_to? }
- message.edit { message_id, content }
- message.delete { message_id }
- typing.start { room_id }
- typing.stop { room_id }
- room.mark_read { room_id, message_id }

# Outbound
- message.new { message }
- message.updated { message }
- message.deleted { message_id, room_id }
- typing.indicator { room_id, user_id, is_typing }
- presence.changed { user_id, status }
```

### 6.11 Buyer preferences and matching

#### Preferences

- `GET /v1/users/me/preferences` — List user's saved preferences
- `POST /v1/users/me/preferences` — Create preference
- `GET /v1/users/me/preferences/{preference_id}` — Get preference details
- `PATCH /v1/users/me/preferences/{preference_id}` — Update preference
- `DELETE /v1/users/me/preferences/{preference_id}` — Deactivate preference

#### Recommendations

- `GET /v1/users/me/recommendations?preference_id=...&min_score=0.7&limit=20`

Returns matched listings with scores and explanations:

```json
{
  "recommendations": [
    {
      "listing": { ... },
      "property": { ... },
      "match_score": 0.92,
      "match_explanation": "This 4-bed home matches your preference for...",
      "score_breakdown": {
        "price": 0.95,
        "features": 0.88,
        "semantic": 0.91,
        "location": 0.94
      }
    }
  ]
}
```

#### Feedback

- `POST /v1/users/me/recommendations/{match_id}/feedback`

Record user feedback (LIKED, DISLIKED, SAVED, CONTACTED) for matching improvement.

#### Agent view (interested buyers)

- `GET /v1/listings/{listing_id}/interested-buyers`

For listing agents: shows buyers whose preferences match this listing.

---

### 6.12 Offers and negotiation (authoritative)

The journey’s negotiation loop MUST be modeled as authoritative facts (see `04-domain-model.md`, `17-journey-mapping-and-milestones.md`).

Commands MUST:

- write offer/decision facts in PostgreSQL
- emit domain events as evidence
- optionally call the macro-state transition command when the offer changes legal state

Suggested endpoints:

- `POST /v1/transactions/{transaction_id}/offers` — submit offer (creates Offer; MAY attach evidence doc)
- `POST /v1/offers/{offer_id}/counter` — create counteroffer
- `POST /v1/offers/{offer_id}/withdraw` — withdraw offer (requires reason where mandated)
- `POST /v1/offers/{offer_id}/reject` — reject offer (requires reason)
- `POST /v1/offers/{offer_id}/accept` — accept offer (creates acceptance evidence; typically triggers macro transition `OFFER_MADE → UNDER_CONTRACT`)

Important:

- Acceptance MUST NOT be implemented as “just set transaction state”; it is a command that creates evidence + calls the DB transition function.

### 6.13 Showings and viewings (authoritative scheduling)

Suggested endpoints:

- `POST /v1/listings/{listing_id}/showings` — schedule showing
- `GET /v1/listings/{listing_id}/showings` — list showings (policy-filtered)
- `PATCH /v1/showings/{showing_id}` — reschedule/cancel/mark completed

Showings are not macro-states; they are authoritative facts that drive notifications and audit.

### 6.14 Escrow and funding (regulated commands)

Escrow/funding milestones gate legality and MUST be modeled as authoritative facts (see `04-domain-model.md`, `08-database-schema-and-governance.md`).

Suggested endpoints:

- `POST /v1/transactions/{transaction_id}/escrow/assignments` — assign escrow officer (audited)
- `POST /v1/transactions/{transaction_id}/escrow/earnest-money/confirm` — confirm deposit received (REGULATED)
- `POST /v1/transactions/{transaction_id}/escrow/funding/confirm` — confirm cleared funds (REGULATED)
- `POST /v1/transactions/{transaction_id}/escrow/disbursements` — record/authorize disbursement (REGULATED)

All such commands MUST:

- be audited (`audit_events`)
- emit reference-first domain events
- enforce RLS + classification boundaries (explicit denies where required)

### 6.15 Title, recording, and ownership transfer (regulated milestones)

The journey requires title work and deed recording as enforceable milestone facts.

Suggested endpoints:

- `POST /v1/transactions/{transaction_id}/title/orders` — place title order
- `POST /v1/transactions/{transaction_id}/title/commitments` — record receipt of title commitment (links to evidence document)
- `POST /v1/transactions/{transaction_id}/title/clear` — mark title cleared (audited)
- `POST /v1/transactions/{transaction_id}/closing/deed-recorded` — record deed recording confirmation (REGULATED)
- `POST /v1/transactions/{transaction_id}/closing/ownership-transfer` — record ownership transfer confirmation (REGULATED)

### 6.16 Closing milestones and the meaning of CLOSED (binding)

To match the journey diagram:

- `CLOSED` means: **deed recorded** and **ownership transfer confirmed** (and disbursement recorded where applicable).
- “Sign documents” is a milestone inside `CLEAR_TO_CLOSE`, not sufficient for `CLOSED`.

Therefore, `POST /v1/transactions/{transaction_id}/transitions` to `CLOSED` MUST fail unless required milestone facts exist (enforced in the DB transition path).

### 6.17 Post-closing access and exports (compliance)

Suggested endpoints:

- `GET /v1/transactions/{transaction_id}/timeline` — shaped timeline (state history + redacted evidence)
- `GET /v1/transactions/{transaction_id}/exports/evidence` — compliance export (WORM; legal-hold aware)

Exports MUST:

- be reproducible (same inputs → same outputs)
- include integrity metadata (hashes/checksums)
- respect RLS/classification and legal holds

---

## 7. Database view definitions (implementation guidance)

Views SHOULD:

- avoid embedding sensitive fields unless classification allows
- avoid including raw event payloads; use stable references and redacted summaries
- be designed for least-privilege reads (role-appropriate shapes)

Materialized views MAY be used for analytics but must respect environment isolation and data classification.

---

## 8. Acceptance criteria

This API/view layer is correct if:

- all reads are constrained by RLS and classification and cannot leak via “view payloads”
- all authoritative writes are command endpoints and go through DB enforcement paths
- illegal transitions cannot be performed even with valid auth tokens
- the API surface supports replay and audit workflows without special admin hacks

