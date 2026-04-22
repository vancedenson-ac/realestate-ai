# realtrust ai — Database Schema, Invariants, and Governance (PostgreSQL)

This document specifies how the realtrust ai database is designed, evolved, and defended.

PostgreSQL is the **system of record** for authoritative facts, legality enforcement, and final access boundaries.

---

## 1. Core principles (non-negotiable)

1. **Truth lives in Postgres**: authoritative data is stored in PostgreSQL.
2. **Legality is enforceable**: state transitions and invariants are enforced in the DB (functions/constraints).
3. **Visibility is enforceable**: ABAC/RLS must make unauthorized rows physically invisible.
4. **Evidence is immutable**: domain events and audit events are append-only.
5. **No silent overwrites**: regulated/mutable facts use versioning; updates are controlled and auditable.
6. **Schema changes are governed**: versioned migrations; drift detection; policy change auditing.

---

## 1.1 Database platform and extensions

**Platform**: PostgreSQL 16+ via Amazon Aurora Global Database (multi-region).

**Required Extensions**:

| Extension | Purpose | Requirement Level |
|-----------|---------|-------------------|
| `pgvector` | Vector embeddings for AI/semantic search | MUST |
| `postgis` | Geographic queries for property search | MUST |
| `pg_cron` | Scheduled maintenance jobs | SHOULD |
| `pg_stat_statements` | Query performance monitoring | MUST |
| `pgcrypto` | Payload hashing for audit integrity | MUST |
| `uuid-ossp` | UUID generation | MUST |

**Extension Initialization**:

```sql
-- Required extensions (run as superuser during setup)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
```

---

## 2. Schema organization and conventions

### 2.1 Naming conventions

- snake_case for tables and columns
- UUID primary keys for core entities
- explicit `created_at`, `updated_at` timestamps (or versioning fields)
- consistent foreign key naming: `<referenced_table>_id`

### 2.2 Authoritative vs derived separation

The schema SHOULD clearly separate:

- authoritative tables (transactions, parties, documents, escrow facts)
- derived/advisory tables (AI insights, metrics)
- immutable ledgers (domain_events, audit_events)

This separation may be expressed via:

- schemas (e.g., `core`, `audit`, `ai`, `derived`)
- or clear naming and privilege boundaries

---

## 3. The transaction state machine in SQL (required)

### 3.1 State table

```sql
CREATE TABLE transaction_states (
  state TEXT PRIMARY KEY,
  is_terminal BOOLEAN NOT NULL DEFAULT false
);
```

### 3.2 Transition table

```sql
CREATE TABLE transaction_state_transitions (
  from_state TEXT NOT NULL REFERENCES transaction_states(state),
  to_state TEXT NOT NULL REFERENCES transaction_states(state),
  allowed_roles TEXT[] NOT NULL,
  required_documents TEXT[] NOT NULL DEFAULT '{}',
  emits_event TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
);
```

Seeds MUST be generated from `05-transaction-state-machine-spec.md`.

### 3.3 Authoritative transition function (canonical pattern)

All state transitions MUST go through a single function that:

- locks the transaction row (`FOR UPDATE`)
- validates legal transition
- validates role eligibility
- validates transition preconditions (pure predicates over authoritative milestone facts; derived from `05-transaction-state-machine-spec.md`)
- asserts cross-domain invariants (see below)
- updates state
- emits domain event (and outbox row) in the same DB transaction

Illustrative skeleton:

```sql
CREATE OR REPLACE FUNCTION transition_transaction_state(
  p_transaction_id UUID,
  p_new_state TEXT
) RETURNS VOID AS $$
DECLARE
  v_current_state TEXT;
  v_actor_role TEXT;
BEGIN
  -- Role is derived from session context (RLS/permission equation); client MUST NOT pass it in request bodies.
  v_actor_role := COALESCE(current_setting('app.role', true), '');
  IF v_actor_role = '' THEN
    RAISE EXCEPTION 'Missing actor role in session';
  END IF;

  SELECT current_state INTO v_current_state
  FROM transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM transaction_state_transitions
    WHERE from_state = v_current_state
      AND to_state = p_new_state
      AND v_actor_role = ANY(allowed_roles)
  ) THEN
    RAISE EXCEPTION 'Illegal transition % → % by role %', v_current_state, p_new_state, v_actor_role;
  END IF;

  PERFORM assert_transaction_invariants(p_transaction_id, p_new_state);

  UPDATE transactions
  SET current_state = p_new_state,
      state_entered_at = now(),
      updated_at = now()
  WHERE transaction_id = p_transaction_id;

  -- insert domain_events + event_outbox here (atomic with state update)
END;
$$ LANGUAGE plpgsql;
```

Hard rule:

- There MUST NOT be any alternate path that updates `transactions.current_state` directly.

---

## 4. Cross-domain invariants (DB-enforced)

### 4.1 Why invariants live in the DB

Application validation can be bypassed.

DB invariants:

- cannot be bypassed by ORM bugs or internal tooling
- are provable
- reduce the legal state space (“illegal states are unrepresentable”)

### 4.2 Canonical invariant examples

When attempting to transition to `CLOSED`:

- **I1**: no unresolved critical inspection findings exist
- **I2**: all required documents for close exist and are signed
- **I3**: deed recording confirmation exists (authoritative recording fact)
- **I4**: ownership transfer confirmation exists (authoritative transfer fact)
- **I5**: regulated fund disbursement is recorded/authorized where applicable

Illustrative function (adapt from existing docs):

```sql
CREATE OR REPLACE FUNCTION assert_transaction_invariants(
  p_transaction_id UUID,
  p_target_state TEXT
) RETURNS VOID AS $$
BEGIN
  IF p_target_state = 'CLOSED' AND EXISTS (
    SELECT 1
    FROM inspection_findings f
    JOIN inspections i ON i.inspection_id = f.inspection_id
    WHERE i.transaction_id = p_transaction_id
      AND f.severity = 'critical'
      AND f.resolved = false
  ) THEN
    RAISE EXCEPTION 'Cannot close transaction: unresolved critical inspection findings exist';
  END IF;

  IF p_target_state = 'CLOSED' AND EXISTS (
    SELECT 1
    FROM transaction_state_transitions t
    WHERE t.to_state = 'CLOSED'
      AND EXISTS (
        SELECT 1
        FROM unnest(t.required_documents) req(doc_type)
        WHERE NOT EXISTS (
          SELECT 1 FROM documents d
          WHERE d.transaction_id = p_transaction_id
            AND d.document_type = req.doc_type
            AND d.execution_status = 'signed'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot close transaction: required documents missing or unsigned';
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Row-Level Security (RLS) as final authority

RLS MUST be enabled for tables containing transaction-scoped, confidential, or regulated data.

Key requirements:

- API sets session context variables (`SET LOCAL app.user_id`, etc.)
- policies enforce:
  - transaction relationship
  - organization/tenant isolation
  - jurisdiction eligibility
  - classification rules
  - explicit denies (inspection → lender)

Detailed policy design is in `06-authorization-and-data-access.md`.

### 5.1 RLS safety: ownership, FORCE RLS, and fail-closed settings (MUST)

RLS MUST be treated as a **security boundary**, not an application convenience.

Requirements:

- **Role separation**:
  - a migration/owner role owns tables and defines RLS policies
  - the runtime application role (`app_user`) MUST NOT own tables and MUST NOT have RLS-bypass privileges
- **Force RLS**:
  - for all sensitive tables protected by RLS, the schema SHOULD use:
    - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
    - `ALTER TABLE ... FORCE ROW LEVEL SECURITY;`
- **Fail closed**:
  - policies MUST deny when required session settings are missing
  - prefer `current_setting('app.user_id', true)` and treat NULL/empty as deny

### 5.2 View safety (MUST)

Read models often use SQL views. The platform MUST ensure views do not become an RLS bypass mechanism.

Rules:

- Views SHOULD execute with **invoker semantics** where supported, so that underlying RLS applies to the caller.
- If a view must be owned by a privileged role, it MUST NOT bypass RLS-protected tables and must be tested explicitly in the proof suite.

---

## 6. Immutable ledgers: events and audits

### 6.1 Domain events

`domain_events` is append-only evidence of facts.

### 6.2 Audit events

`audit_events` is the forensic backbone (who did what, when).

Hard requirements:

- no updates or deletes
- integrity metadata (hashes) for regulated payload snapshots

---

## 7. Document chain-of-custody (object storage + DB metadata)

Documents are stored in object storage; PostgreSQL stores:

- metadata (type, classification, visibility rules)
- versions (storage path, checksum, created_at/by)
- signatures and locking milestones

Required properties:

- verifiable integrity (checksums)
- reconstructable version history
- policy-driven visibility and classification enforcement

---

## 8. Schema evolution and governance

### 8.1 Migration discipline

Schema changes MUST be applied via a migration tool (e.g., Alembic) and versioned in source control. The current implementation may use versioned SQL scripts (e.g. `02-schema.sql`, `03-seed.sql`) for initial setup and local development; governed migrations (Alembic) are required for production schema evolution.

Changes MUST be:

- reviewed
- tested (including negative tests for invariants and RLS)
- applied consistently across environments

### 8.2 Drift detection (recommended)

The platform SHOULD maintain:

- `schema_versions` (applied migration identifiers)
- `schema_checksums` (optional; verify schema matches expected definitions)

### 8.3 Policy change governance

RLS policy changes and authorization policy changes SHOULD be:

- versioned
- auditable (record who changed what)
- test-gated

### 8.4 Command idempotency (authoritative dedupe) (MUST)

Idempotency keys MUST be persisted in PostgreSQL so that deduplication survives:

- service restarts
- Redis eviction/outages
- multi-region failover

Redis MAY be used as a cache for recent idempotency outcomes, but PostgreSQL is final authority.

Suggested schema:

```sql
CREATE TABLE command_dedup (
    idempotency_key TEXT NOT NULL,
    command_name TEXT NOT NULL,
    actor_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
    result_ref JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, command_name, idempotency_key)
);

-- Optional: TTL management via a scheduled job (see infra doc)
CREATE INDEX command_dedup_created_at_idx ON command_dedup (created_at);
```

Rules:

- The API MUST compute a stable `request_hash` and reject reuse of the same idempotency key with a different hash (conflict).
- The dedupe record MUST be written inside the same DB transaction as the corresponding authoritative command (where feasible).

---

## 9. Suggested minimal authoritative table set (conceptual)

This section is a conceptual inventory aligned to the legacy docs (not an exhaustive DDL).

### 9.1 Identity and relationships

- users
- organizations
- transaction_parties (contextual role bindings)

### 9.2 Transaction legality

- transactions
- transaction_states
- transaction_state_transitions
- transaction_state_history (immutable)

### 9.2.1 Offers and negotiation (authoritative)

- offers (offer chain; submitted/countered/accepted/rejected/withdrawn)
- offer_decisions (accept/reject/counter with actor + timestamp + required reasons)

### 9.3 Documents and evidence

- documents
- document_versions
- document_signatures

### 9.4 Inspections and appraisals

- inspections
- inspection_findings
- appraisals

### 9.5 Escrow/funding (regulated)

- escrow_assignments
- earnest_money_deposits
- funding_confirmations
- disbursement_instructions (optional)
- disbursements (record of authorized/paid disbursements; regulated)

### 9.5.1 Title, recording, and ownership transfer (regulated milestones)

- title_orders
- title_commitments (and/or link to evidence documents)
- deed_recordings (recording confirmation)
- ownership_transfers

### 9.6 Evidence and auditing

- domain_events
- event_outbox
- audit_events
- access_decisions (recommended)

### 9.7 AI advisory

- ai_tasks
- ai_insights
- ai_prompt_templates
- ai_model_registry
- ai_embeddings (vector storage for semantic search)
- ai_input_snapshots (provenance tracking)

**AI Embeddings Schema (pgvector)**:

```sql
CREATE TABLE ai_embeddings (
    embedding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,            -- 'document', 'transaction', 'insight'
    entity_id UUID NOT NULL,
    embedding vector(1536) NOT NULL,      -- OpenAI text-embedding-3-small dimension
    model_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id, model_id)
);

-- HNSW index for fast similarity search
CREATE INDEX ai_embeddings_hnsw_idx ON ai_embeddings 
    USING hnsw (embedding vector_cosine_ops);

-- RLS: embeddings inherit visibility from source entity
ALTER TABLE ai_embeddings ENABLE ROW LEVEL SECURITY;
```

### 9.8 Document processing (derived)

- document_text (extracted text content)
- document_chunks (chunked content for RAG)

**Document Processing Schema**:

```sql
-- Extracted document text (versioned with document)
CREATE TABLE document_text (
    document_version_id UUID PRIMARY KEY REFERENCES document_versions(version_id),
    extracted_text TEXT NOT NULL,
    extraction_method TEXT NOT NULL,  -- 'pymupdf', 'python-docx', 'tesseract'
    page_count INTEGER,
    word_count INTEGER NOT NULL,
    extraction_metadata JSONB,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document chunks for RAG (derived, can be regenerated)
CREATE TABLE document_chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_version_id UUID NOT NULL REFERENCES document_versions(version_id),
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    start_char INTEGER NOT NULL,
    end_char INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_version_id, chunk_index)
);

-- RLS: chunks inherit visibility from parent document
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_chunks_visibility ON document_chunks
USING (
    EXISTS (
        SELECT 1 FROM document_versions dv
        JOIN documents d ON d.document_id = dv.document_id
        JOIN transaction_parties tp ON tp.transaction_id = d.transaction_id
        WHERE dv.version_id = document_chunks.document_version_id
          AND tp.user_id = current_setting('app.user_id')::uuid
    )
);
```

### 9.9 Compliance (SOC 2 + FINRA)

- compliance_records (WORM, 6-year retention)
- supervision_cases (FINRA 3110)
- audit_events (enhanced for SOC 2 + FINRA)

**Compliance Records Schema (FINRA 4511)**:

```sql
-- Immutable compliance records with retention tracking
CREATE TABLE compliance_records (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_type TEXT NOT NULL,  -- 'transaction', 'communication', 'order'
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    content_hash TEXT NOT NULL,  -- SHA-256 of record content
    retention_category TEXT NOT NULL,  -- 'standard_6yr', 'lifetime', 'custom'
    retention_until DATE NOT NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    legal_hold_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WORM compliance: remove UPDATE and DELETE privileges
REVOKE UPDATE, DELETE ON compliance_records FROM app_user;

-- Only compliance_admin can manage legal holds
GRANT UPDATE (legal_hold, legal_hold_reason) ON compliance_records TO compliance_admin;
```

**Supervision Cases Schema (FINRA 3110)**:

```sql
CREATE TABLE supervision_cases (
    case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    flag_type TEXT NOT NULL,  -- 'high_value', 'unusual_pattern', 'manual', 'regulatory'
    status TEXT NOT NULL DEFAULT 'pending_review',
    flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewer_id UUID REFERENCES users(user_id),
    reviewed_at TIMESTAMPTZ,
    decision TEXT,  -- 'approve', 'reject', 'escalate'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Enhanced Audit Events Schema (SOC 2 + FINRA)**:

```sql
CREATE TABLE audit_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Event identification
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,  -- 'access', 'modification', 'system', 'compliance'
    
    -- Actor information (SOC 2 CC6.1)
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,  -- 'user', 'system', 'admin'
    actor_role TEXT NOT NULL,
    actor_ip_address INET,
    actor_user_agent TEXT,
    
    -- Resource information
    resource_type TEXT NOT NULL,
    resource_id UUID,
    transaction_id UUID,
    
    -- Event details
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,  -- 'success', 'failure', 'denied'
    details JSONB NOT NULL DEFAULT '{}',
    
    -- Integrity (SOC 2 CC6.8)
    previous_event_hash TEXT,  -- Chain for tamper detection
    event_hash TEXT NOT NULL,  -- SHA-256 of event content
    
    -- Compliance metadata (FINRA 4511)
    retention_category TEXT NOT NULL DEFAULT 'standard_6yr',
    retention_until DATE NOT NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    
    -- Timestamps
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Correlation
    correlation_id TEXT,
    request_id TEXT
);

-- Immutable: no updates or deletes
REVOKE UPDATE, DELETE ON audit_events FROM app_user;

-- Indexes for compliance queries
CREATE INDEX audit_events_compliance_idx 
    ON audit_events (transaction_id, occurred_at, event_type);
CREATE INDEX audit_events_retention_idx 
    ON audit_events (retention_until, legal_hold) 
    WHERE legal_hold = false;
```

### 9.10 Property and listings

- properties (property attributes, location)
- listings (sale/rent offerings)
- property_images (with variants and metadata)

### 9.10.1 Showings and viewings (authoritative scheduling)

- showings (schedule/complete/cancel; listing-scoped; policy-filtered visibility)

**Property Schema (with PostGIS)**:

```sql
CREATE TABLE properties (
    property_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    
    -- Location
    address_line_1 TEXT NOT NULL,
    address_line_2 TEXT,
    city TEXT NOT NULL,
    state_province TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'US',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location GEOGRAPHY(POINT, 4326),  -- PostGIS
    parcel_number TEXT,
    county TEXT,
    neighborhood TEXT,
    
    -- Property characteristics
    property_type TEXT NOT NULL,
    year_built INTEGER,
    lot_size_sqft INTEGER,
    living_area_sqft INTEGER,
    bedrooms INTEGER,
    bathrooms_full INTEGER,
    bathrooms_half INTEGER,
    stories INTEGER,
    parking_type TEXT,
    parking_spaces INTEGER,
    pool BOOLEAN DEFAULT false,
    waterfront BOOLEAN DEFAULT false,
    view_type TEXT,
    
    -- Legal/tax
    zoning TEXT,
    hoa_name TEXT,
    hoa_monthly_fee DECIMAL(10, 2),
    property_tax_annual DECIMAL(10, 2),
    
    -- Metadata
    data_source TEXT NOT NULL DEFAULT 'MANUAL',
    mls_number TEXT,
    attributes JSONB DEFAULT '{}'
);

-- Auto-update location from lat/lng
CREATE OR REPLACE FUNCTION update_property_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_property_location
BEFORE INSERT OR UPDATE OF latitude, longitude ON properties
FOR EACH ROW EXECUTE FUNCTION update_property_location();

-- Geographic search index
CREATE INDEX idx_properties_location ON properties USING GIST(location);
CREATE INDEX idx_properties_type_status ON properties (property_type, status);
```

**Listings Schema**:

```sql
CREATE TABLE listings (
    listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(property_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'DRAFT',
    
    -- Pricing
    list_price DECIMAL(12, 2) NOT NULL,
    price_currency TEXT NOT NULL DEFAULT 'USD',
    original_list_price DECIMAL(12, 2),
    
    -- Listing details
    listing_type TEXT NOT NULL DEFAULT 'FOR_SALE',
    listing_date DATE,
    days_on_market INTEGER DEFAULT 0,
    description TEXT,
    highlights TEXT[],
    
    -- Agent/broker
    listing_agent_id UUID REFERENCES users(user_id),
    listing_broker_id UUID REFERENCES organizations(organization_id),
    
    -- Visibility
    is_public BOOLEAN NOT NULL DEFAULT false,
    
    -- AI
    embedding_id UUID REFERENCES ai_embeddings(embedding_id),
    
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_listings_property ON listings(property_id);
CREATE INDEX idx_listings_status_price ON listings(status, list_price) WHERE status = 'ACTIVE';
CREATE INDEX idx_listings_description_fts ON listings USING GIN (to_tsvector('english', description));
```

**Property Images Schema**:

```sql
CREATE TABLE property_images (
    image_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(property_id),
    listing_id UUID REFERENCES listings(listing_id),
    uploaded_by UUID NOT NULL REFERENCES users(user_id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Storage
    storage_path TEXT NOT NULL,
    storage_bucket TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    checksum TEXT NOT NULL,
    
    -- Variants
    thumbnail_path TEXT,
    medium_path TEXT,
    large_path TEXT,
    webp_path TEXT,
    
    -- EXIF metadata
    width INTEGER,
    height INTEGER,
    orientation TEXT,
    camera_make TEXT,
    camera_model TEXT,
    taken_at TIMESTAMPTZ,
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    
    -- Classification
    image_type TEXT,
    room_type TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    caption TEXT,
    
    -- AI processing
    ai_tags TEXT[],
    ai_description TEXT,
    ocr_text TEXT,
    ocr_processed_at TIMESTAMPTZ,
    embedding_id UUID REFERENCES ai_embeddings(embedding_id),
    
    moderation_status TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE INDEX idx_property_images_property ON property_images(property_id);
CREATE INDEX idx_property_images_listing ON property_images(listing_id) WHERE listing_id IS NOT NULL;
```

### 9.11 Messaging

- chat_rooms (conversation spaces)
- chat_room_members (membership)
- messages (chat messages)
- chat_attachments (files shared in chat)

**Messaging Schema**:

```sql
CREATE SCHEMA IF NOT EXISTS messaging;

CREATE TABLE messaging.chat_rooms (
    room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_type TEXT NOT NULL CHECK (room_type IN ('TRANSACTION', 'DIRECT', 'GROUP')),
    transaction_id UUID REFERENCES transactions(transaction_id),
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL REFERENCES users(user_id),
    is_archived BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT transaction_rooms_require_transaction 
        CHECK (room_type != 'TRANSACTION' OR transaction_id IS NOT NULL)
);

CREATE TABLE messaging.chat_room_members (
    room_id UUID NOT NULL REFERENCES messaging.chat_rooms(room_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ,
    role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')),
    is_muted BOOLEAN NOT NULL DEFAULT false,
    last_read_message_id UUID,
    notification_preference TEXT DEFAULT 'ALL',
    
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE messaging.messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES messaging.chat_rooms(room_id),
    sender_id UUID NOT NULL REFERENCES users(user_id),
    message_type TEXT NOT NULL CHECK (message_type IN ('TEXT', 'PROPERTY_SHARE', 'DOCUMENT_SHARE', 'IMAGE', 'SYSTEM')),
    content TEXT,
    content_json JSONB,
    reply_to_message_id UUID REFERENCES messaging.messages(message_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE messaging.chat_attachments (
    attachment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messaging.messages(message_id),
    file_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    thumbnail_path TEXT,
    checksum TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_messages_room_created ON messaging.messages(room_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messaging.messages(sender_id);
CREATE INDEX idx_chat_rooms_transaction ON messaging.chat_rooms(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_room_members_user ON messaging.chat_room_members(user_id) WHERE left_at IS NULL;

-- RLS for chat rooms (party-gated)
ALTER TABLE messaging.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_room_access ON messaging.chat_rooms
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM messaging.chat_room_members
        WHERE chat_room_members.room_id = chat_rooms.room_id
        AND chat_room_members.user_id = current_setting('app.user_id')::uuid
        AND chat_room_members.left_at IS NULL
    )
    OR (
        room_type = 'TRANSACTION'
        AND EXISTS (
            SELECT 1 FROM transaction_parties
            WHERE transaction_parties.transaction_id = chat_rooms.transaction_id
            AND transaction_parties.user_id = current_setting('app.user_id')::uuid
        )
    )
);

CREATE POLICY message_access ON messaging.messages
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM messaging.chat_rooms
        WHERE chat_rooms.room_id = messages.room_id
    )
);
```

### 9.12 Buyer preferences and matching

- buyer_preferences (search criteria)
- property_matches (computed match scores)

**Matching Schema**:

```sql
CREATE TABLE buyer_preferences (
    preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Location preferences
    preferred_cities TEXT[],
    preferred_states TEXT[],
    preferred_zip_codes TEXT[],
    max_commute_minutes INTEGER,
    commute_destination_lat DECIMAL(10, 8),
    commute_destination_lng DECIMAL(11, 8),
    
    -- Property preferences
    price_min DECIMAL(12, 2),
    price_max DECIMAL(12, 2),
    bedrooms_min INTEGER,
    bedrooms_max INTEGER,
    bathrooms_min DECIMAL(3, 1),
    property_types TEXT[],
    min_sqft INTEGER,
    max_sqft INTEGER,
    min_lot_sqft INTEGER,
    year_built_min INTEGER,
    
    -- Must-haves
    must_have_pool BOOLEAN,
    must_have_garage BOOLEAN,
    must_have_yard BOOLEAN,
    must_have_view BOOLEAN,
    
    -- Nice-to-haves (weighted)
    nice_to_have JSONB DEFAULT '{}',
    
    -- Semantic matching
    lifestyle_description TEXT,
    preference_embedding_id UUID REFERENCES ai_embeddings(embedding_id),
    
    notification_frequency TEXT NOT NULL DEFAULT 'DAILY' 
        CHECK (notification_frequency IN ('INSTANT', 'DAILY', 'WEEKLY', 'NONE'))
);

CREATE TABLE property_matches (
    match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    preference_id UUID NOT NULL REFERENCES buyer_preferences(preference_id),
    listing_id UUID NOT NULL REFERENCES listings(listing_id),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    match_score DECIMAL(5, 4) NOT NULL CHECK (match_score >= 0 AND match_score <= 1),
    score_breakdown JSONB NOT NULL,
    ai_explanation TEXT,
    user_feedback TEXT CHECK (user_feedback IN ('LIKED', 'DISLIKED', 'SAVED', 'CONTACTED')),
    feedback_at TIMESTAMPTZ,
    is_notified BOOLEAN NOT NULL DEFAULT false,
    
    UNIQUE (preference_id, listing_id)
);

-- Indexes
CREATE INDEX idx_buyer_preferences_user ON buyer_preferences(user_id) WHERE is_active = true;
CREATE INDEX idx_property_matches_user_score ON property_matches(user_id, match_score DESC);
CREATE INDEX idx_property_matches_listing ON property_matches(listing_id);
CREATE INDEX idx_property_matches_unnotified ON property_matches(user_id, computed_at) 
    WHERE is_notified = false AND match_score > 0.7;
```

---

## 10. Acceptance criteria

The database layer meets this spec if:

- state transitions cannot be violated even by direct DB writes (only stored procedure path is permitted)
- RLS prevents unauthorized reads and explicit denies always win
- events are emitted only on committed facts (atomic with transition commits)
- audit and evidence tables are append-only and integrity-protected
- negative tests prove illegal states are unrepresentable (`11-testing-and-proof-suite.md`)

