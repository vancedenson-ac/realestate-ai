---
name: realtrust-ai
description: Backend-first escrow-safe transaction infrastructure for realtrust ai. Use when implementing or modifying backend services, database schema, APIs, authorization (RLS/ABAC), transaction state machine, events/outbox, AI governance, testing, or infrastructure. Covers FastAPI, PostgreSQL (pgvector, PostGIS), Kafka, Redis, SOC 2/FINRA compliance, and the canonical "law, evidence, advice" separation. Load when working on real-trust-v1 backend, domain model, or spec-derived code.
---

# realtrust ai — Application Skill

Implement and evolve the realtrust ai backend according to the canonical specification set. All normative language (MUST/SHOULD/MAY) and invariants in the spec are binding.

## Loading order (when implementing or answering questions)

Load references in this order:

1. **references/03-architecture-backend.md** — system shape, FastAPI structure, DB as system of record
2. **references/05-transaction-state-machine-spec.md** — legality ("law"); states, transitions, preconditions
3. **references/17-journey-mapping-and-milestones.md** — image → macro-states → milestone facts; transition gating; CLOSED meaning
4. **references/06-authorization-and-data-access.md** — who can see/do what; RLS, permission equation
5. **references/07-events-and-outbox.md** — events as evidence, outbox, Kafka
6. **references/08-database-schema-and-governance.md** — schema, invariants, RLS, migrations
7. **references/09-views-and-apis.md** — API/view contracts
8. **references/11-testing-and-proof-suite.md** — negative tests, proof standard
9. **references/16-infrastructure-and-deployment.md** — Docker, AWS, multi-region

For domain and vocabulary: **references/04-domain-model.md**, **references/13-glossary-and-normative-language.md**.

For LLM/rule constraints: **references/15-llm-rules-and-system-contract.md**.

For checklists: **references/14-implementation-checklists.md**.

## Non-negotiables (spine)

- PostgreSQL is the system of record; the transaction state machine defines legality.
- State changes are commands; one legal mutation path per domain; DB is final authority.
- Events are evidence of committed facts; no event without commit; outbox for publishing.
- AI is advisory only; no AI writes to authoritative tables or bypass of access control.
- Authorization is enforced at DB (RLS); explicit denies win (e.g. lender → inspection).
- Illegal end states are unrepresentable; verified by negative tests.

## Workflow

- **Adding/changing state or transitions**: Update `05-transaction-state-machine-spec.md` (or the copy in references), then regenerate seeds, DB transition function, and negative tests.
- **Adding/changing journey milestones**: Update `17-journey-mapping-and-milestones.md` (mapping + gating matrix), then update `05-transaction-state-machine-spec.md` preconditions/invariants, `08-database-schema-and-governance.md` authoritative tables + RLS, `09-views-and-apis.md` command/view surfaces, and `11-testing-and-proof-suite.md` negative tests.
- **Adding/changing authorization**: Update `06-authorization-and-data-access.md` and RLS policies; add RLS negative tests.
- **Adding/changing schema**: Follow `08-database-schema-and-governance.md`; use Alembic (or versioned SQL scripts for initial setup); keep authoritative vs derived separation.
- **Adding APIs**: Version under `/v1`; separate commands from queries; back reads with RLS-protected tables/views.

## Journey coverage (user journey image → backend “law” + milestone facts)

The user journey diagram contains:

- **Macro-states** (law): `PRE_LISTING → LISTED → OFFER_MADE → UNDER_CONTRACT → DUE_DILIGENCE → FINANCING → CLEAR_TO_CLOSE → CLOSED/CANCELLED`
- **Subflows / milestones** (facts): showings, offers/counteroffers, title, escrow funding/disbursement, deed recording, ownership transfer

Non-negotiable rule:

> If the UI shows a journey step that matters for legality, compliance, or separation-of-duties, it MUST exist as an authoritative milestone fact in PostgreSQL and (when gating) be enforced as a DB precondition/invariant.

Canonical mapping and gating matrix:

- See `references/17-journey-mapping-and-milestones.md`

## Canonical meaning of CLOSED (binding)

To match the journey diagram and audit expectations:

- **CLOSED** means: **deed recorded** and **ownership transfer confirmed** (and disbursement recorded where applicable).
- “Closing day signed” is a milestone fact inside `CLEAR_TO_CLOSE`, not sufficient for `CLOSED`.

## RBAC/ABAC and FINRA/SOC2 alignment (self-documenting compliance)

Authorization and compliance are **structural**: enforced in DB (RLS + transition rules), not only in API code. When adding or changing features, follow this so the system stays provable and audit-ready.

- **Permission equation (06):** Permission = Organization ∩ Role ∩ Relationship ∩ TransactionState ∩ DataClassification ∩ Jurisdiction. Enforce at DB via RLS; API sets session context only (deps.py `get_db_with_rls`).
- **Explicit denies win:** Document and inspection RLS MUST deny lender access to inspection reports (06 §3.1). No exception for convenience. See `18-authorization-audit-broker-client-lender.md` for checklist.
- **Role from session only:** State transitions and role-scoped commands use `current_setting('app.role')` (and `app.user_id`, `app.organization_id`). Never accept role or user_id in request body for authorization. Production: set context from verified token; dev: headers (X-Role, X-User-Id, X-Organization-Id); `REALTRUST_AUTH_STRICT=1` disables header fallback.
- **Audit evidence:** Regulated milestones (escrow assignment, EMD, funding, disbursement, deed recorded, ownership transfer, title commitment) MUST write to `audit_events` via `core/audit.py`. Append-only; no UPDATE/DELETE on audit rows (02-regulatory-and-compliance-spec).
- **Adding a new resource or action:** (1) Update `06-authorization-and-data-access.md` and `08-database-schema-and-governance.md` if classification or RLS changes; (2) Add or extend RLS policies in schema; (3) Add negative tests (11) proving denies and illegal transitions; (4) Re-run audit checklist in `18-authorization-audit-broker-client-lender.md`.

References: **02-regulatory-and-compliance-spec.md** (SOC 2/FINRA, evidence model), **06-authorization-and-data-access.md** (RLS, classification, explicit denies), **18-authorization-audit-broker-client-lender.md** (implementation status and gaps).

## Implementation map (backend)

The canonical codebase lives under **`backend/`**. Use this map to align spec with code.

| Spec concept | Implementation location |
|--------------|-------------------------|
| **Config** | `src/realtrust_api/config.py` (Pydantic Settings; API base `/realtrust-ai/v1`; optional S3/MinIO: `S3_ENDPOINT_URL`, `S3_PUBLIC_ENDPOINT_URL` for browser-accessible presigned URLs, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) |
| **Auth + RLS context** | `src/realtrust_api/api/deps.py` — `get_current_user_id`, `get_db_with_rls`; sets `app.user_id`, `app.organization_id`, `app.role`, `app.license_state`, and optionally `app.risk_clearance` (SET LOCAL). Dev stub: headers (`X-User-Id`, `X-Role`, `X-Organization-Id`, etc.); production MUST use verified token. `REALTRUST_AUTH_STRICT=1` disables header fallback. |
| **Core exceptions** | `src/realtrust_api/core/exceptions.py` (e.g. `illegal_transition_exception`, `not_found_exception`). Frontend expects structured error responses: `detail.error.code`, `detail.error.message`, or FastAPI `detail` as string/validation array; these are parsed for consistent toast messages. |
| **Audit evidence writer** | `src/realtrust_api/core/audit.py` — append-only `audit_events` evidence for regulated milestones; **`log_access_decision()`** for sensitive read decisions (02 §5, AUDIT §8.3): allow/deny, identity, resource, policy_reference. |
| **DB session** | `src/realtrust_api/db/session.py` (async session factory) |
| **Domain models + schemas** | `src/realtrust_api/domain/{transactions,documents,events,inspections,matching,properties,messaging,offers,showings,escrow,title}/` — `models.py` (SQLAlchemy), `schemas.py` (Pydantic). No `service.py`/`repository.py` per domain yet. |
| **State machine (law)** | `scripts/02-schema.sql` — `transaction_states`, `transaction_state_transitions`, `transition_transaction_state()`, `assert_transaction_invariants()`; `scripts/03-seed.sql` — states and transitions from `05-transaction-state-machine-spec.md`. |
| **Schema + seeds** | `scripts/02-schema.sql`, `scripts/03-seed.sql` (run before tests; Alembic is target for governed migrations). |
| **V1 API** | `src/realtrust_api/api/v1/router.py` — mounts: transactions, properties, listings, documents, inspections, appraisals, events, users/me, ai/insights, chat, offers, showings, escrow, title. |
| **Transition command** | `api/v1/endpoints/transactions.py` — `POST /transactions/{id}/transitions` calls DB `transition_transaction_state(transaction_id, to_state)`; **actor role MUST come from DB session** (`SET LOCAL app.role`), not request body. |
| **Document checklist (05/17)** | `api/v1/endpoints/transactions.py` — **GET** `/{id}/document-checklist` returns **list[ChecklistItem]** (DocumentChecklistItem | MilestoneChecklistItem). Per transition: **required_documents** → document items (document_type, required_for_to_state, present, signed); **milestone preconditions**: FINANCING → title_ordered, appraisal_or_waived; CLEAR_TO_CLOSE → title_cleared; CLOSED → funds_confirmed, disbursement_recorded, deed_recorded, ownership_transfer_confirmed. `_check_milestone_present(db, transaction_id, milestone_key)` queries escrow/title/appraisal tables. `domain/transactions/schemas.py`: DocumentChecklistItem (`kind: "document"`), MilestoneChecklistItem (`kind: "milestone"`, milestone_key, label, required_for_to_state, present). |
| **Transaction create (buyer make-offer)** | `api/v1/endpoints/transactions.py` — `create_transaction`: BUYER/BUYER_AGENT may only use `initial_state=LISTED` and must supply `listing_id`; `initial_party_role` must be BUYER or BUYER_AGENT; validation before `insert_transaction_with_party`. |
| **Escrow list endpoints** | `api/v1/endpoints/escrow.py` — GET `transactions/{tid}/escrow/assignments`, `.../escrow/earnest-money`, `.../escrow/funding`, `.../escrow/disbursements`; RLS via `get_db_with_rls`. |
| **Title list endpoints** | `api/v1/endpoints/title.py` — GET `transactions/{tid}/title/orders`, `.../title/commitments`, `.../closing/deed-recorded`, `.../closing/ownership-transfer`; RLS via `get_db_with_rls`. |
| **Inspections list** | `api/v1/endpoints/inspections.py` — GET `transactions/{tid}/inspections` lists inspections for transaction; RLS via `get_db_with_rls`. |
| **Storage (MinIO/S3)** | `src/realtrust_api/core/storage.py` — `get_presigned_put_url(key, content_type, expires_in)` (MinIO Python SDK for presigned PUT so signature matches browser); `get_presigned_get_url(bucket, key, expires_in)` for view/download URLs; `ensure_bucket_exists()` at startup. When S3 not configured returns stub PUT URL. Used by document upload-url and property image upload. **Property images**: upload flow uses presigned PUT; `update_property_image` (confirm upload) returns `view_url` (presigned GET). List responses: property images include `view_url` when upload complete; documents list/get include `view_url` for latest version. |
| **Properties — cover image** | `domain/properties/schemas.py`: `PropertyOverview` and `ListingOverview` include `cover_image_url: str | None` (presigned GET for primary image). Endpoints in `api/v1/endpoints/properties.py` and `listings.py` populate via helper `_cover_image_urls_for_properties`. PATCH `properties/{id}/images/{image_id}` can set `is_primary` (set as cover). |
| **Showings — feedback 403** | `api/v1/endpoints/showings.py`: `create_showing_feedback` catches RLS-related `ProgrammingError`/`IntegrityError` and raises 403 with `FORBIDDEN_BY_POLICY` (listing agent/broker only per RLS). |
| **Transactions list (RLS)** | `api/v1/endpoints/transactions.py`: `list_transactions` uses `get_db_with_rls` and queries `v_transaction_overviews_v1`; RLS on underlying tables restricts rows to those the session can see. **GET** `transactions/{id}` logs access decision (allow/deny) to `audit_events` via `log_access_decision`. No client filter needed for security. |
| **Listings — property location + PATCH + open house + map search** | `scripts/02-schema.sql`: view `v_listing_overviews_v1` JOINs `properties` to expose `address_line_1`, `address_line_2`, `city`, `state_province`, `postal_code`, `country`, `next_open_house_at`, **`latitude`**, and **`longitude`**. **Listings RLS** (`listings_visibility`): BUYER/BUYER_AGENT may see only `is_public = true` AND `status != 'DRAFT'`; other roles see public OR listing_agent OR listing_broker org (so they can see DRAFT for their listings). `domain/properties/schemas.py`: `ListingOverview` includes address fields + **`latitude`/`longitude`** (Decimal | None); `ListingUpdate` includes `next_open_house_at`; **`MapBounds`**, **`MapSearchFilters`**, **`MapSearchRequest`**, **`MapSearchResponse`** schemas for map-search endpoint. `api/v1/endpoints/listings.py`: create and update refetch from the view; **PATCH** accepts partial updates; **POST `/map-search`** — bounding-box search for map display: zoom >= 12 returns individual GeoJSON Features (listing_id, list_price, price_short, address, bedrooms, etc.) with **meta**: `total_in_bounds`, `clustered: false`, `zoom`; zoom < 12 returns server-side clusters via `ST_SnapToGrid` — each feature has `cluster` (true/false), `point_count`, `avg_price` (and min/max for multi-point); single-point clusters have `cluster: false` but **no listing_id** (frontend builds sidebar only from features with listing_id); **meta**: `total_in_bounds` (sum of counts), `clustered: true`, `zoom`; uses `get_db_with_rls` for RLS; optional filters (status, price_min/max, bedrooms_min, property_types); GIST index on `properties.location`. |
| **Documents — version list** | `api/v1/endpoints/documents.py`: **GET** `documents/{document_id}/versions` returns list of `DocumentVersionOverview` (version_id, document_id, storage_path, storage_bucket, checksum, created_at); RLS via `get_db_with_rls`. **GET** `documents/{id}` logs access decision (allow/deny) to `audit_events` via `log_access_decision`. |
| **Eligible escrow officers** | `api/v1/endpoints/users_me.py`: **GET** `/users/me/eligible-escrow-officers` returns list of org members with role ESCROW_OFFICER (user_id, full_name, email) for escrow assignment picker; RLS on `organization_members` restricts to current org. |
| **Champagne moments** | `api/v1/endpoints/users_me.py`: **GET** `/users/me/champagne-moments` returns list of **ChampagneMomentOverview** (event_id, event_type, emitted_at, transaction_id, property_address, amount, title, message). Query: `domain_events` JOIN `transaction_parties` (current user) JOIN transactions/listings/properties for address and amount; filter by event_type (e.g. TransactionClosed). RLS on domain_events restricts to transactions where user is a party. Spec: stakeholder-champagne-moments.md; 07 (event consumption). Tests: `test_users_me.py` (test_list_champagne_moments). |
| **Tests** | `tests/` — conftest (schema+seed, api_base, client, RLS client fixtures, `error_code()` for detail.error.code); **`test_regulated_and_access_logging.py`** (2.1 REGULATED: buyer/lender cannot insert funding/disbursement; escrow cannot insert when state not CLEAR_TO_CLOSE; seller gets empty regulated lists; 2.2 access logging: GET transaction/document/inspection writes AccessDecision allow/deny to audit_events); **`test_escrow.py`** (list assignments/earnest-money/funding/disbursements, assign then list, confirm EMD, **record disbursement** on CLEAR_TO_CLOSE tx with ESCROW_OFFICER); **`test_title.py`** (list orders/commitments/deed-recordings/ownership-transfers, **record deed / ownership transfer** on CLEAR_TO_CLOSE tx with ESCROW_OFFICER, appraisal waivers list/waive); **`test_inspections.py`** (list by transaction, **`test_lender_sees_empty_inspections_list`**); **`test_milestone_gating.py`** (DUE_DILIGENCE→FINANCING, FINANCING→CLEAR_TO_CLOSE, CLEAR_TO_CLOSE→CLOSED); **`test_users_me.py`** (incl. test_list_champagne_moments), **`test_listings.py`**, **`test_map_search.py`** (bounding-box search: GeoJSON response, bounds filter, out-of-bounds empty, status/price/bedrooms filters, RLS applied, limit, cluster at low zoom, individual at high zoom, listing overview lat/lng, validation), **`test_documents.py`**, **`test_offers.py`**, **`test_transactions.py`**, **`test_views_transactions.py`** (document_checklist_ok); **`test_correlation_and_audit.py`** (correlation ID, audit_events). **Seed**: `03-seed.sql` includes tx 007 (CLEAR_TO_CLOSE) for regulated write tests. |
| **Health** | `main.py` — GET `/health` (no API prefix); returns `{"status": "ok"}`. |
| **App entry** | `src/realtrust_api/main.py` — FastAPI app; mounts `api_router` at `settings.API_V1_PREFIX`; CORS from config; pre-imports domain models for transactions, properties, documents, inspections, events, matching, messaging (offers/showings/escrow/title loaded by their endpoints). |

**Not yet in repo (spec targets):** `core/security.py` (JWT validation — currently stubbed in deps); dedicated `workers/` (outbox, AI, document-processor, etc.); `events/` publisher; `websocket/` gateway; Alembic migrations. **User flow completion (done):** GET escrow/title/inspections by transaction and buyer create transaction (LISTED + listing_id) are implemented; **eligible escrow officers** (GET /users/me/eligible-escrow-officers), **listing next_open_house_at**, **document version list** (GET documents/{id}/versions) are implemented. **Plan/audit docs:** `docs/USER-FLOW-COMPLETION-PLAN.md` (remaining gaps), `docs/UI-AUDIT-AND-ENHANCEMENT-PLAN.md` (Phase A/B checklist; frontend aligns).

## Reference–code alignment

- **03-architecture-backend**: Canonical structure shows `core/config.py`; implementation has **config at package root** (`realtrust_api/config.py`). Auth lives in **api/deps.py**, not `core/security.py`. Domain folders have **models + schemas only** (no service/repository yet). Workers, websocket, events publisher are **targets**, not yet present.
- **09-views-and-apis**: API is versioned under a **configurable base** (e.g. `/realtrust-ai/v1`). **Parties** are managed transaction-scoped (e.g. create transaction with initial party); **recommendations** are under **`/v1/users/me/recommendations`** and preferences under **`/v1/users/me/preferences`**.
- **05 + 17 (journey mapping)**: Macro-states cover the journey, but many journey boxes require **authoritative milestone facts** (offers/counteroffers, title, escrow funding/disbursement, deed recording, ownership transfer, showings). `CLOSED` is defined as deed recorded + ownership transfer confirmed.
- **11-testing**: **Implemented**: core transaction tests + journey milestone gating tests + offers/showings/views smoke tests; **Phase 4.4 negative tests**: accept offer without signed PA (412), wrong-role transition (400), lender sees empty inspections list (RLS). **Required next**: generated illegal (from_state, to_state) matrix, event-consistency tests (no event on failed transition), audit evidence assertions for regulated milestones.
- **08-schema**: Schema is applied via **SQL scripts** (02-schema.sql, 03-seed.sql); **Alembic** is the required path for governed production migrations.

## New features (user flow completion)

The following features were added to support the full user journey; document them when changing behavior or adding tests.

| Feature | Rule / reference | Implementation |
|--------|------------------|-----------------|
| **Buyer create transaction (make-offer)** | 09-views-and-apis: BUYER/BUYER_AGENT create with LISTED + listing_id only. Role from session (06). | `transactions.py`: validate `initial_state==LISTED`, `listing_id` required, `initial_party_role` in (BUYER, BUYER_AGENT) when role is BUYER or BUYER_AGENT. |
| **Escrow list by transaction** | 09-views-and-apis: list assignments, EMD, funding, disbursements. RLS on underlying tables (06, 08). | `escrow.py`: GET `transactions/{tid}/escrow/assignments`, `.../earnest-money`, `.../funding`, `.../disbursements`; `get_db_with_rls`. |
| **Title list by transaction** | 09-views-and-apis: list orders, commitments, deed recordings, ownership transfers. RLS (06, 08). | `title.py`: GET `transactions/{tid}/title/orders`, `.../title/commitments`, `.../closing/deed-recorded`, `.../closing/ownership-transfer`; `get_db_with_rls`. |
| **Inspections list by transaction** | 09-views-and-apis: list inspections for a transaction. RLS (06); lender explicit deny for inspection reports (06 §3.1). | `inspections.py`: GET `transactions/{tid}/inspections`; `get_db_with_rls`. |
| **Milestone gating test (DUE_DILIGENCE→FINANCING)** | 05 (transition allowed_roles BUYER_AGENT), 11 (negative tests). | Seed: tx 005 has BUYER_AGENT (Bailey) in `03-seed.sql`. Test: `test_milestone_gating.py` uses TX_005_DUE_DILIGENCE + RLS_HEADERS_BAILEY_AGENT; no API create/add-party. |
| **Eligible escrow officers API** | 09-views-and-apis: escrow assignment picker. RLS on `organization_members` (06). | `users_me.py`: GET `/users/me/eligible-escrow-officers`; queries `organization_members` JOIN `users` WHERE role = 'ESCROW_OFFICER'; seed in `03-seed.sql` populates org members. Tests: `test_users_me.py` (test_list_eligible_escrow_officers, test_list_eligible_escrow_officers_org_scope). |
| **Listing next_open_house_at** | UI audit Phase B: open house date on listing. | `02-schema.sql`: `listings.next_open_house_at` (ALTER idempotent); `v_listing_overviews_v1` includes it; `domain/properties`: model + ListingOverview/ListingUpdate; PATCH listings accepts it. Test: `test_listings.py` (test_patch_listing_next_open_house_at). |
| **Document version list** | UI audit Phase B: version history for documents. | `documents.py`: GET `documents/{document_id}/versions` returns list of DocumentVersionOverview; RLS via `get_db_with_rls`. Tests: `test_documents.py` (test_list_document_versions, test_list_document_versions_not_found). |
| **Document checklist alignment (05/17)** | UI-AUDIT Phase D.2: checklist = required_documents + milestone preconditions. | `transactions.py`: GET `/{id}/document-checklist` returns list of DocumentChecklistItem (kind "document") and MilestoneChecklistItem (kind "milestone") per outgoing transitions; milestones for FINANCING (title_ordered, appraisal_or_waived), CLEAR_TO_CLOSE (title_cleared), CLOSED (funds_confirmed, disbursement_recorded, deed_recorded, ownership_transfer_confirmed). Schemas: `domain/transactions/schemas.py`. Tests: `test_views_transactions.py` (test_document_checklist_ok asserts item shape). |
| **REGULATED table restrictions (2.1, 18 §6)** | 06 §3, COMPLETION-PLAN 2.1: funding_confirmations, disbursements, deed_recordings, ownership_transfers restricted to ESCROW_OFFICER (LENDER read for funding); state-gated INSERT (CLEAR_TO_CLOSE/CLOSED). | `02-schema.sql`: RLS policies on the four tables (role + state check). `escrow.py` / `title.py`: catch RLS ProgrammingError/IntegrityError on funding confirm, disbursement, deed, ownership-transfer and raise 403 FORBIDDEN_BY_POLICY. Tests: `test_regulated_and_access_logging.py`, `test_escrow.py`, `test_title.py` (regulated writes use tx 007 CLEAR_TO_CLOSE + ESCROW_OFFICER). |
| **Access decision logging (2.2, 02 §5, AUDIT §8.3)** | Sensitive read decisions (document get, inspection get, transaction get) logged with allow/deny, identity, resource, policy_reference. | `core/audit.py`: `log_access_decision()`. `documents.py` GET document, `inspections.py` GET inspection, `transactions.py` GET transaction: call `log_access_decision` with outcome allow/deny; commit before raising 404 so audit row persists. Tests: `test_regulated_and_access_logging.py` (AccessDecision in audit_events). |
| **Champagne moments API** | 07 (event consumption); stakeholder-champagne-moments.md. | `users_me.py`: GET `/users/me/champagne-moments`; queries domain_events for current user (via transaction_parties), event_type e.g. TransactionClosed; enriches with property address and amount (offer_price/list_price); returns ChampagneMomentOverview list. RLS on domain_events. Tests: `test_users_me.py` (test_list_champagne_moments). |
| **Listings RLS (visibility + status)** | 06, 08: BUYER/BUYER_AGENT cannot see DRAFT listings; other roles can see DRAFT for their agent/broker listings. | `02-schema.sql`: policy `listings_visibility` — buyer/buyer_agent: `is_public = true` AND `status != 'DRAFT'`; others: public OR listing_agent_id = user OR listing_broker_id = org. GET list and POST map-search both use `get_db_with_rls`; no API change needed. Frontend aligns UX (status dropdown, canSeeDraftListings). |
| **Map search (listings)** | Spatial property discovery for map UI. PostGIS bounding-box + GIST index; server-side clustering at low zoom. | `listings.py`: POST `/map-search` (MapSearchRequest → MapSearchResponse GeoJSON FeatureCollection). **Response**: zoom >= 12 — individual Features with listing_id, list_price, price_short, address, bedrooms, etc.; **meta**: total_in_bounds, clustered: false, zoom. Zoom < 12 — ST_SnapToGrid clusters: multi-point (cluster: true, point_count, avg_price, min_price, max_price, price_short); single-point (cluster: false, point_count: 1, avg_price, price_short; **no listing_id** — frontend uses listing_id to build sidebar list only from zoomed-in data). **meta**: total_in_bounds (sum of point_count), clustered: true, zoom. `get_db_with_rls` for RLS; optional filters (status, price range, bedrooms_min, property_types); `_format_price_short`, `_grid_size_for_zoom`. Schemas: MapBounds, MapSearchFilters, MapSearchRequest, MapSearchResponse. `v_listing_overviews_v1` includes latitude/longitude. Seed: 10 properties + 10 listings (Austin, TX metro). Tests: `test_map_search.py` (GeoJSON, bounds, RLS, cluster at low zoom, individual at high zoom, etc.). |

**Rules:** (1) List endpoints MUST use `get_db_with_rls` so RLS applies. (2) Buyer create transaction MUST NOT allow PRE_LISTING or other initial_state for BUYER/BUYER_AGENT. (3) Milestone gating tests MUST use seeded transactions where adding parties via API would hit RLS (e.g. transaction_parties).

## References (in this skill)

| Document | Purpose |
|----------|---------|
| references/00-README.md | Spec overview, tech stack, document map |
| references/01-product-and-stakeholder-brief.md | Product scope, risk posture |
| references/02-regulatory-and-compliance-spec.md | SOC 2, FINRA |
| references/03-architecture-backend.md | Components, FastAPI structure |
| references/04-domain-model.md | Aggregates, entities, messaging, matching |
| references/05-transaction-state-machine-spec.md | States, transitions, preconditions |
| references/06-authorization-and-data-access.md | Permission equation, RLS, classification |
| references/07-events-and-outbox.md | Domain events, outbox, Kafka |
| references/08-database-schema-and-governance.md | Schema, invariants, migrations |
| references/09-views-and-apis.md | Read models, API contracts |
| references/10-ai-boundaries-and-governance.md | AI service, RAG, provenance |
| references/11-testing-and-proof-suite.md | Negative tests, proof standard |
| references/12-operability-and-sre.md | Observability, SRE |
| references/13-glossary-and-normative-language.md | Terms, normative language |
| references/14-implementation-checklists.md | Backend, DB, API, AI, compliance |
| references/15-llm-rules-and-system-contract.md | Machine-ingestible MUST/MUST NOT |
| references/16-infrastructure-and-deployment.md | Docker, AWS, multi-region |
| references/17-journey-mapping-and-milestones.md | Image → macro-states → authoritative milestone facts; transition gating; CLOSED meaning |
| references/18-authorization-audit-broker-client-lender.md | Authorization audit: broker/client/lender rules vs spec; RLS/transition status checklist |
| references/REFERENCE-BLOCKS.md | Index of @-mention blocks and which ref to load by topic/task |

## Backend layout (backend)

- **Package**: `pyproject.toml` — uv, Python ≥3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg, pydantic-settings, pgvector, geoalchemy2, boto3 (MinIO/S3 presigned URLs); dev: pytest, pytest-asyncio, httpx, psycopg2-binary. Entrypoint: `src/realtrust_api/main.py`. **Storage**: `core/storage.py` for presigned PUT URLs (documents, property images); stub when S3 env not set.
- **Scripts**: `scripts/01-roles.sql` (roles/grants), `scripts/init-extensions.sql` (uuid-ossp, pgcrypto, vector, postgis), `scripts/02-schema.sql` (tables, RLS, views, `transition_transaction_state`, `insert_transaction_with_party`, `assert_transaction_invariants`), `scripts/03-seed.sql` (states, transitions, seed data). Run order: roles → schema → seed (conftest or `seed.bat` / init-db).
- **Docker**: `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.db`; DB init uses scripts above.
- **Domain modules**: Each under `src/realtrust_api/domain/{name}/` has `models.py` (SQLAlchemy), `schemas.py` (Pydantic); `domain/shared/base.py` is the declarative Base. No per-domain `service.py`/`repository.py` yet.

## Schema tables (02-schema.sql)

Authoritative and supporting tables (all in `scripts/02-schema.sql`): **Identity** — `users`, `organizations`, `subject_attributes`, **`organization_members`** (organization_id, user_id, role; for eligible escrow officers per org). **Listings** — `listings` includes **`next_open_house_at`** (TIMESTAMPTZ, optional). **State machine** — `transaction_states`, `transaction_state_transitions`. **Transactions** — `transactions`, `transaction_parties`, `transaction_state_history`. **Commands/events** — `command_dedup`, `domain_events`, `event_outbox`. **Documents** — `documents`, `document_versions`, `document_signatures`, `document_text`, `document_chunks` (document_type includes `pre_qualification_letter`; no dedicated pre-qual table). **Regulated** — `inspections`, `inspection_findings`, `appraisals`, `appraisal_waivers`. **Journey milestones** — `offers`, `offer_decisions`; `escrow_assignments`, `earnest_money_deposits`, `funding_confirmations`, `disbursements`; `title_orders`, `title_commitments`, `deed_recordings`, `ownership_transfers`. **Properties** — `properties`, `listings`, `property_images`. **Showings** — `showings` (with `showing_type`: PRIVATE, OPEN_HOUSE); **showing_feedback** (listing_id, showing_id, from_user_id, rating, notes). **Audit/compliance** — `audit_events`, `compliance_records`, `supervision_cases`. **AI** — `ai_embeddings`. **Messaging** — `messaging.chat_rooms`, `messaging.chat_room_members`, `messaging.messages`, `messaging.chat_attachments`. **Matching** — `buyer_preferences`, `property_matches`, `saved_listings` (user bookmarks). Key view: `v_transaction_overviews_v1`. Key functions: `insert_transaction_with_party`, `transition_transaction_state`, `assert_transaction_invariants`.

## API surface (v1)

Base path: `API_V1_PREFIX` (default `/realtrust-ai/v1`). All reads RLS-filtered; commands call DB or validated writes.

**Path rule for clients:** Routers with a prefix (e.g. `prefix="/transactions"`) expose paths under that segment. Routers with **no prefix** (documents, inspections, appraisals, events, offers, showings, escrow, title) expose paths **as written** (e.g. `transactions/{id}/offers`, `listings/{id}/showings`). Clients MUST NOT prepend the domain name (e.g. use `transactions/{id}/offers`, not `offers/transactions/{id}/offers`). See `references/09-views-and-apis.md` and frontend `references/20-api-contract-frontend.md`.

| Router prefix | Endpoints (key routes) |
|---------------|------------------------|
| `/transactions` | GET/POST list/create; GET/POST `/{id}`, `/{id}/transitions`, `/{id}/parties`, **`/{id}/document-checklist`** (returns list of **ChecklistItem**: documents + milestones per 05/17), `/{id}/timeline`, `/{id}/ai/insights`, `/{id}/chat` |
| `/properties` | GET/POST list/create; GET/PATCH `/{id}`; POST `search`, `/{id}/images/upload`, GET/PATCH/DELETE `/{id}/images/{image_id}`; POST `search/by-image` |
| `/listings` | GET/POST list/create; GET/PATCH `/{id}`; GET `/{id}/interested-buyers`; **POST `/map-search`** (bounding-box GeoJSON: bounds, zoom, filters → FeatureCollection; zoom >= 12 individual features with listing_id/price_short/address; zoom < 12 server-side clusters via ST_SnapToGrid; RLS via `get_db_with_rls`) |
| (none) | Documents: GET/POST `transactions/{tid}/documents`; GET `documents/{id}`; **GET** `documents/{id}/versions` (list versions); POST `documents/{id}/upload-url`, `documents/{id}/versions`, `documents/{id}/lock`, `documents/{id}/signatures` |
| (none) | Inspections: POST `transactions/{tid}/inspections`; GET `inspections/{id}`; POST `inspections/{id}/submit` |
| (none) | Appraisals: POST `transactions/{tid}/appraisals` (restricted to LENDER or ESCROW_OFFICER in API + RLS); GET `appraisals/{id}`; POST `appraisals/{id}/submit` |
| (none) | Events: GET `transactions/{tid}/events` |
| `/users/me` | GET/POST/PATCH/DELETE `preferences`, `preferences/{id}`; GET `recommendations`; POST `recommendations/{match_id}/feedback`; GET `saved-listings`, POST `saved-listings` (body: `listing_id`), DELETE `saved-listings/{listing_id}`; **GET** `eligible-escrow-officers` (org members with role ESCROW_OFFICER for picker); **GET** `champagne-moments` (champagne moment events for current user; RLS; enriched with property address/amount for in-app toast). |
| `/ai/insights` | POST `/{insight_id}/approve` (stub) |
| `/chat` | POST/GET `rooms`; GET/PATCH `rooms/{id}`; POST/DELETE `rooms/{id}/members`, `rooms/{id}/members/{user_id}`; GET/POST `rooms/{id}/messages`; PATCH/DELETE `messages/{id}`; POST `rooms/{id}/mark-read`; POST `attachments/upload`; GET `rooms/{id}/attachments` |
| (none) | Offers: GET/POST `transactions/{tid}/offers`; POST `offers/{id}/counter`, `offers/{id}/withdraw`, `offers/{id}/reject`, `offers/{id}/accept` |
| (none) | Showings: GET/POST `listings/{lid}/showings` (body may include `showing_type`: PRIVATE, OPEN_HOUSE); PATCH `showings/{id}`; GET/POST `showings/{id}/feedback` (listing feedback: rating, notes) |
| (none) | Escrow: **GET** `transactions/{tid}/escrow/assignments`, `.../escrow/earnest-money`, `.../escrow/funding`, `.../escrow/disbursements` (list); POST `transactions/{tid}/escrow/assignments`, `.../escrow/earnest-money/confirm`, `.../escrow/funding/confirm`, `.../escrow/disbursements` |
| (none) | Title: **GET** `transactions/{tid}/title/orders`, `.../title/commitments`, `.../closing/deed-recorded`, `.../closing/ownership-transfer` (list); POST `transactions/{tid}/title/orders`; PATCH `title/orders/{id}`; POST `transactions/{tid}/title/commitments`; POST `transactions/{tid}/closing/deed-recorded`, `.../closing/ownership-transfer`; POST `transactions/{tid}/appraisals/waive` |
| (none) | Inspections: **GET** `transactions/{tid}/inspections` (list by transaction); POST `transactions/{tid}/inspections`; GET `inspections/{id}`; POST `inspections/{id}/submit` |

**Enhancements (implemented):** (1) **Pre-qualification** — use documents with `document_type` `pre_qualification_letter`; no dedicated table. (2) **Showings** — `showing_type` (PRIVATE, OPEN_HOUSE) on `showings`; **showing_feedback** and GET/POST `showings/{id}/feedback`; create feedback returns 403 FORBIDDEN_BY_POLICY when RLS denies (e.g. non–listing-agent). (3) **Appraisals** — POST create restricted to LENDER or ESCROW_OFFICER in API and RLS (`appraisals_insert_policy`). (4) **Property images** — `update_property_image` returns `view_url` (presigned GET); **cover image** — `PropertyOverview`/`ListingOverview` have `cover_image_url`; PATCH image `is_primary` for set-cover. (5) **Transaction list** — RLS-safe via `get_db_with_rls` and `v_transaction_overviews_v1`. (6) **Listings — property location + edit** — `v_listing_overviews_v1` JOINs `properties`; `ListingOverview` includes address fields; create/update refetch from view; **PATCH** supports partial updates: `list_price`, `description`, `status`, `is_public` (publish/unpublish); tests include `test_patch_listing_description_only` (description-only update leaves list_price unchanged). Init-db runs `01-roles.sql` then `02-schema.sql` so `app_user` exists before grants. (7) **Transaction create — buyer make-offer flow** — BUYER/BUYER_AGENT may create a transaction only with `initial_state=LISTED` and must supply `listing_id`; `initial_party_role` must be BUYER or BUYER_AGENT; enforced in `api/v1/endpoints/transactions.py` before DB insert. (8) **Escrow / Title / Inspections list APIs** — GET list endpoints for escrow assignments, earnest money, funding, disbursements; title orders, commitments, deed recordings, ownership transfers; inspections by transaction; all RLS-filtered via `get_db_with_rls`. (9) **Milestone gating test data** — Seeded transaction 005 (DUE_DILIGENCE) includes BUYER_AGENT (Bailey, `b0000001-0000-0000-0000-000000000006`) in `transaction_parties` so `test_due_diligence_to_financing_requires_title_and_appraisal` can use seeded data without adding parties via API (avoids RLS on `transaction_parties`). (10) **Map search (listings)** — POST `/listings/map-search` returns GeoJSON FeatureCollection for map display; `v_listing_overviews_v1` extended with `latitude`/`longitude`; `ListingOverview` includes lat/lng; `MapBounds`, `MapSearchFilters`, `MapSearchRequest`, `MapSearchResponse` schemas; zoom >= 12 individual features, zoom < 12 server-side ST_SnapToGrid clusters; optional price/bedrooms/status/property_type filters; GIST index on `properties.location` for O(log n) queries; `_format_price_short` for marker pills. Seed: 10 properties + 10 listings across Austin, TX metro for meaningful map demo. Tests: `test_map_search.py`.

Project Cursor rules in `.cursor/rules/` (when present) and `.cursor/skills/realtrust-backend/AGENTS.md` align with this skill; prefer them for always-on and file-scoped guidance. If `.cursor/rules/` is absent, rely on this skill and skill `AGENTS.md` for invariants and workflow.

## Reference blocks (for @-mention)

When you need to pull in spec or implementation context quickly, @-mention:

| @-mention | Use when |
|------------|----------|
| **@.cursor/skills/realtrust-backend/SKILL.md** | Full skill: loading order, non-negotiables, workflow, implementation map, reference–code alignment |
| **@.cursor/skills/realtrust-backend/references/REFERENCE-BLOCKS.md** | Index of reference blocks and which ref to load for state machine, auth, events, APIs, testing |
| **@.cursor/skills/realtrust-backend/references/05-transaction-state-machine-spec.md** | Changing or validating states/transitions; generating seeds or tests |
| **@.cursor/skills/realtrust-backend/references/06-authorization-and-data-access.md** | RLS policies, session context, explicit denies, permission equation |
| **@.cursor/skills/realtrust-backend/references/15-llm-rules-and-system-contract.md** | MUST/MUST NOT constraints; machine-ingestible rules |
| **@.cursor/skills/realtrust-backend/references/18-authorization-audit-broker-client-lender.md** | Authorization audit: broker/client/lender rules vs implementation status |
| **@backend** | Implementation: source, scripts, tests (triggers realtrust-implementation rule when editing under backend) |
| **SKILL § New features (user flow completion)** | Buyer create transaction, escrow/title/inspections list APIs, milestone gating test data and rules |