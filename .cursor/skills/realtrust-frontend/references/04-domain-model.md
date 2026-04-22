# realtrust ai — Canonical Domain Model (Backend-Only)

This document defines the canonical domain model for **realtrust ai**.

It focuses on the entities required to implement:

- backend services
- database schema
- exposed views
- API resources

It is consistent with the principles and constraints in:

- `05-transaction-state-machine-spec.md` (legality)
- `06-authorization-and-data-access.md` (visibility)
- `07-events-and-outbox.md` (evidence)
- `08-database-schema-and-governance.md` (system-of-record)

---

## 1. Modeling principles

### 1.1 Authoritative vs advisory separation

- Authoritative entities represent legally meaningful facts.
- Advisory entities represent derived insights and recommendations.

Advisory entities MUST NOT be allowed to mutate authoritative state directly.

### 1.2 Temporal versioning over overwrites

Mutable facts SHOULD be modeled as versioned rows (valid_from/valid_to) rather than in-place updates, especially for regulated facts and documents.

### 1.3 Transaction-contextual roles

Roles are not global permissions. A user's effective role MUST be derived in the context of a specific transaction relationship.

### 1.4 Organization/tenant isolation (MUST)

The platform is treated as **multi-tenant SaaS** by default.

Therefore:

- org-scoped entities MUST include `organization_id` (or be provably scoped to an org through relationships)
- PostgreSQL RLS MUST enforce `organization_id = current_setting('app.organization_id', true)::uuid` for org-scoped tables
- PUBLIC entities (e.g., public listings) may be excluded from org scoping only when explicitly intended

---

## 2. Core aggregates and relationships

### 2.1 User and organization

**User**

- stable identity reference for a human actor
- includes verification and compliance attributes (licensure, jurisdiction eligibility)

**Organization**

- brokerage, escrow company, lender organization, inspection firm, etc.
- holds compliance flags and credential metadata

Relationships:

- User ↔ Organization membership (with org-scoped role bindings)

### 2.2 Property (core entity)

**Property** represents a physical real estate asset with its characteristics.

Core fields (conceptual):

```
Property
├── property_id (UUID)
├── created_at / updated_at
├── status: ACTIVE | PENDING | SOLD | OFF_MARKET | DELETED
│
├── # Location
├── address_line_1 / address_line_2
├── city / state_province / postal_code / country
├── latitude / longitude / location (PostGIS GEOGRAPHY)
├── parcel_number (APN)
├── county / neighborhood
│
├── # Property characteristics
├── property_type: SINGLE_FAMILY | CONDO | TOWNHOUSE | MULTI_FAMILY | LAND | COMMERCIAL
├── year_built
├── lot_size_sqft / living_area_sqft
├── bedrooms / bathrooms_full / bathrooms_half
├── stories / parking_type / parking_spaces
├── pool / waterfront / view_type
│
├── # Structure details
├── foundation_type / roof_type / exterior_material
├── heating_type / cooling_type
├── flooring_types (ARRAY) / appliances_included (ARRAY)
│
├── # Legal/tax
├── zoning / hoa_name / hoa_monthly_fee
├── property_tax_annual / tax_assessment_year / tax_assessed_value
│
├── # Metadata
├── data_source: MLS | MANUAL | PUBLIC_RECORDS | IMPORTED
├── mls_number / last_verified_at
└── attributes (JSONB for extensibility)
```

### 2.3 Listing

**Listing** represents a property offered for sale or rent at a specific time.

Core fields (conceptual):

```
Listing
├── listing_id (UUID)
├── property_id (FK)
├── created_at / updated_at
├── status: DRAFT | ACTIVE | PENDING | SOLD | EXPIRED | WITHDRAWN | DELETED
│
├── # Pricing
├── list_price / price_currency / price_per_sqft
├── original_list_price / price_change_count / last_price_change_at
│
├── # Listing details
├── listing_type: FOR_SALE | FOR_RENT | AUCTION
├── listing_date / expiration_date / days_on_market
├── description (rich text) / highlights (ARRAY)
│
├── # Agent/broker
├── listing_agent_id (FK → User)
├── listing_broker_id (FK → Organization)
├── co_listing_agent_id (nullable)
│
├── # Showings
├── showing_instructions / lockbox_type
├── virtual_tour_url / open_house_dates (ARRAY)
│
├── # Visibility
├── is_public / syndication_allowed
│
├── # AI-generated
├── ai_description_id (FK → AI_Task)
├── embedding_id (FK → ai_embeddings)
│
└── metadata (JSONB)
```

Note: Listings are typically **PUBLIC** classification; transaction facts are not.

### 2.3.1 Showings and property viewings (authoritative scheduling)

The journey includes “Schedule Showing” and “Property Viewing”. These are not macro-states, but they SHOULD be representable as authoritative facts for:

- operational coordination (who/when/where)
- auditability (who scheduled/cancelled)
- downstream derived effects (notifications)

Suggested canonical entities (conceptual):

**Showing**

- showing_id (UUID)
- listing_id (FK → Listing)
- scheduled_start_at / scheduled_end_at
- status: SCHEDULED | COMPLETED | CANCELLED | NO_SHOW
- requested_by_user_id (nullable; buyer/buyer_agent)
- created_by_user_id (actor)
- notes / access_instructions (policy-filtered)
- created_at / updated_at

Visibility:

- Showings are generally **TRANSACTION_SHARED** or **CONFIDENTIAL_ROLE** depending on whether a buyer is attached.
- Showings MUST NOT become a side-channel for party identity disclosure.

### 2.4 Property images

**PropertyImage** stores images associated with properties.

Core fields (conceptual):

```
PropertyImage
├── image_id (UUID)
├── property_id (FK)
├── listing_id (FK, nullable)
├── uploaded_by (FK → User)
├── uploaded_at
│
├── # Storage
├── storage_path / storage_bucket
├── file_size_bytes / mime_type / checksum
│
├── # Variants (generated by image processor)
├── thumbnail_path / medium_path / large_path / webp_path
│
├── # Metadata (EXIF)
├── width / height / orientation
├── camera_make / camera_model / taken_at
├── gps_latitude / gps_longitude
│
├── # Classification (AI-generated)
├── image_type: EXTERIOR | INTERIOR | FLOOR_PLAN | AERIAL | NEIGHBORHOOD | OTHER
├── room_type: LIVING_ROOM | KITCHEN | BEDROOM | BATHROOM | GARAGE | YARD | OTHER
├── is_primary / display_order / caption
├── ai_tags (ARRAY) / ai_description
│
├── # OCR (for floor plans)
├── ocr_text / ocr_processed_at
│
├── # Embedding (for similarity search)
├── embedding_id (FK → ai_embeddings)
│
└── moderation_status: PENDING | APPROVED | REJECTED
```

### 2.5 Transaction (primary aggregate)

**Transaction** is the root of legally meaningful progression.

Core fields (conceptual):

- transaction_id
- property_id (FK → Property, links transaction to property)
- jurisdiction / compliance_context_id
- current_state (state machine)
- state_entered_at
- created_at/updated_at (or versioned row pattern)

Relationships:

- Transaction ↔ Property (the subject of the transaction)
- Transaction ↔ Parties (buyers, sellers, agents, escrow, lender, etc.)
- Transaction ↔ Documents
- Transaction ↔ Inspections and Appraisals
- Transaction ↔ Events/Audit
- Transaction ↔ ChatRoom (transaction chat)

### 2.5.1 Offers, counteroffers, and negotiation (authoritative)

The journey’s negotiation loop (“Submit offer → Negotiation → Counteroffer → Agreement”) MUST be represented as authoritative facts, not only as free-form documents.

Suggested canonical entities (conceptual):

**Offer**

- offer_id (UUID)
- transaction_id (FK → Transaction)
- offer_version (int) or immutable lineage (parent_offer_id)
- status: SUBMITTED | COUNTERED | WITHDRAWN | REJECTED | ACCEPTED
- terms (JSONB) (price, contingencies, dates; schema-governed)
- created_by_user_id (actor)
- created_at
- accepted_at / rejected_at / withdrawn_at (nullable)

**OfferDecision**

- decision_id (UUID)
- offer_id
- decision: ACCEPT | REJECT | COUNTER
- decided_by_user_id (actor)
- decided_at
- reason (policy-filtered; required for reject/cancel paths where mandated)

Evidence linking:

- Offers SHOULD link to evidence documents (e.g., `document_type=offer`, `document_type=purchase_agreement`) and signatures.
- The transition `OFFER_MADE → UNDER_CONTRACT` MUST require an “accepted offer exists” fact and an executed purchase agreement signature fact (see `05-transaction-state-machine-spec.md`).

### 2.6 Transaction parties and relationships

**TransactionParty** (binding table)

Purpose:

- binds users to a transaction with a contextual role
- carries relationship metadata required for ABAC (e.g., "hiring_party" for inspector relationships)

Example conceptual attributes:

- transaction_id
- user_id
- role (BUYER, SELLER, BUYER_AGENT, SELLER_AGENT, ESCROW_OFFICER, LENDER, INSPECTOR, APPRAISER)
- relationship_attributes (JSONB, versioned as needed)

Hard constraints:

- A user can be attached multiple times only if roles differ (or explicitly modeled).
- Access decisions are evaluated against this relationship.

### 2.7 Documents (authoritative evidence)

Documents are treated as evidence with chain-of-custody.

**Document**

- document_type (purchase_agreement, escrow_instructions, inspection_report, appraisal, funding_confirmation, etc.)
- classification (PUBLIC / TRANSACTION_SHARED / CONFIDENTIAL_ROLE / REGULATED / SYSTEM)
- owner_role / visibility scope
- execution status (draft/signed/void)
- locked_at (when edits are forbidden)

**DocumentVersion**

- version integer or content hash lineage
- storage reference (object storage path)
- checksum (integrity)
- created_by and created_at

**DocumentSignature**

- signer identity
- signature status/timestamp
- signature provider metadata

**DocumentText** (derived from document processing)

- document_version_id (references DocumentVersion)
- extracted_text (full text content)
- extraction_method (pymupdf, python-docx, tesseract)
- page_count (for PDFs)
- word_count
- extraction_metadata (JSONB)

**DocumentChunk** (derived for RAG)

- document_version_id (references DocumentVersion)
- chunk_index (ordering)
- content (chunked text)
- token_count
- start_char / end_char (position in original)

Document chunks inherit visibility from parent document via RLS.

Cross-domain requirement:

- transaction state transitions MAY require documents (presence + signed status) as preconditions.

### 2.8 Inspections (confidential role-isolated)

**Inspection**

- assignment (inspector identity)
- schedule and completion state
- linked to transaction

**InspectionFinding**

- structured finding details (JSON)
- severity (minor/major/critical)
- resolution state (resolved, resolved_at)

Inspection report is typically a document (`document_type=inspection_report`) and MUST be **CONFIDENTIAL_ROLE** with explicit deny to lender.

### 2.9 Appraisals

**Appraisal**

- appraiser identity (often lender-hired)
- valuation and status
- linked to transaction

Appraisal artifacts (reports) are evidence documents with visibility rules distinct from inspections.

### 2.10 Escrow and funding (regulated)

Escrow is modeled as regulated, authority-bearing facts.

Core concepts:

- **EscrowAssignment**: escrow officer assignment to transaction (with effective dates)
- **EscrowInstruction**: authoritative instructions document(s) and metadata
- **EarnestMoneyDeposit**: confirmation that deposit was received (authoritative prerequisite)
- **FundingConfirmation**: confirmation funds are received/cleared (authoritative prerequisite)
- **DisbursementInstruction** (optional): structured payout instructions (regulated)

The design MUST allow:

- proving who authorized what and when
- preventing state progression without escrow prerequisites
- isolating escrow operations to escrow roles and states

### 2.11 Title, recording, and ownership transfer (regulated milestones)

The journey requires:

- title search and insurance
- deed recording
- ownership transfer

These MUST be modeled as authoritative milestone facts to support:

- gating of `CLEAR_TO_CLOSE → CLOSED` (recording + transfer evidence)
- separation-of-duties and visibility rules
- FINRA/SOC2 audit survivability

Suggested canonical entities (conceptual):

**TitleOrder**

- title_order_id (UUID)
- transaction_id
- ordered_by_user_id (actor)
- ordered_at
- status: ORDERED | COMMITMENT_RECEIVED | CLEARED | EXCEPTIONS_OPEN | CANCELLED

**TitleCommitment**

- commitment_id (UUID)
- transaction_id
- document_id (evidence link, e.g. `document_type=title_commitment`)
- received_at
- exceptions_summary (policy-filtered)

**DeedRecording**

- recording_id (UUID)
- transaction_id
- document_id (evidence link, e.g. `document_type=deed` and/or `recording_confirmation`)
- recorded_at
- recording_reference (book/page, instrument number; jurisdiction-specific)

**OwnershipTransfer**

- transfer_id (UUID)
- transaction_id
- transferred_at
- notes (optional; policy-filtered)

Classification/visibility:

- Title and recording artifacts are generally **TRANSACTION_SHARED** with jurisdiction-dependent redaction.
- Recording/transfer are gating facts; they MUST be strongly audited and treated as regulated milestones.

### 2.12 Compliance context (jurisdiction and rulesets)

Each transaction MUST reference a compliance context:

- jurisdiction identifiers
- governing ruleset id/version
- retention policy references
- disclosure requirements references

This enables jurisdiction-specific enforcement without forking the core model.

---

## 3. Messaging model

### 3.1 Chat rooms

**ChatRoom** represents a conversation space between users.

Core fields:

```
ChatRoom
├── room_id (UUID)
├── room_type: TRANSACTION | DIRECT | GROUP
├── transaction_id (nullable, required for TRANSACTION type)
├── name (optional, for GROUP)
├── created_at / created_by
├── is_archived
└── metadata (JSONB)
```

Room types:

- **TRANSACTION**: Auto-created for each transaction, includes all parties
- **DIRECT**: 1:1 chat between two users
- **GROUP**: Custom group with subset of transaction parties

### 3.2 Chat room members

**ChatRoomMember** binds users to chat rooms.

Core fields:

```
ChatRoomMember
├── room_id (FK)
├── user_id (FK)
├── joined_at / left_at (nullable)
├── role: OWNER | MEMBER
├── is_muted
├── last_read_message_id (for read receipts)
└── notification_preference: ALL | MENTIONS | NONE
```

### 3.3 Messages

**Message** represents a single chat message.

Core fields:

```
Message
├── message_id (UUID)
├── room_id (FK)
├── sender_id (FK → User)
├── message_type: TEXT | PROPERTY_SHARE | DOCUMENT_SHARE | IMAGE | SYSTEM
├── content (encrypted text)
├── content_json (JSONB for structured content)
├── reply_to_message_id (nullable, for threading)
├── created_at / edited_at
├── is_deleted (soft delete)
└── metadata (JSONB: mentions, reactions)
```

**Property share payload** (message_type = PROPERTY_SHARE):

```json
{
  "property_id": "uuid",
  "listing_id": "uuid",
  "share_context": "Check out this property!",
  "snapshot": {
    "address": "123 Main St",
    "price": 500000,
    "thumbnail_url": "https://..."
  }
}
```

### 3.4 Chat attachments

**ChatAttachment** stores files shared in chat.

Core fields:

```
ChatAttachment
├── attachment_id (UUID)
├── message_id (FK)
├── file_type: IMAGE | DOCUMENT | OTHER
├── storage_path / file_name
├── file_size_bytes / mime_type
├── thumbnail_path (for images)
├── checksum
└── uploaded_at
```

### 3.5 Messaging principles

- Chat is **auxiliary, not authoritative**: Messages cannot change transaction state.
- Party-gated visibility: Chat access follows transaction party relationships.
- Real-time delivery: WebSocket-based with offline message queuing.
- Retention: Messages retained per policy but not immutable like audit events.

---

## 4. Buyer preferences and matching model

### 4.1 Buyer preferences

**BuyerPreference** stores a buyer's search criteria for property matching.

Core fields:

```
BuyerPreference
├── preference_id (UUID)
├── user_id (FK)
├── created_at / updated_at
├── is_active
│
├── # Location preferences
├── preferred_cities (ARRAY) / preferred_states (ARRAY)
├── preferred_zip_codes (ARRAY)
├── max_commute_minutes
├── commute_destination_lat / commute_destination_lng
│
├── # Property preferences
├── price_min / price_max
├── bedrooms_min / bedrooms_max / bathrooms_min
├── property_types (ARRAY)
├── min_sqft / max_sqft / min_lot_sqft
├── year_built_min
│
├── # Must-haves
├── must_have_pool / must_have_garage
├── must_have_yard / must_have_view
│
├── # Nice-to-haves (weighted)
├── nice_to_have (JSONB: { "pool": 0.8, "updated_kitchen": 0.9 })
│
├── # Semantic matching
├── lifestyle_description (text: "quiet neighborhood, good schools")
├── preference_embedding_id (FK → ai_embeddings)
│
└── notification_frequency: INSTANT | DAILY | WEEKLY | NONE
```

### 4.2 Property matches

**PropertyMatch** stores computed match scores between buyers and listings.

Core fields:

```
PropertyMatch
├── match_id (UUID)
├── user_id (FK)
├── preference_id (FK)
├── listing_id (FK)
├── computed_at
├── match_score (0.0 to 1.0)
├── score_breakdown (JSONB: { "price": 0.9, "features": 0.8, ... })
├── ai_explanation (text)
├── user_feedback: NULL | LIKED | DISLIKED | SAVED | CONTACTED
├── feedback_at
└── is_notified
```

### 4.3 Matching algorithm

The matching system uses a hybrid approach:

1. **Hard filters**: Eliminate properties that don't meet must-have criteria
2. **Weighted scoring**: Score nice-to-haves based on preferences
3. **Semantic similarity**: pgvector cosine similarity between preference and listing embeddings
4. **Collaborative filtering**: "Buyers like you also liked..." patterns

---

## 5. Evidence and history (immutable)

### 5.1 Domain events (evidence of facts)

**DomainEvent**

- append-only
- emitted only after (and within) a successful commit
- stable envelope + immutable payload

Domain events are the backbone for:

- AI orchestration
- notification fan-out
- compliance exports and replay

### 5.2 Audit events (forensic backbone)

**AuditEvent**

- append-only legal backbone for "what happened, who did it, when"
- must include integrity metadata (hashing/checksums) where appropriate

### 5.3 Access decisions (provability)

**AccessDecision** (recommended for sensitive surfaces)

- records allow/deny outcomes with policy version references
- enables proving "the system could not have leaked"

---

## 6. Authorization and policy model (data-driven)

The policy model MUST support:

- RBAC baselines (roles and permissions)
- ABAC attributes (subject/object/context)
- state gating (transaction state)
- classification gating (PUBLIC vs CONFIDENTIAL_ROLE, etc.)
- jurisdiction gating
- explicit denies
- policy versioning

Suggested canonical entities:

- Role, Permission, RolePermission
- SubjectAttribute, ObjectAttribute (or generalized Attribute tables)
- PolicyVersion, PolicyRule
- AccessDecision

DB-layer RLS policies are the final enforcement for data visibility.

---

## 7. AI advisory model (non-authoritative)

AI is modeled as a bounded subsystem that reacts to events and stores advisory artifacts.

### 7.1 AI task

**AI_Task**

- task_type (e.g., INSPECTION_SUMMARY, DEADLINE_RISK, DOCUMENT_MISSING, PROPERTY_MATCH, IMAGE_CLASSIFY)
- target (entity_type/entity_id/transaction_id)
- triggering_event_id
- state (queued/running/succeeded/failed/cancelled)

### 7.2 AI insight/output

**AI_Insight**

- insight_type (summary, anomaly, recommendation, match_explanation)
- visibility_scope (what audience may read it; MUST align to classification rules)
- provenance (model id, prompt hash, input snapshot refs)
- approval state (draft/approved/rejected) where required

AI artifacts MUST be computable from authoritative facts + stored prompts and thus replayable (within reasonable limits).

### 7.3 AI embeddings (vector storage)

**AI_Embedding**

- embedding_id
- entity_type (document, transaction, insight, listing, property_image, buyer_preference)
- entity_id (reference to source entity)
- embedding (vector(1536) for OpenAI text-embedding-3-small)
- model_id (embedding model identifier)
- created_at

Embeddings are stored in PostgreSQL using pgvector and inherit visibility from source entities via RLS-aware joins.

### 7.4 AI input snapshots

**AI_InputSnapshot**

- snapshot_id
- task_id (references AI_Task)
- input_references (JSONB - event ids, document ids, etc.)
- content_hash (integrity verification)
- visibility_scope (classification aligned)

Input snapshots enable provenance tracking and replay for audit purposes.

---

## 8. Notifications and communications (derived)

Notifications are derived effects, not authoritative facts.

**Notification**

- recipient identity and delivery channels
- trigger_event_id
- visibility scope and classification checks
- delivery status (for ops)
- notification_type (includes CHAT_MESSAGE, PROPERTY_MATCH, etc.)

---

## 9. Compliance entities (SOC 2 + FINRA)

### 9.1 Compliance records (FINRA 4511)

**ComplianceRecord** (immutable, WORM storage)

- record_id
- record_type (transaction, communication, order)
- entity_type / entity_id (reference to source)
- content_hash (SHA-256 for integrity)
- retention_category (standard_6yr, lifetime, custom)
- retention_until (date)
- legal_hold (boolean)
- legal_hold_reason (if applicable)
- created_at

Rules:

- **MUST** be append-only (no UPDATE/DELETE permissions)
- **MUST** map to S3 Object Lock for WORM compliance
- **MUST** support 6-year retention per FINRA Rule 4511

### 9.2 Supervision cases (FINRA 3110)

**SupervisionCase**

- case_id
- transaction_id (reference)
- flag_type (high_value, unusual_pattern, manual_escalation, regulatory)
- status (pending_review, under_review, approved, escalated, rejected)
- flagged_at
- reviewer_id (when assigned)
- reviewed_at
- decision (approve, reject, escalate)
- notes (reviewer comments)

Supervision workflow enables:

- flagging transactions for supervisory review
- tracking review decisions with audit trail
- escalation to senior compliance officers

### 9.3 Audit events (SOC 2 + FINRA unified)

**AuditEvent** (enhanced for compliance)

- event_id
- event_type / event_category
- actor_id / actor_type / actor_role
- actor_ip_address / actor_user_agent
- resource_type / resource_id / transaction_id
- action / outcome (success, failure, denied)
- details (JSONB)
- previous_event_hash (tamper detection chain)
- event_hash (SHA-256 of event content)
- retention_category / retention_until
- legal_hold
- correlation_id / request_id
- occurred_at

Rules:

- **MUST** be append-only
- **MUST** include integrity hashing for tamper detection
- **MUST** support legal holds that prevent deletion/anonymization

---

## 10. Read models ("views")

Realtrust ai MUST provide shaped read models for:

- transaction overview (current state + key milestones)
- participant/party views
- document checklist views (required vs present vs signed)
- audit timeline views (state transitions + evidence)
- property search results (filtered by criteria)
- listing details (public-facing)
- chat room and message views
- match recommendations (buyer-specific)
- role-appropriate dashboards (backend-only contract; frontend out of scope)

These can be implemented as:

- SQL views/materialized views, and/or
- API view resources backed by queries

All views MUST respect RLS and classification rules.

---

## 11. Domain invariants (cross-cutting)

The following are examples of invariants the domain model must support (implementation details in other specs):

- a transaction MUST NOT transition to CLOSED if required documents are missing or unsigned
- a transaction MUST NOT transition to CLOSED if unresolved critical inspection findings exist
- inspection report visibility MUST exclude lenders (explicit deny)
- events MUST NOT exist for failed transitions
- AI outputs MUST NOT mutate authoritative state
- chat messages MUST NOT be visible to non-room-members
- property matches MUST respect buyer preference active status

For the authoritative list and enforcement strategy, see:

- `05-transaction-state-machine-spec.md`
- `06-authorization-and-data-access.md`
- `07-events-and-outbox.md`
- `11-testing-and-proof-suite.md`
