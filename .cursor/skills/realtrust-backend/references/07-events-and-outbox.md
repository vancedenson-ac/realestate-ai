# realtrust ai — Event Spine, Outbox, and Replay (Evidence Architecture)

This document defines how realtrust ai uses events as **evidence** of committed facts.

Key rule:

> Events are effects, never causes. If a state transition does not commit, no event may exist.

---

## 1. Event philosophy (truth vs evidence vs derived behavior)

- **Truth** lives in authoritative tables (PostgreSQL).
- **Evidence** is captured as immutable events emitted only after truth commits.
- **Derived behavior** (AI, notifications, analytics) subscribes to evidence and MUST NOT couple itself to the write path.

This prevents:

- phantom notifications
- AI hallucinations about non-existent states
- audit inconsistencies

---

## 2. Canonical event envelope (required)

Every domain event MUST contain a stable envelope:

- event_id (UUID)
- event_type (string)
- aggregate_type (e.g., `transaction`, `document`)
- aggregate_id (UUID)
- transaction_id (nullable, but present for transaction-scoped facts)
- emitted_at (server time)
- emitted_by (effective role / system identity)
- correlation_id / request_id (optional but strongly recommended)
- payload (immutable JSON)
- payload_hash (recommended for integrity)

### 2.1 Payload side-channel prevention (MUST)

Event payloads MUST NOT become a side-channel that bypasses RLS/classification boundaries.

Rules:

- Payloads SHOULD be **reference-first**:
  - include stable identifiers (`transaction_id`, `document_id`, etc.)
  - include minimal, policy-safe summaries
  - avoid embedding sensitive fields that would normally be protected by RLS
- Consumers MUST re-hydrate details from PostgreSQL under RLS where applicable.

---

## 3. Canonical storage: `domain_events` (append-only)

Suggested schema (adapt to naming conventions):

```sql
CREATE TABLE domain_events (
  event_id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  transaction_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  emitted_by_role TEXT NOT NULL,
  correlation_id TEXT
);
```

Rules:

- MUST be append-only.
- MUST NOT be updated/deleted.
- MUST be written inside the same transaction as the authoritative commit it represents.

---

## 4. Event taxonomy (high-level)

The platform recognizes these categories:

- **TRANSACTION_EVENTS**: state transitions, party assignments, escrow milestones
- **OFFER_EVENTS**: offer submitted, countered, accepted, rejected, withdrawn (authoritative negotiation evidence)
- **DOCUMENT_EVENTS**: uploaded, versioned, signed, locked, processed
- **INSPECTION_EVENTS**: scheduled, completed, findings resolved
- **APPRAISAL_EVENTS**: ordered, submitted, accepted
- **TITLE_AND_RECORDING_EVENTS**: title ordered/cleared, deed recorded, ownership transfer confirmed (regulated milestones)
- **COMPLIANCE_EVENTS**: jurisdiction context set/changed, legal hold applied
- **POLICY_EVENTS**: policy versions published, RLS migrations applied (audited)
- **AI_EVENTS**: task queued/completed, insight approved, match computed
- **PROPERTY_EVENTS**: created, updated, listed, sold, image uploaded, image processed
- **CHAT_EVENTS**: room created, message sent, member added/removed
- **MATCHING_EVENTS**: preference created/updated, matches computed, recommendation sent

These categories are for organization; enforcement is per event type + payload schema.

---

## 5. Events derived from the state machine spec (required)

Transaction state transitions MUST map to canonical event names derived from `05-transaction-state-machine-spec.md`.

Example mapping:

- PRE_LISTING → LISTED: `ListingPublished`
- OFFER_MADE → UNDER_CONTRACT: `ContractExecuted`
- UNDER_CONTRACT → DUE_DILIGENCE: `EscrowOpened`
- CLEAR_TO_CLOSE → CLOSED: `TransactionClosed`

Rule:

- Event names and legal transition set MUST be generated from the same state machine spec to prevent drift.

---

## 6. Emission coupling (atomicity requirement)

### 6.1 Emission inside the transition transaction

For transaction state changes:

- the DB transition function MUST both mutate state and insert the corresponding domain event.
- if the function raises an exception, neither mutation nor event insertion occurs.

### 6.2 “No external calls inside the commit”

The DB transaction MUST NOT call external systems.

All external publishing MUST occur via the outbox mechanism.

---

## 7. Outbox pattern (delivery without breaking correctness)

### 7.1 Outbox tracking table (required)

```sql
CREATE TABLE event_outbox (
  event_id UUID PRIMARY KEY REFERENCES domain_events(event_id),
  delivered BOOLEAN NOT NULL DEFAULT false,
  delivered_at TIMESTAMPTZ,
  delivery_attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  kafka_partition INT,        -- assigned partition after publish
  kafka_offset BIGINT         -- offset for replay verification
);
```

Insertion model:

- when `domain_events` row is inserted, an `event_outbox` row is inserted in the same DB transaction.

### 7.2 Kafka-based delivery (MUST)

**Message Bus Platform**: Apache Kafka (Amazon MSK Serverless in AWS, Confluent in Docker locally).

**Topic Design**:

| Topic | Purpose | Partitioning Key | Retention |
|-------|---------|------------------|-----------|
| `realtrust.domain-events` | All domain events from outbox | `transaction_id` | 30 days |
| `realtrust.ai-tasks` | AI task orchestration | `task_id` | 7 days |
| `realtrust.notifications` | Notification fan-out | `recipient_id` | 7 days |
| `realtrust.audit-events` | Compliance audit stream | `transaction_id` | 1 year |
| `realtrust.property-events` | Property and listing updates | `property_id` | 30 days |
| `realtrust.chat-events` | Chat message events | `room_id` | 7 days |
| `realtrust.matching-events` | Property match notifications | `user_id` | 7 days |
| `realtrust.dlq.*` | Dead-letter queues per topic | original key | 30 days |

**Kafka Message Contract**:

```
Topic: realtrust.domain-events
Key: transaction_id (ensures per-transaction ordering)
Value: JSON event envelope with schema version

Headers:
  - event_type: string
  - event_id: string (UUID)
  - schema_version: integer
  - correlation_id: string (if present)
  - aggregate_type: string
```

**Schema Registry (MUST)**:

- Use **Confluent Schema Registry** in both local and AWS environments (JSON Schema format) to preserve Docker→AWS parity.
- Event schemas MUST be generated from the state machine spec
- Breaking changes MUST increment schema version
- Schema validation MUST occur before publish

Rationale:

- Keeping the same registry implementation and client behavior reduces production drift and simplifies testing.

### 7.3 Outbox worker specification

The outbox worker MUST:

1. Poll undelivered events in `emitted_at` order (oldest first)
2. Batch events by transaction_id for efficient publishing
3. Publish to Kafka with `transaction_id` as partition key
4. Wait for Kafka acknowledgment (acks=all for durability)
5. Update outbox row with `delivered=true`, `kafka_partition`, `kafka_offset`
6. Use exponential backoff on failures (max 10 retries)
7. Move to dead-letter queue after max retries

Producer requirements (MUST):

- `acks=all`
- `enable.idempotence=true`
- include `event_id` in message headers and in the value envelope (already required)

**Worker Concurrency**: Single worker per outbox to preserve ordering. Multiple workers MAY be used if partitioned by transaction_id range.

### 7.4 Idempotency requirements

Delivery MUST be idempotent:

- if the worker crashes after publish but before marking delivered, reprocessing must not duplicate downstream effects.
- Kafka producer MUST use idempotent mode (`enable.idempotence=true`)

Downstream consumers MUST:

- treat `event_id` as the de-duplication key
- store processed event_ids with TTL for deduplication window
- use consumer group commits to track progress

### 7.5 Multi-region posture (MUST)

Kafka is an **event transport** for derived behavior. PostgreSQL remains the system of record.

Therefore, the multi-region failover strategy MUST be:

- **Aurora Global Database** fails over (writer promotion).
- The outbox worker in the active region re-publishes any undelivered outbox rows to the region’s Kafka cluster.
- Consumers MUST tolerate duplicates (dedupe by `event_id`) and be able to re-hydrate derived state by replaying events.

This preserves correctness even if Kafka is unavailable during a failover window.

---

## 8. Consumers and derived effects

**Consumer Group Architecture**:

| Consumer Group | Topics | Purpose | Concurrency |
|----------------|--------|---------|-------------|
| `ai-orchestrator` | `domain-events` | Trigger AI tasks | 4 partitions |
| `notification-service` | `domain-events`, `ai-tasks` | Generate notifications | 8 partitions |
| `compliance-exporter` | `audit-events` | Compliance reporting | 2 partitions |
| `document-processor` | `domain-events` | Trigger document extraction | 2 partitions |
| `image-processor` | `property-events` | Process property images | 4 partitions |
| `match-computer` | `property-events`, `domain-events` | Compute property matches | 2 partitions |
| `chat-indexer` | `chat-events` | Index chat for search | 2 partitions |

### 8.1 AI orchestration consumer

**Consumer Group**: `ai-orchestrator`

Consumes from `realtrust.domain-events`:

- `StateTransitioned`-like events (or specific transition events)
- `DocumentUploaded`, `SignatureCompleted`, `InspectionReportSubmitted`
- `DocumentProcessed` (triggers embedding generation)

Produces (non-authoritative):

- `AI_Task` and `AI_Insight` records in PostgreSQL
- Publishes `AI_TaskCompleted` to `realtrust.ai-tasks`
- optionally `AI_InsightApproved` events after human approval

AI MUST react to events, not user intent directly.

### 8.2 Notification consumer

**Consumer Group**: `notification-service`

Consumes from `realtrust.domain-events` and `realtrust.ai-tasks`:

- transaction events
- document milestones
- approved AI insights

Produces:

- notifications (derived; not authoritative)
- publishes delivery status to internal metrics

Notifications MUST be policy-aware; they must not leak restricted information through payloads.

### 8.3 Compliance/audit consumer

**Consumer Group**: `compliance-exporter`

Consumes from `realtrust.audit-events`:

- all audit events for compliance reporting

Produces:

- compliance exports to S3 (with Object Lock for FINRA)
- reconciliation and integrity checks
- FINRA 4511 books and records archives

### 8.4 Document processing consumer

**Consumer Group**: `document-processor`

Consumes from `realtrust.domain-events`:

- `DocumentVersionCreated` events

Triggers:

- PDF/DOCX text extraction
- OCR for scanned documents
- Semantic chunking for RAG
- Embedding generation (stored in `ai_embeddings`)

Produces:

- `DocumentProcessed` event (published to domain-events)

### 8.5 Image processing consumer

**Consumer Group**: `image-processor`

Consumes from `realtrust.property-events`:

- `PropertyImageUploaded` events

Triggers:

- Image validation and sanitization
- EXIF metadata extraction
- Variant generation (thumbnail, medium, large, webp)
- AI image classification (room type, interior/exterior)
- Image embedding generation
- OCR queue for floor plans

Produces:

- `PropertyImageProcessed` event (published to property-events)

### 8.6 Match computing consumer

**Consumer Group**: `match-computer`

Consumes from `realtrust.property-events` and `realtrust.domain-events`:

- `ListingCreated`, `ListingUpdated` events
- `BuyerPreferenceCreated`, `BuyerPreferenceUpdated` events

Triggers:

- Recompute match scores for affected buyer-listing pairs
- Generate match explanations via LLM
- Store results in `property_matches` table

Produces:

- `MatchesComputed` event (published to matching-events)
- Triggers notification worker for instant notifications

### 8.7 Chat events consumer

**Consumer Group**: `chat-indexer`

Consumes from `realtrust.chat-events`:

- `ChatMessageSent` events

Triggers:

- Index message content for search (if enabled)
- Update unread counts in Redis
- Trigger notification worker for offline users

Produces:

- Metrics and search index updates (not new events)

---

## 9. Replay and reconstruction (audit survivability)

The platform MUST be able to reconstruct:

- transaction timeline from state transition history + domain events
- document chain-of-custody and signatures
- derived notifications (if stored) from event history
- AI advisory outputs (within policy constraints) from events + stored prompts + authorized snapshots

This requires:

- events to be immutable
- event payloads to contain stable references to authoritative rows
- prompt templates and model registries to be versioned

---

## 10. Event API surfaces (backend-only)

The platform MAY expose read-only endpoints for internal services:

- list events since timestamp for a transaction
- stream/poll events for orchestration

These endpoints MUST:

- respect RLS and classification constraints (events can contain sensitive payload references)
- avoid returning payloads that leak restricted facts

---

## 11. Acceptance criteria

This architecture is correctly implemented if:

- no event exists for a failed state transition (provable via tests)
- outbox publishing can fail without breaking transactional correctness
- consumers can replay events to reconstruct derived systems
- event payloads never become a side channel that violates access boundaries

