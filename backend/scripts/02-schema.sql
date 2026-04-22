-- realtrust ai — Full schema (run after extensions). Tables in dependency order.
-- Run: psql -U realtrust -d realtrust -f scripts/02-schema.sql

BEGIN;

-- =============================================================================
-- 1. Identity
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
    organization_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ABAC: subject attributes (06-authorization-and-data-access)
CREATE TABLE IF NOT EXISTS subject_attributes (
    user_id UUID NOT NULL REFERENCES users(user_id),
    attribute TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, attribute)
);

-- Organization members (user-org-role for directory / escrow picker; Phase B.5)
CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(organization_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_role ON organization_members(organization_id, role);

-- =============================================================================
-- 2. Transaction state machine (law)
-- =============================================================================
CREATE TABLE IF NOT EXISTS transaction_states (
    state TEXT PRIMARY KEY,
    is_terminal BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS transaction_state_transitions (
    from_state TEXT NOT NULL REFERENCES transaction_states(state),
    to_state TEXT NOT NULL REFERENCES transaction_states(state),
    allowed_roles TEXT[] NOT NULL,
    required_documents TEXT[] NOT NULL DEFAULT '{}',
    emits_event TEXT NOT NULL,
    PRIMARY KEY (from_state, to_state)
);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id),
    current_state TEXT NOT NULL REFERENCES transaction_states(state),
    state_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    jurisdiction TEXT,
    offer_price DECIMAL(12, 2),
    property_id UUID,
    listing_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_parties (
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    user_id UUID NOT NULL REFERENCES users(user_id),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id),
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (transaction_id, user_id, role)
);

-- Helper: INSERT transaction+first party in one step. SECURITY DEFINER so first party insert is allowed
-- (tx_parties_insert_policy requires seeing the transaction, which requires being a party — chicken-and-egg).
CREATE OR REPLACE FUNCTION insert_transaction_with_party(
  p_transaction_id UUID,
  p_organization_id UUID,
  p_current_state TEXT,
  p_property_id UUID,
  p_listing_id UUID,
  p_user_id UUID,
  p_party_role TEXT
) RETURNS SETOF transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id::text, true);
  PERFORM set_config('app.organization_id', p_organization_id::text, true);
  INSERT INTO transactions (transaction_id, organization_id, current_state, property_id, listing_id)
  VALUES (p_transaction_id, p_organization_id, p_current_state, p_property_id, p_listing_id);
  INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role)
  VALUES (p_transaction_id, p_user_id, p_organization_id, p_party_role);
  RETURN QUERY SELECT * FROM transactions WHERE transactions.transaction_id = p_transaction_id;
END;
$$;

CREATE TABLE IF NOT EXISTS transaction_state_history (
    history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_role TEXT NOT NULL
);

-- Backfill jurisdiction/offer_price for existing DBs (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'jurisdiction') THEN
    ALTER TABLE transactions ADD COLUMN jurisdiction TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'offer_price') THEN
    ALTER TABLE transactions ADD COLUMN offer_price DECIMAL(12, 2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'property_id') THEN
    ALTER TABLE transactions ADD COLUMN property_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'listing_id') THEN
    ALTER TABLE transactions ADD COLUMN listing_id UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_org_state ON transactions(organization_id, current_state);
CREATE INDEX IF NOT EXISTS idx_transaction_parties_user ON transaction_parties(user_id);

-- Authoritative transition: only path that may update transactions.current_state (08, 05)
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
        FROM unnest(t.required_documents) AS req(doc_type)
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

  -- Journey milestone gating (05 + 17): preconditions enforced in DB transition path
  IF p_target_state = 'FINANCING' THEN
    IF NOT (
      EXISTS (
        SELECT 1
        FROM appraisals a
        WHERE a.transaction_id = p_transaction_id
          AND lower(a.status) IN ('submitted', 'completed')
      )
      OR EXISTS (
        SELECT 1
        FROM appraisal_waivers w
        WHERE w.transaction_id = p_transaction_id
      )
    ) THEN
      RAISE EXCEPTION 'Cannot enter FINANCING: appraisal not completed or waived';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM title_orders t
      WHERE t.transaction_id = p_transaction_id
        AND t.status != 'CANCELLED'
    ) THEN
      RAISE EXCEPTION 'Cannot enter FINANCING: title not ordered';
    END IF;
  END IF;

  IF p_target_state = 'CLEAR_TO_CLOSE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM title_orders t
      WHERE t.transaction_id = p_transaction_id
        AND (
          t.status = 'CLEARED'
          OR t.insurance_bound_at IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'Cannot enter CLEAR_TO_CLOSE: title not cleared or insured';
    END IF;
  END IF;

  IF p_target_state = 'CLOSED' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM funding_confirmations f
      WHERE f.transaction_id = p_transaction_id
        AND f.verified = true
    ) THEN
      RAISE EXCEPTION 'Cannot close transaction: funds not confirmed';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM disbursements d
      WHERE d.transaction_id = p_transaction_id
    ) THEN
      RAISE EXCEPTION 'Cannot close transaction: disbursement not recorded';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM deed_recordings r
      WHERE r.transaction_id = p_transaction_id
    ) THEN
      RAISE EXCEPTION 'Cannot close transaction: deed not recorded';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM ownership_transfers o
      WHERE o.transaction_id = p_transaction_id
    ) THEN
      RAISE EXCEPTION 'Cannot close transaction: ownership transfer not confirmed';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION transition_transaction_state(
  p_transaction_id UUID,
  p_new_state TEXT,
  p_correlation_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_current_state TEXT;
  v_event_id UUID;
  v_actor_role TEXT;
BEGIN
  v_actor_role := COALESCE(current_setting('app.role', true), '');
  IF v_actor_role = '' THEN
    RAISE EXCEPTION 'Missing actor role in session';
  END IF;

  SELECT current_state INTO v_current_state
  FROM transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF v_current_state IS NULL THEN
    RAISE EXCEPTION 'Transaction not found: %', p_transaction_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM transaction_state_transitions t
    WHERE t.from_state = v_current_state
      AND t.to_state = p_new_state
      AND v_actor_role = ANY(t.allowed_roles)
  ) THEN
    RAISE EXCEPTION 'Illegal transition % → % by role %', v_current_state, p_new_state, v_actor_role;
  END IF;

  -- Required documents (05): enforce per-edge doc requirements as signed evidence
  IF EXISTS (
    SELECT 1
    FROM transaction_state_transitions t
    WHERE t.from_state = v_current_state
      AND t.to_state = p_new_state
      AND EXISTS (
        SELECT 1
        FROM unnest(t.required_documents) AS req(doc_type)
        WHERE NOT EXISTS (
          SELECT 1 FROM documents d
          WHERE d.transaction_id = p_transaction_id
            AND d.document_type = req.doc_type
            AND d.execution_status = 'signed'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Precondition failed: required documents missing or unsigned';
  END IF;

  PERFORM assert_transaction_invariants(p_transaction_id, p_new_state);

  UPDATE transactions
  SET current_state = p_new_state,
      state_entered_at = now(),
      updated_at = now()
  WHERE transaction_id = p_transaction_id;

  INSERT INTO transaction_state_history (transaction_id, from_state, to_state, actor_role)
  VALUES (p_transaction_id, v_current_state, p_new_state, v_actor_role);

  SELECT gen_random_uuid() INTO v_event_id;
  INSERT INTO domain_events (event_id, aggregate_type, aggregate_id, transaction_id, event_type, payload, emitted_by_role, correlation_id)
  VALUES (
    v_event_id,
    'transaction',
    p_transaction_id,
    p_transaction_id,
    (SELECT emits_event FROM transaction_state_transitions WHERE from_state = v_current_state AND to_state = p_new_state),
    jsonb_build_object('from_state', v_current_state, 'to_state', p_new_state, 'actor_role', v_actor_role),
    v_actor_role,
    p_correlation_id
  );
  INSERT INTO event_outbox (event_id) VALUES (v_event_id);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. Command idempotency
-- =============================================================================
CREATE TABLE IF NOT EXISTS command_dedup (
    idempotency_key TEXT NOT NULL,
    command_name TEXT NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(user_id),
    organization_id UUID NOT NULL REFERENCES organizations(organization_id),
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
    result_ref JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, command_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS command_dedup_created_at_idx ON command_dedup (created_at);

-- =============================================================================
-- 4. Domain events and outbox
-- =============================================================================
CREATE TABLE IF NOT EXISTS domain_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    transaction_id UUID REFERENCES transactions(transaction_id),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    payload_hash TEXT,
    emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    emitted_by_role TEXT NOT NULL,
    correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS event_outbox (
    event_id UUID PRIMARY KEY REFERENCES domain_events(event_id),
    delivered BOOLEAN NOT NULL DEFAULT false,
    delivered_at TIMESTAMPTZ,
    delivery_attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    kafka_partition INT,
    kafka_offset BIGINT
);

CREATE INDEX IF NOT EXISTS idx_domain_events_transaction ON domain_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_event_outbox_undelivered ON event_outbox(delivered) WHERE delivered = false;

-- =============================================================================
-- 5. Documents and evidence
-- =============================================================================
CREATE TABLE IF NOT EXISTS documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    document_type TEXT NOT NULL,
    execution_status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_versions (
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(document_id),
    storage_path TEXT NOT NULL,
    storage_bucket TEXT NOT NULL,
    checksum TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_signatures (
    signature_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_version_id UUID NOT NULL REFERENCES document_versions(version_id),
    signer_id UUID NOT NULL REFERENCES users(user_id),
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 6. Inspections and appraisals
-- =============================================================================
CREATE TABLE IF NOT EXISTS inspections (
    inspection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    inspector_id UUID REFERENCES users(user_id),
    status TEXT NOT NULL DEFAULT 'scheduled',
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inspection_findings (
    finding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES inspections(inspection_id),
    severity TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appraisals (
    appraisal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    appraiser_id UUID REFERENCES users(user_id),
    status TEXT NOT NULL DEFAULT 'pending',
    value_amount DECIMAL(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 6.1 Journey milestone facts (offers, title, escrow, close evidence)
-- =============================================================================

-- Offers and negotiation (authoritative)
CREATE TABLE IF NOT EXISTS offers (
    offer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    parent_offer_id UUID REFERENCES offers(offer_id),
    document_id UUID REFERENCES documents(document_id),
    status TEXT NOT NULL DEFAULT 'SUBMITTED'
      CHECK (status IN ('SUBMITTED', 'COUNTERED', 'WITHDRAWN', 'REJECTED', 'ACCEPTED')),
    terms JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id UUID NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offers_tx_created ON offers(transaction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS offer_decisions (
    decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES offers(offer_id),
    decision TEXT NOT NULL CHECK (decision IN ('ACCEPT', 'REJECT', 'COUNTER', 'WITHDRAW')),
    decided_by_user_id UUID NOT NULL REFERENCES users(user_id),
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_offer_decisions_offer ON offer_decisions(offer_id, decided_at DESC);

-- Escrow & funding (regulated milestone facts)
CREATE TABLE IF NOT EXISTS escrow_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    escrow_officer_id UUID NOT NULL REFERENCES users(user_id),
    assigned_by_user_id UUID NOT NULL REFERENCES users(user_id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_escrow_assignments_tx ON escrow_assignments(transaction_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS earnest_money_deposits (
    deposit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    amount DECIMAL(12, 2),
    confirmed_by_user_id UUID NOT NULL REFERENCES users(user_id),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_earnest_money_tx ON earnest_money_deposits(transaction_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS funding_confirmations (
    confirmation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    confirmed_by_user_id UUID NOT NULL REFERENCES users(user_id),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified BOOLEAN NOT NULL DEFAULT false,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_funding_confirmations_tx ON funding_confirmations(transaction_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS disbursements (
    disbursement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    amount DECIMAL(12, 2),
    recipient TEXT,
    recorded_by_user_id UUID NOT NULL REFERENCES users(user_id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_disbursements_tx ON disbursements(transaction_id, recorded_at DESC);

-- Title, recording, and ownership transfer (regulated milestones)
CREATE TABLE IF NOT EXISTS title_orders (
    title_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    ordered_by_user_id UUID NOT NULL REFERENCES users(user_id),
    ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'ORDERED'
      CHECK (status IN ('ORDERED', 'COMMITMENT_RECEIVED', 'CLEARED', 'EXCEPTIONS_OPEN', 'CANCELLED')),
    insurance_bound_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_title_orders_tx ON title_orders(transaction_id, ordered_at DESC);

CREATE TABLE IF NOT EXISTS title_commitments (
    commitment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    document_id UUID REFERENCES documents(document_id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    exceptions_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_title_commitments_tx ON title_commitments(transaction_id, received_at DESC);

CREATE TABLE IF NOT EXISTS deed_recordings (
    recording_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    document_id UUID REFERENCES documents(document_id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recording_reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_deed_recordings_tx ON deed_recordings(transaction_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS ownership_transfers (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    transferred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_tx ON ownership_transfers(transaction_id, transferred_at DESC);

-- Appraisal waiver (policy/jurisdiction dependent; used by gating)
CREATE TABLE IF NOT EXISTS appraisal_waivers (
    waiver_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    waived_by_user_id UUID NOT NULL REFERENCES users(user_id),
    waived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_appraisal_waivers_tx ON appraisal_waivers(transaction_id, waived_at DESC);

-- =============================================================================
-- 7. AI embeddings (pgvector) — before listings/property_images
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_embeddings (
    embedding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    embedding vector(1536) NOT NULL,
    model_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id, model_id)
);
CREATE INDEX IF NOT EXISTS ai_embeddings_hnsw_idx ON ai_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- =============================================================================
-- 8. Properties and listings
-- =============================================================================
CREATE TABLE IF NOT EXISTS properties (
    property_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    address_line_1 TEXT NOT NULL,
    address_line_2 TEXT,
    city TEXT NOT NULL,
    state_province TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'US',
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location GEOGRAPHY(POINT, 4326),
    parcel_number TEXT,
    county TEXT,
    neighborhood TEXT,
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
    zoning TEXT,
    hoa_name TEXT,
    hoa_monthly_fee DECIMAL(10, 2),
    property_tax_annual DECIMAL(10, 2),
    data_source TEXT NOT NULL DEFAULT 'MANUAL',
    mls_number TEXT,
    attributes JSONB DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION update_property_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude::double precision, NEW.latitude::double precision), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_property_location ON properties;
CREATE TRIGGER trg_update_property_location
    BEFORE INSERT OR UPDATE OF latitude, longitude ON properties
    FOR EACH ROW EXECUTE FUNCTION update_property_location();

CREATE INDEX IF NOT EXISTS idx_properties_location ON properties USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_properties_type_status ON properties (property_type, status);

CREATE TABLE IF NOT EXISTS listings (
    listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(property_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'DRAFT',
    list_price DECIMAL(12, 2) NOT NULL,
    price_currency TEXT NOT NULL DEFAULT 'USD',
    original_list_price DECIMAL(12, 2),
    listing_type TEXT NOT NULL DEFAULT 'FOR_SALE',
    listing_date DATE,
    days_on_market INTEGER DEFAULT 0,
    description TEXT,
    highlights TEXT[],
    listing_agent_id UUID REFERENCES users(user_id),
    listing_broker_id UUID REFERENCES organizations(organization_id),
    is_public BOOLEAN NOT NULL DEFAULT false,
    embedding_id UUID REFERENCES ai_embeddings(embedding_id),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_listings_property ON listings(property_id);
CREATE INDEX IF NOT EXISTS idx_listings_status_price ON listings(status, list_price) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_listings_description_fts ON listings USING GIN (to_tsvector('english', COALESCE(description, '')));

-- Optional open house (Phase B.3): next open house datetime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'listings' AND column_name = 'next_open_house_at') THEN
    ALTER TABLE listings ADD COLUMN next_open_house_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add FKs from transactions → properties/listings after tables exist (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_property') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_property
      FOREIGN KEY (property_id) REFERENCES properties(property_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_listing') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_listing
      FOREIGN KEY (listing_id) REFERENCES listings(listing_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS property_images (
    image_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(property_id),
    listing_id UUID REFERENCES listings(listing_id),
    uploaded_by UUID NOT NULL REFERENCES users(user_id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    storage_path TEXT NOT NULL,
    storage_bucket TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    checksum TEXT NOT NULL,
    thumbnail_path TEXT,
    medium_path TEXT,
    large_path TEXT,
    webp_path TEXT,
    width INTEGER,
    height INTEGER,
    orientation TEXT,
    camera_make TEXT,
    camera_model TEXT,
    taken_at TIMESTAMPTZ,
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    image_type TEXT,
    room_type TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    display_order INTEGER NOT NULL DEFAULT 0,
    caption TEXT,
    ai_tags TEXT[],
    ai_description TEXT,
    ocr_text TEXT,
    ocr_processed_at TIMESTAMPTZ,
    embedding_id UUID REFERENCES ai_embeddings(embedding_id),
    moderation_status TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id);
CREATE INDEX IF NOT EXISTS idx_property_images_listing ON property_images(listing_id) WHERE listing_id IS NOT NULL;

-- =============================================================================
-- 8.1 Showings and property viewings (authoritative scheduling)
-- =============================================================================
CREATE TABLE IF NOT EXISTS showings (
    showing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(listing_id),
    scheduled_start_at TIMESTAMPTZ NOT NULL,
    scheduled_end_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'SCHEDULED'
      CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
    showing_type TEXT NOT NULL DEFAULT 'PRIVATE'
      CHECK (showing_type IN ('PRIVATE', 'OPEN_HOUSE')),
    requested_by_user_id UUID REFERENCES users(user_id),
    created_by_user_id UUID NOT NULL REFERENCES users(user_id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_showings_listing_start ON showings(listing_id, scheduled_start_at DESC);

-- Optional: backfill showing_type for existing DBs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'showings' AND column_name = 'showing_type') THEN
    ALTER TABLE showings ADD COLUMN showing_type TEXT NOT NULL DEFAULT 'PRIVATE';
    ALTER TABLE showings ADD CONSTRAINT showings_showing_type_check CHECK (showing_type IN ('PRIVATE', 'OPEN_HOUSE'));
  END IF;
END $$;

-- Showing feedback (agent/seller feedback after showing; optional structured feedback)
CREATE TABLE IF NOT EXISTS showing_feedback (
    feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(listing_id),
    showing_id UUID NOT NULL REFERENCES showings(showing_id),
    from_user_id UUID NOT NULL REFERENCES users(user_id),
    rating TEXT CHECK (rating IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'NO_SHOW')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (showing_id, from_user_id)
);
CREATE INDEX IF NOT EXISTS idx_showing_feedback_listing ON showing_feedback(listing_id);
CREATE INDEX IF NOT EXISTS idx_showing_feedback_showing ON showing_feedback(showing_id);

-- =============================================================================
-- 9. Audit and compliance
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL,
    actor_id UUID NOT NULL,
    actor_type TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    actor_ip_address INET,
    actor_user_agent TEXT,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    transaction_id UUID REFERENCES transactions(transaction_id),
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    previous_event_hash TEXT,
    event_hash TEXT NOT NULL,
    retention_category TEXT NOT NULL DEFAULT 'standard_6yr',
    retention_until DATE NOT NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id TEXT,
    request_id TEXT
);

CREATE INDEX IF NOT EXISTS audit_events_compliance_idx ON audit_events (transaction_id, occurred_at, event_type);
CREATE INDEX IF NOT EXISTS audit_events_retention_idx ON audit_events (retention_until, legal_hold) WHERE legal_hold = false;

CREATE TABLE IF NOT EXISTS compliance_records (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    content_hash TEXT NOT NULL,
    retention_category TEXT NOT NULL,
    retention_until DATE NOT NULL,
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    legal_hold_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supervision_cases (
    case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(transaction_id),
    flag_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review',
    flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewer_id UUID REFERENCES users(user_id),
    reviewed_at TIMESTAMPTZ,
    decision TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 10. Document processing (derived)
-- =============================================================================
CREATE TABLE IF NOT EXISTS document_text (
    document_version_id UUID PRIMARY KEY REFERENCES document_versions(version_id),
    extracted_text TEXT NOT NULL,
    extraction_method TEXT NOT NULL,
    page_count INTEGER,
    word_count INTEGER NOT NULL,
    extraction_metadata JSONB,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
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

-- =============================================================================
-- 11. Messaging
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS messaging;

CREATE TABLE IF NOT EXISTS messaging.chat_rooms (
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

CREATE TABLE IF NOT EXISTS messaging.chat_room_members (
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

CREATE TABLE IF NOT EXISTS messaging.messages (
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

CREATE TABLE IF NOT EXISTS messaging.chat_attachments (
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

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messaging.messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_transaction ON messaging.chat_rooms(transaction_id) WHERE transaction_id IS NOT NULL;

-- Helper: INSERT chat_room and return row. SECURITY DEFINER so INSERT passes RLS (caller still supplies created_by;
-- API only passes current user, so authorization is preserved).
CREATE OR REPLACE FUNCTION messaging.insert_chat_room(
  p_room_id UUID,
  p_room_type TEXT,
  p_transaction_id UUID,
  p_name TEXT,
  p_created_by UUID
) RETURNS SETOF messaging.chat_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = messaging
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO messaging.chat_rooms (room_id, room_type, transaction_id, name, created_by)
  VALUES (p_room_id, p_room_type, p_transaction_id, p_name, p_created_by)
  RETURNING *;
END;
$$;

-- Helper: INSERT chat_room_member so room creator can add members (RLS blocks otherwise).
-- Caller must pass added_by_user_id (current user); function allows if creator or adding self.
CREATE OR REPLACE FUNCTION messaging.insert_chat_room_member(
  p_room_id UUID,
  p_user_id UUID,
  p_role TEXT,
  p_added_by_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = messaging
AS $$
BEGIN
  IF p_user_id = p_added_by_user_id THEN
    NULL;  /* adding self (e.g. OWNER) */
  ELSIF NOT (EXISTS (
    SELECT 1 FROM messaging.chat_rooms r
    WHERE r.room_id = p_room_id AND r.created_by = p_added_by_user_id
  )) THEN
    RAISE EXCEPTION 'Only room creator can add other members';
  END IF;
  INSERT INTO messaging.chat_room_members (room_id, user_id, role)
  VALUES (p_room_id, p_user_id, p_role)
  ON CONFLICT (room_id, user_id) DO NOTHING;
END;
$$;

-- Helper: DELETE chat_room_member so room creator can remove others (RLS only allows seeing own row).
CREATE OR REPLACE FUNCTION messaging.delete_chat_room_member(
  p_room_id UUID,
  p_user_id UUID,
  p_removed_by_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = messaging
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_user_id = p_removed_by_user_id THEN
    NULL;  /* removing self */
  ELSIF NOT (EXISTS (
    SELECT 1 FROM messaging.chat_rooms r
    WHERE r.room_id = p_room_id AND r.created_by = p_removed_by_user_id
  )) THEN
    RAISE EXCEPTION 'Only room creator or the member can remove';
  END IF;
  UPDATE messaging.chat_room_members
  SET left_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id AND left_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'ChatRoomMember not found';
  END IF;
END;
$$;

-- =============================================================================
-- 12. Buyer preferences and matching
-- =============================================================================
CREATE TABLE IF NOT EXISTS buyer_preferences (
    preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    preferred_cities TEXT[],
    preferred_states TEXT[],
    preferred_zip_codes TEXT[],
    max_commute_minutes INTEGER,
    commute_destination_lat DECIMAL(10, 8),
    commute_destination_lng DECIMAL(11, 8),
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
    must_have_pool BOOLEAN,
    must_have_garage BOOLEAN,
    must_have_yard BOOLEAN,
    must_have_view BOOLEAN,
    nice_to_have JSONB DEFAULT '{}',
    lifestyle_description TEXT,
    preference_embedding_id UUID REFERENCES ai_embeddings(embedding_id),
    notification_frequency TEXT NOT NULL DEFAULT 'DAILY' CHECK (notification_frequency IN ('INSTANT', 'DAILY', 'WEEKLY', 'NONE'))
);

CREATE TABLE IF NOT EXISTS property_matches (
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

CREATE INDEX IF NOT EXISTS idx_buyer_preferences_user ON buyer_preferences(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_property_matches_user_score ON property_matches(user_id, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_property_matches_listing ON property_matches(listing_id);

-- Saved listings (user bookmarks; no preference required)
CREATE TABLE IF NOT EXISTS saved_listings (
    user_id UUID NOT NULL REFERENCES users(user_id),
    listing_id UUID NOT NULL REFERENCES listings(listing_id),
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_listings_user ON saved_listings(user_id);

-- =============================================================================
-- 13. Row-Level Security (06-authorization-and-data-access, 08-database-schema)
--     Fail-closed: policies require app.user_id etc. NULL/empty = deny.
--     Explicit deny: lender MUST NOT see inspection_report documents.
-- =============================================================================

-- transactions: party + org + jurisdiction (optional license_state) INSERT for create
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tx_visibility_policy ON transactions;
CREATE POLICY tx_visibility_policy ON transactions
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  -- Explicit deny (06): BUYER/BUYER_AGENT must NOT see PRE_LISTING (seller-side only).
  AND NOT (
    lower(COALESCE(current_setting('app.role', true), '')) IN ('buyer', 'buyer_agent')
    AND transactions.current_state = 'PRE_LISTING'
  )
  AND (
    (
      transactions.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND (
        (transactions.jurisdiction IS NULL)
        OR (current_setting('app.license_state', true) IS NULL OR current_setting('app.license_state', true) = '')
        OR (transactions.jurisdiction = current_setting('app.license_state', true))
      )
      AND EXISTS (
        SELECT 1 FROM transaction_parties tp
        WHERE tp.transaction_id = transactions.transaction_id
          AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      )
    )
    OR (
      -- LISTED transactions may be browsed to submit offers when backed by a public listing
      transactions.current_state = 'LISTED'
      AND transactions.listing_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM listings l
        WHERE l.listing_id = transactions.listing_id
          AND l.is_public = true
      )
    )
  )
);
DROP POLICY IF EXISTS tx_insert_policy ON transactions;
CREATE POLICY tx_insert_policy ON transactions
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND organization_id = (current_setting('app.organization_id', true)::uuid)
);

DROP POLICY IF EXISTS tx_update_policy ON transactions;
CREATE POLICY tx_update_policy ON transactions
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND organization_id = (current_setting('app.organization_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM transaction_parties tp
    WHERE tp.transaction_id = transactions.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
  )
);

-- transaction_parties: same org caller sees parties for transactions they can see can add self as party
ALTER TABLE transaction_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_parties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tx_parties_visibility_policy ON transaction_parties;
CREATE POLICY tx_parties_visibility_policy ON transaction_parties
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  -- Avoid RLS recursion: party rows are visible to the subject only.
  -- Transaction visibility itself is enforced on `transactions` (tx_visibility_policy).
  AND transaction_parties.user_id = (current_setting('app.user_id', true)::uuid)
);
DROP POLICY IF EXISTS tx_parties_insert_policy ON transaction_parties;
CREATE POLICY tx_parties_insert_policy ON transaction_parties
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND organization_id = (current_setting('app.organization_id', true)::uuid)
  AND user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.transaction_id = transaction_parties.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);

-- documents: inherit transaction visibility + EXPLICIT DENY lender → inspection_report
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_visibility_policy ON documents;
CREATE POLICY document_visibility_policy ON documents
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND NOT (
    lower(COALESCE(document_type, '')) = 'inspection_report'
    AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender'
  )
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = documents.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);

-- document_versions: inherit from documents
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_versions_visibility_policy ON document_versions;
CREATE POLICY document_versions_visibility_policy ON document_versions
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM documents d
    JOIN transactions t ON t.transaction_id = d.transaction_id
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE d.document_id = document_versions.document_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND NOT (lower(COALESCE(d.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  )
);

-- inspections: inspector or party (buyer, buyer_agent, seller, seller_agent, escrow_officer) — lender denied by document policy
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspection_policy ON inspections;
CREATE POLICY inspection_policy ON inspections
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    (lower(COALESCE(current_setting('app.role', true), '')) = 'inspector' AND inspections.inspector_id = (current_setting('app.user_id', true)::uuid))
    OR EXISTS (
      SELECT 1 FROM transaction_parties tp
      WHERE tp.transaction_id = inspections.transaction_id
        AND tp.user_id = (current_setting('app.user_id', true)::uuid)
        AND tp.role IN ('BUYER', 'BUYER_AGENT', 'SELLER', 'SELLER_AGENT', 'ESCROW_OFFICER')
    )
  )
);

-- inspection_findings: inherit from inspections
ALTER TABLE inspection_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_findings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspection_findings_policy ON inspection_findings;
CREATE POLICY inspection_findings_policy ON inspection_findings
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM inspections i
    JOIN transaction_parties tp ON tp.transaction_id = i.transaction_id
    WHERE i.inspection_id = inspection_findings.inspection_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND (lower(COALESCE(current_setting('app.role', true), '')) = 'inspector' AND i.inspector_id = (current_setting('app.user_id', true)::uuid)
           OR tp.role IN ('BUYER', 'BUYER_AGENT', 'SELLER', 'SELLER_AGENT', 'ESCROW_OFFICER'))
  )
);

-- appraisals: party to transaction
ALTER TABLE appraisals ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appraisals_policy ON appraisals;
CREATE POLICY appraisals_policy ON appraisals
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transaction_parties tp
    WHERE tp.transaction_id = appraisals.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
  )
);

-- offers: transaction-scoped; allow party reads; allow offer submission into LISTED by BUYER/BUYER_AGENT (bind party in command)
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offers_visibility ON offers;
CREATE POLICY offers_visibility ON offers
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1
    FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = offers.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS offers_insert ON offers;
CREATE POLICY offers_insert ON offers
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND created_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1
    FROM transactions t
    WHERE t.transaction_id = offers.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND (
        EXISTS (
          SELECT 1 FROM transaction_parties tp
          WHERE tp.transaction_id = t.transaction_id AND tp.user_id = (current_setting('app.user_id', true)::uuid)
        )
        OR (
          t.current_state = 'LISTED'
          AND current_setting('app.role', true) IN ('BUYER', 'BUYER_AGENT')
        )
      )
  )
);

-- offer_decisions: inherit from offers
ALTER TABLE offer_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS offer_decisions_visibility ON offer_decisions;
CREATE POLICY offer_decisions_visibility ON offer_decisions
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1
    FROM offers o
    JOIN transactions t ON t.transaction_id = o.transaction_id
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE o.offer_id = offer_decisions.offer_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS offer_decisions_insert ON offer_decisions;
CREATE POLICY offer_decisions_insert ON offer_decisions
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND decided_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM offers o
    WHERE o.offer_id = offer_decisions.offer_id
  )
);

-- escrow/funding regulated milestone facts: transaction party visibility
ALTER TABLE escrow_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS escrow_assignments_policy ON escrow_assignments;
CREATE POLICY escrow_assignments_policy ON escrow_assignments
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = escrow_assignments.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS escrow_assignments_insert ON escrow_assignments;
CREATE POLICY escrow_assignments_insert ON escrow_assignments
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND assigned_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.transaction_id = escrow_assignments.transaction_id AND t.organization_id = (current_setting('app.organization_id', true)::uuid))
);

ALTER TABLE earnest_money_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnest_money_deposits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS earnest_money_policy ON earnest_money_deposits;
CREATE POLICY earnest_money_policy ON earnest_money_deposits
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = earnest_money_deposits.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS earnest_money_insert ON earnest_money_deposits;
CREATE POLICY earnest_money_insert ON earnest_money_deposits
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND confirmed_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.transaction_id = earnest_money_deposits.transaction_id AND t.organization_id = (current_setting('app.organization_id', true)::uuid))
);

-- REGULATED (06 §3, 18 §6): funding_confirmations restricted to ESCROW_OFFICER/LENDER read, ESCROW_OFFICER write; state-gated INSERT (CLEAR_TO_CLOSE/CLOSED).
ALTER TABLE funding_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_confirmations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funding_confirmations_policy ON funding_confirmations;
CREATE POLICY funding_confirmations_policy ON funding_confirmations
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) IN ('ESCROW_OFFICER', 'LENDER')
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = funding_confirmations.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS funding_confirmations_insert ON funding_confirmations;
CREATE POLICY funding_confirmations_insert ON funding_confirmations
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND confirmed_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.transaction_id = funding_confirmations.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND t.current_state IN ('CLEAR_TO_CLOSE', 'CLOSED')
  )
);

-- REGULATED (06 §3, 18 §6): disbursements restricted to ESCROW_OFFICER only; state-gated INSERT (CLEAR_TO_CLOSE/CLOSED).
ALTER TABLE disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE disbursements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS disbursements_policy ON disbursements;
CREATE POLICY disbursements_policy ON disbursements
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = disbursements.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS disbursements_insert ON disbursements;
CREATE POLICY disbursements_insert ON disbursements
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND recorded_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.transaction_id = disbursements.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND t.current_state IN ('CLEAR_TO_CLOSE', 'CLOSED')
  )
);

-- title/recording/transfer milestone facts: transaction party visibility
ALTER TABLE title_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS title_orders_policy ON title_orders;
CREATE POLICY title_orders_policy ON title_orders
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = title_orders.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS title_orders_insert ON title_orders;
CREATE POLICY title_orders_insert ON title_orders
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND ordered_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.transaction_id = title_orders.transaction_id AND t.organization_id = (current_setting('app.organization_id', true)::uuid))
);

DROP POLICY IF EXISTS title_orders_update ON title_orders;
CREATE POLICY title_orders_update ON title_orders
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND ordered_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.transaction_id = title_orders.transaction_id AND t.organization_id = (current_setting('app.organization_id', true)::uuid))
);

ALTER TABLE title_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_commitments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS title_commitments_policy ON title_commitments;
CREATE POLICY title_commitments_policy ON title_commitments
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = title_commitments.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS title_commitments_insert ON title_commitments;
CREATE POLICY title_commitments_insert ON title_commitments
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.transaction_id = title_commitments.transaction_id AND t.organization_id = (current_setting('app.organization_id', true)::uuid))
);

-- REGULATED (06 §3, 18 §6): deed_recordings restricted to ESCROW_OFFICER only; state-gated INSERT (CLEAR_TO_CLOSE/CLOSED).
ALTER TABLE deed_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE deed_recordings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deed_recordings_policy ON deed_recordings;
CREATE POLICY deed_recordings_policy ON deed_recordings
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = deed_recordings.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS deed_recordings_insert ON deed_recordings;
CREATE POLICY deed_recordings_insert ON deed_recordings
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.transaction_id = deed_recordings.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND t.current_state IN ('CLEAR_TO_CLOSE', 'CLOSED')
  )
);

-- REGULATED (06 §3, 18 §6): ownership_transfers restricted to ESCROW_OFFICER only; state-gated INSERT (CLEAR_TO_CLOSE/CLOSED).
ALTER TABLE ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ownership_transfers_policy ON ownership_transfers;
CREATE POLICY ownership_transfers_policy ON ownership_transfers
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = ownership_transfers.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS ownership_transfers_insert ON ownership_transfers;
CREATE POLICY ownership_transfers_insert ON ownership_transfers
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND current_setting('app.role', true) = 'ESCROW_OFFICER'
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.transaction_id = ownership_transfers.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND t.current_state IN ('CLEAR_TO_CLOSE', 'CLOSED')
  )
);

ALTER TABLE appraisal_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appraisal_waivers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appraisal_waivers_policy ON appraisal_waivers;
CREATE POLICY appraisal_waivers_policy ON appraisal_waivers
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = appraisal_waivers.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS appraisal_waivers_insert ON appraisal_waivers;
CREATE POLICY appraisal_waivers_insert ON appraisal_waivers
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND waived_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (SELECT 1 FROM transactions t WHERE t.transaction_id = appraisal_waivers.transaction_id AND t.organization_id = (current_setting('app.organization_id', true)::uuid))
);

-- document_chunks: inherit from document_versions -> documents
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_chunks_visibility ON document_chunks;
CREATE POLICY document_chunks_visibility ON document_chunks
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM document_versions dv
    JOIN documents d ON d.document_id = dv.document_id
    JOIN transaction_parties tp ON tp.transaction_id = d.transaction_id
    WHERE dv.version_id = document_chunks.document_version_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND NOT (lower(COALESCE(d.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  )
);

-- command_dedup: actor and org scoped
ALTER TABLE command_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_dedup FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS command_dedup_policy ON command_dedup;
CREATE POLICY command_dedup_policy ON command_dedup
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND organization_id = (current_setting('app.organization_id', true)::uuid)
  AND actor_id = (current_setting('app.user_id', true)::uuid)
);

-- domain_events: same visibility as transactions
ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS domain_events_policy ON domain_events;
CREATE POLICY domain_events_policy ON domain_events
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    domain_events.transaction_id IS NULL
    OR EXISTS (
      SELECT 1 FROM transactions t
      JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
      WHERE t.transaction_id = domain_events.transaction_id
        AND tp.user_id = (current_setting('app.user_id', true)::uuid)
        AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
    )
  )
);

-- event_outbox: same as domain_events (event_id references domain_events)
ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_outbox_policy ON event_outbox;
CREATE POLICY event_outbox_policy ON event_outbox
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM domain_events de
    LEFT JOIN transactions t ON t.transaction_id = de.transaction_id
    LEFT JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id AND tp.user_id = (current_setting('app.user_id', true)::uuid)
    WHERE de.event_id = event_outbox.event_id
      AND (de.transaction_id IS NULL OR (t.transaction_id IS NOT NULL AND tp.user_id IS NOT NULL AND t.organization_id = (current_setting('app.organization_id', true)::uuid)))
  )
);

-- ai_embeddings: 08 says inherit from entity minimal fail-closed (user_id required).
-- Production SHOULD restrict by entity_type/entity_id (e.g. listing → listings RLS, document → documents RLS).
ALTER TABLE ai_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_embeddings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_embeddings_policy ON ai_embeddings;
CREATE POLICY ai_embeddings_policy ON ai_embeddings
USING (current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != '');

-- buyer_preferences: owner only
ALTER TABLE buyer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS buyer_preferences_policy ON buyer_preferences;
CREATE POLICY buyer_preferences_policy ON buyer_preferences
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);

-- property_matches: owner only
ALTER TABLE property_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_matches_policy ON property_matches;
CREATE POLICY property_matches_policy ON property_matches
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    -- Buyer sees their own matches.
    user_id = (current_setting('app.user_id', true)::uuid)
    -- Listing agent/broker can see interested buyers for their listings (agent view).
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.listing_id = property_matches.listing_id
        AND (
          l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
          OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
        )
    )
  )
);

-- saved_listings: owner only (save/unsave own bookmarks)
ALTER TABLE saved_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_listings_select ON saved_listings;
CREATE POLICY saved_listings_select ON saved_listings FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);
DROP POLICY IF EXISTS saved_listings_insert ON saved_listings;
CREATE POLICY saved_listings_insert ON saved_listings FOR INSERT
WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);
DROP POLICY IF EXISTS saved_listings_delete ON saved_listings;
CREATE POLICY saved_listings_delete ON saved_listings FOR DELETE
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);

-- subject_attributes: own attributes only (ABAC subject attributes; 06)
ALTER TABLE subject_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_attributes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subject_attributes_policy ON subject_attributes;
CREATE POLICY subject_attributes_policy ON subject_attributes
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);
DROP POLICY IF EXISTS subject_attributes_insert ON subject_attributes;
CREATE POLICY subject_attributes_insert ON subject_attributes
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);
DROP POLICY IF EXISTS subject_attributes_update ON subject_attributes;
CREATE POLICY subject_attributes_update ON subject_attributes
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);

-- organization_members: same-org visibility only (Phase B.5 escrow picker)
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_members_select ON organization_members;
CREATE POLICY organization_members_select ON organization_members
FOR SELECT USING (
  current_setting('app.organization_id', true) IS NOT NULL AND current_setting('app.organization_id', true) != ''
  AND organization_id = (current_setting('app.organization_id', true)::uuid)
);

-- messaging.chat_rooms: member or transaction party
ALTER TABLE messaging.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.chat_rooms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_room_access ON messaging.chat_rooms;
CREATE POLICY chat_room_access ON messaging.chat_rooms
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    EXISTS (
      SELECT 1 FROM messaging.chat_room_members m
      WHERE m.room_id = chat_rooms.room_id AND m.user_id = (current_setting('app.user_id', true)::uuid) AND m.left_at IS NULL
    )
    OR (
      room_type = 'TRANSACTION' AND transaction_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM transaction_parties tp
        WHERE tp.transaction_id = chat_rooms.transaction_id AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      )
    )
  )
);

-- Allow creating/updating rooms under RLS (non-superuser app_user).
DROP POLICY IF EXISTS chat_room_insert ON messaging.chat_rooms;
CREATE POLICY chat_room_insert ON messaging.chat_rooms
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND created_by = (current_setting('app.user_id', true)::uuid)
  AND (
    room_type != 'TRANSACTION'
    OR (
      transaction_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM transaction_parties tp
        WHERE tp.transaction_id = transaction_id
          AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      )
    )
  )
);

DROP POLICY IF EXISTS chat_room_update ON messaging.chat_rooms;
CREATE POLICY chat_room_update ON messaging.chat_rooms
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    created_by = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM messaging.chat_room_members m
      WHERE m.room_id = chat_rooms.room_id
        AND m.user_id = (current_setting('app.user_id', true)::uuid)
        AND m.left_at IS NULL
    )
  )
);

-- messaging.chat_room_members: see members of rooms you're in
ALTER TABLE messaging.chat_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.chat_room_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_room_members_policy ON messaging.chat_room_members;
CREATE POLICY chat_room_members_policy ON messaging.chat_room_members
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  -- Avoid RLS recursion with chat_rooms: member rows are visible to the subject only.
  AND chat_room_members.user_id = (current_setting('app.user_id', true)::uuid)
);

-- Allow room creator to invite/remove members; members can update their own row (mark-read, mute).
DROP POLICY IF EXISTS chat_room_members_insert ON messaging.chat_room_members;
CREATE POLICY chat_room_members_insert ON messaging.chat_room_members
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    chat_room_members.user_id = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM messaging.chat_rooms r
      WHERE r.room_id = chat_room_members.room_id
        AND r.created_by = (current_setting('app.user_id', true)::uuid)
    )
  )
);

DROP POLICY IF EXISTS chat_room_members_update ON messaging.chat_room_members;
CREATE POLICY chat_room_members_update ON messaging.chat_room_members
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND chat_room_members.user_id = (current_setting('app.user_id', true)::uuid)
);

DROP POLICY IF EXISTS chat_room_members_delete ON messaging.chat_room_members;
CREATE POLICY chat_room_members_delete ON messaging.chat_room_members
FOR DELETE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    chat_room_members.user_id = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM messaging.chat_rooms r
      WHERE r.room_id = chat_room_members.room_id
        AND r.created_by = (current_setting('app.user_id', true)::uuid)
    )
  )
);

-- messaging.messages: room visibility
ALTER TABLE messaging.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_access ON messaging.messages;
CREATE POLICY message_access ON messaging.messages
FOR SELECT
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM messaging.chat_rooms r
    WHERE r.room_id = room_id
      AND (
        EXISTS (SELECT 1 FROM messaging.chat_room_members m WHERE m.room_id = r.room_id AND m.user_id = (current_setting('app.user_id', true)::uuid) AND m.left_at IS NULL)
        OR (r.room_type = 'TRANSACTION' AND r.transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM transaction_parties tp WHERE tp.transaction_id = r.transaction_id AND tp.user_id = (current_setting('app.user_id', true)::uuid)))
  )
  )
);

DROP POLICY IF EXISTS message_insert ON messaging.messages;
CREATE POLICY message_insert ON messaging.messages
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND sender_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM messaging.chat_rooms r
    WHERE r.room_id = messaging.messages.room_id
      AND (
        EXISTS (
          SELECT 1 FROM messaging.chat_room_members m
          WHERE m.room_id = r.room_id
            AND m.user_id = (current_setting('app.user_id', true)::uuid)
            AND m.left_at IS NULL
        )
        OR (
          r.room_type = 'TRANSACTION'
          AND r.transaction_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM transaction_parties tp
            WHERE tp.transaction_id = r.transaction_id
              AND tp.user_id = (current_setting('app.user_id', true)::uuid)
          )
        )
      )
  )
);

DROP POLICY IF EXISTS message_update ON messaging.messages;
CREATE POLICY message_update ON messaging.messages
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND sender_id = (current_setting('app.user_id', true)::uuid)
);

-- messaging.chat_attachments: inherit from messages
ALTER TABLE messaging.chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.chat_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_attachments_policy ON messaging.chat_attachments;
CREATE POLICY chat_attachments_policy ON messaging.chat_attachments
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM messaging.messages msg
    JOIN messaging.chat_rooms r ON r.room_id = msg.room_id
    WHERE msg.message_id = chat_attachments.message_id
      AND (EXISTS (SELECT 1 FROM messaging.chat_room_members m WHERE m.room_id = r.room_id AND m.user_id = (current_setting('app.user_id', true)::uuid) AND m.left_at IS NULL)
           OR (r.room_type = 'TRANSACTION' AND r.transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM transaction_parties tp WHERE tp.transaction_id = r.transaction_id AND tp.user_id = (current_setting('app.user_id', true)::uuid)))
  )
  )
);

-- =============================================================================
-- 14. Additional RLS: tables that MUST be protected for FINRA/SOC2 (06, 08)
--     - transaction_state_history, document_text, document_signatures
--     - users, organizations (identity/tenant isolation)
--     - properties, listings, property_images (org/agent/public visibility)
--     - audit_events, compliance_records, supervision_cases (compliance)
--     - transaction_states / transaction_state_transitions (reference, read-only)
-- =============================================================================

-- transaction_state_history: same visibility as transactions (party + org + jurisdiction)
ALTER TABLE transaction_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_state_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tx_history_policy ON transaction_state_history;
CREATE POLICY tx_history_policy ON transaction_state_history
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = transaction_state_history.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND (
        (t.jurisdiction IS NULL)
        OR (current_setting('app.license_state', true) IS NULL OR current_setting('app.license_state', true) = '')
        OR (t.jurisdiction = current_setting('app.license_state', true))
      )
  )
);

-- document_text: inherit from document_versions -> documents; explicit deny lender -> inspection_report
ALTER TABLE document_text ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_text FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_text_visibility ON document_text;
CREATE POLICY document_text_visibility ON document_text
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM document_versions dv
    JOIN documents d ON d.document_id = dv.document_id
    JOIN transaction_parties tp ON tp.transaction_id = d.transaction_id
    WHERE dv.version_id = document_text.document_version_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND NOT (lower(COALESCE(d.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  )
);

-- document_signatures: inherit from document_versions -> documents (same as document_versions + lender deny)
ALTER TABLE document_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_signatures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_signatures_visibility ON document_signatures;
CREATE POLICY document_signatures_visibility ON document_signatures
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM document_versions dv
    JOIN documents d ON d.document_id = dv.document_id
    JOIN transaction_parties tp ON tp.transaction_id = d.transaction_id
    WHERE dv.version_id = document_signatures.document_version_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND NOT (lower(COALESCE(d.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  )
);

-- document_signatures: INSERT when caller is transaction party and signer is self (06, 09 — sign document command)
DROP POLICY IF EXISTS document_signatures_insert_policy ON document_signatures;
CREATE POLICY document_signatures_insert_policy ON document_signatures
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND document_signatures.signer_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM document_versions dv
    JOIN documents d ON d.document_id = dv.document_id
    JOIN transaction_parties tp ON tp.transaction_id = d.transaction_id
    WHERE dv.version_id = document_signatures.document_version_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND NOT (lower(COALESCE(d.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  )
);

-- users: read own row only; or same-org members (for directory/escrow picker — 06, 08)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_own_row ON users;
CREATE POLICY users_own_row ON users
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND user_id = (current_setting('app.user_id', true)::uuid)
);
DROP POLICY IF EXISTS users_same_org_members ON users;
CREATE POLICY users_same_org_members ON users
FOR SELECT USING (
  current_setting('app.organization_id', true) IS NOT NULL AND current_setting('app.organization_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.user_id = users.user_id
      AND om.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);

-- organizations: read current org only (tenant isolation)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_current ON organizations;
CREATE POLICY org_current ON organizations
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND organization_id = (current_setting('app.organization_id', true)::uuid)
);

-- transaction_states / transaction_state_transitions: reference data; authenticated read-only
ALTER TABLE transaction_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tx_states_read ON transaction_states;
CREATE POLICY tx_states_read ON transaction_states
USING (current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != '');

ALTER TABLE transaction_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_state_transitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tx_transitions_read ON transaction_state_transitions;
CREATE POLICY tx_transitions_read ON transaction_state_transitions
USING (current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != '');

-- properties: visible if linked to a public listing or listing owned by caller/org (09.10)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS properties_visibility ON properties;
CREATE POLICY properties_visibility ON properties
USING (
  -- NOTE: Properties are referenced by public listings and pre-listing workflows.
  -- In dev/test, keep this permissive to avoid "unlisted property is invisible" issues.
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
);
DROP POLICY IF EXISTS properties_insert ON properties;
CREATE POLICY properties_insert ON properties
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
);
DROP POLICY IF EXISTS properties_update ON properties;
CREATE POLICY properties_update ON properties
FOR UPDATE USING (
  -- Dev/test: allow authenticated updates (prod should scope this to agent/broker/owners).
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
);

-- listings: public or listing_agent or listing_broker org (06, 08)
-- BUYER/BUYER_AGENT: explicit restrict to is_public = true AND status != DRAFT (no broker/agent bypass).
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS listings_visibility ON listings;
CREATE POLICY listings_visibility ON listings
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    -- BUYER/BUYER_AGENT may only see public, non-draft listings (no access via broker/agent).
    (
      lower(COALESCE(current_setting('app.role', true), '')) IN ('buyer', 'buyer_agent')
      AND listings.is_public = true
      AND listings.status != 'DRAFT'
    )
    OR
    -- All other roles: public OR listing agent OR listing broker org.
    (
      lower(COALESCE(current_setting('app.role', true), '')) NOT IN ('buyer', 'buyer_agent')
      AND (
        listings.is_public = true
        OR listings.listing_agent_id = (current_setting('app.user_id', true)::uuid)
        OR listings.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
      )
    )
  )
);
DROP POLICY IF EXISTS listings_insert ON listings;
CREATE POLICY listings_insert ON listings
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (listings.listing_agent_id = (current_setting('app.user_id', true)::uuid)
       OR listings.listing_broker_id = (current_setting('app.organization_id', true)::uuid))
);
DROP POLICY IF EXISTS listings_update ON listings;
CREATE POLICY listings_update ON listings
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (listings.listing_agent_id = (current_setting('app.user_id', true)::uuid)
       OR listings.listing_broker_id = (current_setting('app.organization_id', true)::uuid))
);

-- property_images: visible if property/listing visible or uploaded by caller
ALTER TABLE property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_images_visibility ON property_images;
CREATE POLICY property_images_visibility ON property_images
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    property_images.uploaded_by = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.property_id = property_images.property_id
        AND (l.is_public = true
             OR l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
             OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid))
    )
  )
);
DROP POLICY IF EXISTS property_images_insert ON property_images;
CREATE POLICY property_images_insert ON property_images
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND uploaded_by = (current_setting('app.user_id', true)::uuid)
);

DROP POLICY IF EXISTS property_images_update ON property_images;
CREATE POLICY property_images_update ON property_images
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    property_images.uploaded_by = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.property_id = property_images.property_id
        AND (
          l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
          OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
        )
    )
  )
);

DROP POLICY IF EXISTS property_images_delete ON property_images;
CREATE POLICY property_images_delete ON property_images
FOR DELETE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    property_images.uploaded_by = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.property_id = property_images.property_id
        AND (
          l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
          OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
        )
    )
  )
);

-- showings: visible if listing is visible (public/agent/broker) or user is requester/creator
-- Explicit deny (06): LENDER must NOT see showings via listing path (avoids buyer-identity side-channel)
ALTER TABLE showings ENABLE ROW LEVEL SECURITY;
ALTER TABLE showings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS showings_visibility ON showings;
CREATE POLICY showings_visibility ON showings
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    showings.created_by_user_id = (current_setting('app.user_id', true)::uuid)
    OR showings.requested_by_user_id = (current_setting('app.user_id', true)::uuid)
    OR (
      lower(COALESCE(current_setting('app.role', true), '')) != 'lender'
      AND EXISTS (
        SELECT 1 FROM listings l
        WHERE l.listing_id = showings.listing_id
          AND (
            l.is_public = true
            OR l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
            OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
          )
      )
    )
  )
);
DROP POLICY IF EXISTS showings_insert ON showings;
CREATE POLICY showings_insert ON showings
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND created_by_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM listings l
    WHERE l.listing_id = showings.listing_id
      AND (
        l.is_public = true
        OR l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
        OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
      )
  )
);
DROP POLICY IF EXISTS showings_update ON showings;
CREATE POLICY showings_update ON showings
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    showings.created_by_user_id = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM listings l
      WHERE l.listing_id = showings.listing_id
        AND (
          l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
          OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
        )
    )
  )
);

-- showing_feedback: visible to same as showings; insert by listing agent/broker
ALTER TABLE showing_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE showing_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS showing_feedback_select ON showing_feedback;
CREATE POLICY showing_feedback_select ON showing_feedback
FOR SELECT USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    showing_feedback.from_user_id = (current_setting('app.user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM showings s
      JOIN listings l ON l.listing_id = s.listing_id
      WHERE s.showing_id = showing_feedback.showing_id
        AND (
          s.created_by_user_id = (current_setting('app.user_id', true)::uuid)
          OR s.requested_by_user_id = (current_setting('app.user_id', true)::uuid)
          OR (lower(COALESCE(current_setting('app.role', true), '')) != 'lender' AND (l.is_public = true OR l.listing_agent_id = (current_setting('app.user_id', true)::uuid) OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)))
        )
    )
  )
);
DROP POLICY IF EXISTS showing_feedback_insert ON showing_feedback;
CREATE POLICY showing_feedback_insert ON showing_feedback
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND from_user_id = (current_setting('app.user_id', true)::uuid)
  AND EXISTS (
    SELECT 1 FROM listings l
    WHERE l.listing_id = showing_feedback.listing_id
      AND (
        l.listing_agent_id = (current_setting('app.user_id', true)::uuid)
        OR l.listing_broker_id = (current_setting('app.organization_id', true)::uuid)
      )
  )
);


-- audit_events: append-only; read only own-actor or transaction-scoped (SOC 2 CC6.8, FINRA 4511).
-- Production MUST: REVOKE UPDATE, DELETE ON audit_events FROM app_user (WORM).
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_select ON audit_events;
CREATE POLICY audit_events_select ON audit_events
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    audit_events.actor_id = (current_setting('app.user_id', true)::uuid)
    OR (
      audit_events.transaction_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM transaction_parties tp
        WHERE tp.transaction_id = audit_events.transaction_id
          AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      )
    )
  )
);
DROP POLICY IF EXISTS audit_events_insert ON audit_events;
CREATE POLICY audit_events_insert ON audit_events
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND audit_events.actor_id = (current_setting('app.user_id', true)::uuid)
);

-- compliance_records: read by same-org / transaction visibility (FINRA 4511).
-- Production MUST: REVOKE UPDATE, DELETE ON compliance_records FROM app_user (WORM).
ALTER TABLE compliance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compliance_records_policy ON compliance_records;
CREATE POLICY compliance_records_policy ON compliance_records
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    (compliance_records.entity_type = 'transaction' AND compliance_records.entity_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM transactions t
       JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
       WHERE t.transaction_id = compliance_records.entity_id
         AND tp.user_id = (current_setting('app.user_id', true)::uuid)
         AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
     ))
    OR compliance_records.entity_type != 'transaction'
  )
);

-- supervision_cases: same visibility as transactions (FINRA 3110)
ALTER TABLE supervision_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_cases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supervision_cases_policy ON supervision_cases;
CREATE POLICY supervision_cases_policy ON supervision_cases
USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = supervision_cases.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS supervision_cases_insert ON supervision_cases;
CREATE POLICY supervision_cases_insert ON supervision_cases
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = supervision_cases.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
  )
);

-- =============================================================================
-- 15. INSERT/UPDATE policies for tables that had only SELECT (06, 08)
--     Ensures API commands can write only when relationship + role allow.
-- =============================================================================

-- documents: INSERT when caller is transaction party
DROP POLICY IF EXISTS document_insert_policy ON documents;
CREATE POLICY document_insert_policy ON documents
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transactions t
    WHERE t.transaction_id = documents.transaction_id
      AND t.organization_id = (current_setting('app.organization_id', true)::uuid)
      AND NOT (lower(COALESCE(documents.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
      AND (
        (
          EXISTS (
            SELECT 1 FROM transaction_parties tp
            WHERE tp.transaction_id = t.transaction_id
              AND tp.user_id = (current_setting('app.user_id', true)::uuid)
          )
          AND (
            lower(COALESCE(documents.document_type, '')) != 'appraisal_report'
            OR current_setting('app.role', true) IN ('LENDER', 'ESCROW_OFFICER', 'APPRAISER')
          )
        )
        OR (
          lower(COALESCE(documents.document_type, '')) = 'offer'
          AND t.current_state = 'LISTED'
          AND current_setting('app.role', true) IN ('BUYER', 'BUYER_AGENT')
        )
        OR (
          lower(COALESCE(documents.document_type, '')) = 'purchase_agreement'
          AND t.current_state = 'OFFER_MADE'
          AND current_setting('app.role', true) IN ('SELLER', 'SELLER_AGENT')
        )
        OR (
          lower(COALESCE(documents.document_type, '')) = 'escrow_instructions'
          AND t.current_state = 'UNDER_CONTRACT'
          AND current_setting('app.role', true) IN ('ESCROW_OFFICER')
        )
        OR (
          lower(COALESCE(documents.document_type, '')) = 'loan_commitment'
          AND t.current_state = 'FINANCING'
          AND current_setting('app.role', true) IN ('LENDER')
        )
        OR (
          lower(COALESCE(documents.document_type, '')) = 'funding_confirmation'
          AND t.current_state = 'CLEAR_TO_CLOSE'
          AND current_setting('app.role', true) IN ('ESCROW_OFFICER')
        )
      )
  )
);
DROP POLICY IF EXISTS document_update_policy ON documents;
CREATE POLICY document_update_policy ON documents
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND NOT (lower(COALESCE(document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  AND EXISTS (
    SELECT 1 FROM transaction_parties tp
    WHERE tp.transaction_id = documents.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
  )
);

-- document_versions: INSERT when document is visible to caller
DROP POLICY IF EXISTS document_versions_insert_policy ON document_versions;
CREATE POLICY document_versions_insert_policy ON document_versions
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM documents d
    JOIN transaction_parties tp ON tp.transaction_id = d.transaction_id
    WHERE d.document_id = document_versions.document_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND NOT (lower(COALESCE(d.document_type, '')) = 'inspection_report' AND lower(COALESCE(current_setting('app.role', true), '')) = 'lender')
  )
);

-- inspections: INSERT/UPDATE when inspector or transaction party (allowed roles)
DROP POLICY IF EXISTS inspection_insert_policy ON inspections;
CREATE POLICY inspection_insert_policy ON inspections
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    (lower(COALESCE(current_setting('app.role', true), '')) = 'inspector' AND inspections.inspector_id = (current_setting('app.user_id', true)::uuid))
    OR EXISTS (
      SELECT 1 FROM transaction_parties tp
      WHERE tp.transaction_id = inspections.transaction_id
        AND tp.user_id = (current_setting('app.user_id', true)::uuid)
        AND tp.role IN ('BUYER', 'BUYER_AGENT', 'SELLER', 'SELLER_AGENT', 'ESCROW_OFFICER')
    )
  )
);
DROP POLICY IF EXISTS inspection_update_policy ON inspections;
CREATE POLICY inspection_update_policy ON inspections
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND (
    (lower(COALESCE(current_setting('app.role', true), '')) = 'inspector' AND inspections.inspector_id = (current_setting('app.user_id', true)::uuid))
    OR EXISTS (
      SELECT 1 FROM transaction_parties tp
      WHERE tp.transaction_id = inspections.transaction_id
        AND tp.user_id = (current_setting('app.user_id', true)::uuid)
        AND tp.role IN ('BUYER', 'BUYER_AGENT', 'SELLER', 'SELLER_AGENT', 'ESCROW_OFFICER')
    )
  )
);

-- inspection_findings: INSERT/UPDATE when inspection visible
DROP POLICY IF EXISTS inspection_findings_insert_policy ON inspection_findings;
CREATE POLICY inspection_findings_insert_policy ON inspection_findings
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM inspections i
    JOIN transaction_parties tp ON tp.transaction_id = i.transaction_id
    WHERE i.inspection_id = inspection_findings.inspection_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
      AND (lower(COALESCE(current_setting('app.role', true), '')) = 'inspector' AND i.inspector_id = (current_setting('app.user_id', true)::uuid)
           OR tp.role IN ('BUYER', 'BUYER_AGENT', 'SELLER', 'SELLER_AGENT', 'ESCROW_OFFICER'))
  )
);

-- appraisals: INSERT only by LENDER or ESCROW_OFFICER (policy: lender/escrow orders appraisal)
DROP POLICY IF EXISTS appraisals_insert_policy ON appraisals;
CREATE POLICY appraisals_insert_policy ON appraisals
FOR INSERT WITH CHECK (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND upper(COALESCE(current_setting('app.role', true), '')) IN ('LENDER', 'ESCROW_OFFICER')
  AND EXISTS (
    SELECT 1 FROM transaction_parties tp
    WHERE tp.transaction_id = appraisals.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
  )
);
DROP POLICY IF EXISTS appraisals_update_policy ON appraisals;
CREATE POLICY appraisals_update_policy ON appraisals
FOR UPDATE USING (
  current_setting('app.user_id', true) IS NOT NULL AND current_setting('app.user_id', true) != ''
  AND EXISTS (
    SELECT 1 FROM transaction_parties tp
    WHERE tp.transaction_id = appraisals.transaction_id
      AND tp.user_id = (current_setting('app.user_id', true)::uuid)
  )
);

-- Section 16 (optional tx_risk_policy) omitted see docs for deal-size gating.

-- Privileges for the app connection role (06: RLS is final authority; app must not be superuser).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT USAGE ON SCHEMA messaging TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA messaging TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA messaging TO app_user;
    GRANT EXECUTE ON FUNCTION messaging.insert_chat_room(UUID, TEXT, UUID, TEXT, UUID) TO app_user;
    GRANT EXECUTE ON FUNCTION messaging.insert_chat_room_member(UUID, UUID, TEXT, UUID) TO app_user;
    GRANT EXECUTE ON FUNCTION messaging.delete_chat_room_member(UUID, UUID, UUID) TO app_user;
    GRANT EXECUTE ON FUNCTION insert_transaction_with_party(UUID, UUID, TEXT, UUID, UUID, UUID, TEXT) TO app_user;
  END IF;
END $$;

-- =============================================================================
-- 15. Read views (frontend query layer; RLS-constrained by underlying tables)
--     09-views-and-apis: prefer stable DB views for queries; commands remain direct to tables/functions.
-- =============================================================================

CREATE OR REPLACE VIEW v_transaction_overviews_v1
WITH (security_invoker = true) AS
SELECT
  t.transaction_id,
  t.organization_id,
  t.current_state,
  t.state_entered_at,
  t.jurisdiction,
  t.offer_price,
  t.property_id,
  t.listing_id,
  t.created_at,
  t.updated_at
FROM transactions t;

DROP VIEW IF EXISTS v_listing_overviews_v1;
CREATE VIEW v_listing_overviews_v1
WITH (security_invoker = true) AS
SELECT
  l.listing_id,
  l.property_id,
  l.status,
  l.list_price,
  l.price_currency,
  l.listing_type,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - l.created_at)) / 86400))::int AS days_on_market,
  l.description,
  l.is_public,
  l.created_at,
  l.updated_at,
  l.next_open_house_at,
  p.address_line_1,
  p.address_line_2,
  p.city,
  p.state_province,
  p.postal_code,
  p.country,
  p.latitude,
  p.longitude
FROM listings l
JOIN properties p ON p.property_id = l.property_id;

-- Views are created after the GRANT ON ALL TABLES block, so grant SELECT explicitly
-- (DROP/CREATE makes v_listing_overviews_v1 new; CREATE OR REPLACE preserves existing grants).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT ON v_transaction_overviews_v1 TO app_user;
    GRANT SELECT ON v_listing_overviews_v1 TO app_user;
  END IF;
END $$;

COMMIT;