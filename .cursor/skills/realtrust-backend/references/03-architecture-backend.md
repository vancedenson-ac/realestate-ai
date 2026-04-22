# realtrust ai — Backend Architecture Specification

This document defines the backend architecture for **realtrust ai** with an emphasis on:

- deterministic, auditable transactional correctness
- database-enforced access boundaries
- event-driven decoupling of inference/notifications from truth
- a schema and service design that survives regulatory scrutiny
- real-time communication for transaction participants
- AI-enabled property matching and search

It is intentionally backend-only.

---

## 1. Architectural principles (non-negotiable)

1. **PostgreSQL is the system of record** for authoritative facts.
2. **The transaction state machine defines legality** (the "law").
3. **All authoritative writes are command-driven** and pass through a single legal mutation path (preferably DB functions / stored procedures).
4. **Events are effects** (evidence) and MUST only exist when the corresponding DB commit succeeded.
5. **AI is advisory**: it reads permitted views, writes advisory artifacts, and cannot mutate authoritative state.
6. **Separation of duties is structural**: schema + RLS + explicit denies.
7. **Real-time is auxiliary**: Chat and presence do not affect transaction legality.

---

## 2. System components (conceptual)

### 2.1 Identity and access boundary

- **OIDC/OAuth2 provider** (initially AWS Cognito per legacy docs, interchangeable): authenticates users.
- **API**: validates tokens and establishes a request-scoped identity.
- **Database session context**: the API sets PostgreSQL session settings (e.g., `app.user_id`, `app.role`, jurisdiction attributes) used by RLS.

### 2.2 Core backend API (FastAPI)

**Technology Stack (MUST)**:

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Web Framework | FastAPI 0.110+ | Async-first, OpenAPI generation, Pydantic v2 integration |
| ASGI Server | Uvicorn + Gunicorn | Production-grade with worker management |
| Validation | Pydantic v2 | Performance, strict mode, JSON schema generation |
| ORM | SQLAlchemy 2.0 (async) | Async sessions, type hints, PostgreSQL-native features |
| Migrations | Alembic | SQLAlchemy integration, RLS-aware migrations |
| Package Manager | uv | Fast dependency resolution, lockfile support |
| Python Version | 3.12+ | Performance, typing improvements |

**Canonical Project Structure**:

```
src/
├── api/
│   ├── v1/
│   │   ├── endpoints/
│   │   │   ├── transactions.py
│   │   │   ├── documents.py
│   │   │   ├── parties.py
│   │   │   ├── properties.py
│   │   │   ├── listings.py
│   │   │   ├── chat.py
│   │   │   ├── recommendations.py
│   │   │   └── ai_insights.py
│   │   └── router.py
│   └── deps.py              # Shared dependencies (DB session, auth)
├── core/
│   ├── config.py            # Pydantic Settings
│   ├── security.py          # JWT validation, session context
│   └── exceptions.py        # Domain exceptions
├── domain/
│   ├── transactions/
│   │   ├── models.py        # SQLAlchemy models
│   │   ├── schemas.py       # Pydantic request/response
│   │   ├── service.py       # Business logic
│   │   └── repository.py    # Data access
│   ├── documents/
│   ├── properties/
│   ├── messaging/
│   ├── matching/
│   ├── inspections/
│   └── ai/
├── db/
│   ├── session.py           # Async session factory
│   ├── rls.py               # RLS context management
│   └── functions/           # Stored procedure wrappers
├── events/
│   ├── publisher.py         # Outbox publisher
│   └── handlers/            # Event consumers
├── websocket/
│   ├── manager.py           # Connection manager
│   ├── handlers/            # Message handlers
│   └── pubsub.py            # Redis pub/sub
└── workers/
    ├── outbox_worker.py
    ├── ai_task_worker.py
    ├── document_processor.py
    ├── image_processor.py
    └── match_computer.py
```

The API provides:

- command endpoints (write paths) that enforce intent checks and call authoritative DB mutation functions
- query endpoints (read paths) that return shaped "views" under RLS
- event querying endpoints (read-only) for internal consumers where appropriate
- WebSocket endpoints for real-time chat and presence

**Current implementation mapping (backend):** Config lives in `realtrust_api/config.py` (not `core/config.py`). Auth and RLS context are in `api/deps.py` (`get_db_with_rls` sets `app.user_id`, `app.organization_id`, `app.role`, `app.license_state` via SET LOCAL); there is no separate `core/security.py` yet. Domain modules have `models.py` and `schemas.py` only (no `service.py`/`repository.py` per domain yet). Schema and seeds are applied via `scripts/02-schema.sql` and `scripts/03-seed.sql`; Alembic is the target for governed production migrations. API is mounted at configurable base path (e.g. `/realtrust-ai/v1`). Workers, `events/` publisher, and `websocket/` gateway are spec targets not yet present in the repo; add them when implementing those services.

### 2.3 PostgreSQL (system of record)

**Database Platform**: PostgreSQL 16+ via Amazon Aurora Global Database (multi-region).

**Required Extensions**:

| Extension | Purpose | Requirement Level |
|-----------|---------|-------------------|
| `pgvector` | Vector embeddings for AI/semantic search | MUST |
| `postgis` | Geographic queries for property search | MUST |
| `pg_cron` | Scheduled maintenance jobs | SHOULD |
| `pg_stat_statements` | Query performance monitoring | MUST |
| `pgcrypto` | Payload hashing for audit integrity | MUST |
| `uuid-ossp` | UUID generation | MUST |

PostgreSQL stores:

- authoritative domain state (transactions, parties, documents, escrow operations)
- property and listing data with geographic indexing
- chat rooms and messages (party-gated)
- invariants and constraints (state machine legality, cross-domain invariants)
- row-level security policies (ABAC bound into RLS)
- immutable ledgers (domain events, audit events, access decisions)
- derived read models (views/materialized views) as needed
- vector embeddings for semantic search (pgvector, advisory)

### 2.4 Object storage (MinIO → S3 parity)

| Environment | Storage | Configuration |
|-------------|---------|---------------|
| Local/Dev | MinIO | S3-compatible API |
| AWS | Amazon S3 | With versioning, Cross-Region Replication, Object Lock for FINRA |

**Bucket Structure**:

```
realtrust-documents-{env}/
├── transactions/{transaction_id}/
│   ├── documents/{document_id}/
│   │   └── versions/{version_id}/{filename}
│   └── inspections/{inspection_id}/
└── ai/
    └── input-snapshots/{task_id}/

realtrust-property-images-{env}/
├── properties/{property_id}/
│   └── {image_id}/
│       ├── original.{ext}
│       ├── thumbnail.jpg
│       ├── medium.jpg
│       ├── large.jpg
│       └── optimized.webp
└── temp/
    └── {upload_id}/

realtrust-chat-attachments-{env}/
├── rooms/{room_id}/
│   └── {attachment_id}/{filename}
```

**Requirements**:

- **MUST** enable versioning for document buckets
- **MUST** enable server-side encryption (SSE-KMS in production)
- **MUST** implement presigned URLs for upload/download (never stream through API)
- **MUST** store checksums in PostgreSQL, verify on access
- **MUST** enable S3 Object Lock for FINRA WORM compliance on regulated documents

PostgreSQL stores:

- document metadata
- versions
- checksums
- chain-of-custody
- property image metadata

### 2.5 Background workers

**Framework**: ARQ (Async Redis Queue) — native async/await, Redis-based, lightweight.

| Worker | Purpose | Concurrency | Retry Policy |
|--------|---------|-------------|--------------|
| `outbox_publisher` | Publish domain events to Kafka | 1 (ordered) | Exponential backoff, max 10 |
| `ai_task_executor` | Execute AI tasks | 4 | 3 retries, then DLQ |
| `notification_sender` | Send notifications | 8 | 3 retries |
| `document_processor` | Extract text (PDF/DOCX), generate embeddings | 2 | 5 retries |
| `image_processor` | Resize, classify, embed property images | 4 | 3 retries |
| `ocr_processor` | OCR for floor plans and documents | 2 | 3 retries |
| `match_computer` | Compute property matches for buyer preferences | 2 | 3 retries |

Workers are used for:

- outbox publishing (deliver committed domain events to Kafka)
- AI task execution (summaries, anomaly detection, recommendation drafting)
- document processing (text extraction, chunking, embedding generation)
- image processing (resize, classify, OCR, embedding)
- property matching (compute buyer-property match scores)
- notifications (derived downstream of events)
- ingestion pipelines (IDX/feeds if applicable)

Workers MUST NOT:

- mutate authoritative state without going through the same legal DB command path
- emit authoritative events outside of the outbox/DB-committed event spine

### 2.6 Message bus / event transport

**Platform**: Apache Kafka (Amazon MSK Serverless in AWS, Confluent in Docker locally).

**Rationale for Kafka**:

1. **Local-to-AWS parity**: Kafka runs identically in Docker and AWS MSK
2. **Replay capability**: Kafka's log-based architecture aligns with evidence model
3. **Schema evolution**: Schema Registry enforces event contract stability
4. **Multi-consumer**: Multiple consumers can independently replay the same events

**Kafka Topic Design (MUST)**:

| Topic | Purpose | Partitioning Key | Retention |
|-------|---------|------------------|-----------|
| `realtrust.domain-events` | All domain events from outbox | `transaction_id` | 30 days |
| `realtrust.ai-tasks` | AI task orchestration | `task_id` | 7 days |
| `realtrust.notifications` | Notification fan-out | `recipient_id` | 7 days |
| `realtrust.audit-events` | Compliance audit stream | `transaction_id` | 1 year |
| `realtrust.property-events` | Property and listing updates | `property_id` | 30 days |
| `realtrust.chat-events` | Chat message events | `room_id` | 7 days |
| `realtrust.dlq.*` | Dead-letter queues | original key | 30 days |

**Schema Registry (MUST)**:

- Use **Confluent Schema Registry** in both local and AWS environments (JSON Schema format) to preserve Docker→AWS parity.
- Event schemas MUST be generated from the state machine spec
- Breaking changes MUST increment schema version

**Consumer Groups**:

- `ai-orchestrator`: Consumes `domain-events` to trigger AI tasks
- `notification-service`: Consumes `domain-events` and `ai-tasks` for notifications
- `compliance-exporter`: Consumes `audit-events` for compliance reporting
- `document-processor`: Consumes `domain-events` for document processing
- `image-processor`: Consumes `property-events` for image processing
- `match-computer`: Consumes `property-events` to update match scores

The architectural invariant remains: **DB commit first; publish second**.

The outbox worker MUST:

- Poll undelivered events in transaction order
- Publish to Kafka with the `event_id` as message key
- Mark delivered only after Kafka acknowledgment
- Use exponential backoff on failures

### 2.7 Caching layer

**Platform**: Redis 7+ (Amazon ElastiCache Global Datastore for multi-region).

| Use Case | Key Pattern | TTL | Eviction |
|----------|-------------|-----|----------|
| Session cache | `session:{user_id}` | 1 hour | LRU |
| Rate limiting | `ratelimit:{user_id}:{endpoint}` | 1 minute | TTL |
| Idempotency keys (cache only) | `idempotency:{key}` | 24 hours | TTL |
| Legal transitions cache | `transitions:{from_state}` | 5 minutes | TTL |
| WebSocket presence | `presence:{user_id}` | 5 minutes | TTL |
| Typing indicators | `typing:{room_id}:{user_id}` | 10 seconds | TTL |
| Unread counts | `unread:{user_id}:{room_id}` | 1 hour | TTL |

**Redis MUST NOT store**:

- Authoritative state (PostgreSQL is system of record)
- Access control decisions (these come from RLS)
- Event data (Kafka is the event store)

Idempotency MUST be authoritative in PostgreSQL (see `08-database-schema-and-governance.md`); Redis may cache recent outcomes.

### 2.8 WebSocket gateway

**Platform**: FastAPI WebSocket endpoints with Redis Pub/Sub for horizontal scaling.

| Aspect | Specification |
|--------|---------------|
| Technology | FastAPI WebSocket endpoints |
| Scaling | Redis Pub/Sub for horizontal scaling |
| Authentication | JWT validation on connection |
| Message routing | Room-based pub/sub channels |
| Offline handling | Queue messages in Redis, deliver on reconnect |
| Heartbeat | 30-second ping/pong for connection health |

**WebSocket Events**:

```
# Inbound (client → server)
- message.send
- message.edit
- message.delete
- typing.start
- typing.stop
- room.mark_read
- presence.update

# Outbound (server → client)
- message.new
- message.updated
- message.deleted
- typing.indicator
- presence.changed
- room.updated
- notification.new
- property.match
```

**Scaling Architecture**:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ ALB/WebSocket│────▶│ WS Gateway  │
└─────────────┘     └─────────────┘     │   (ECS)     │
                                        └──────┬──────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
              ┌─────▼─────┐              ┌─────▼─────┐              ┌─────▼─────┐
              │   Redis   │◀────────────▶│   Redis   │◀────────────▶│   Redis   │
              │  Pub/Sub  │   Cluster    │  Pub/Sub  │   Cluster    │  Pub/Sub  │
              └───────────┘              └───────────┘              └───────────┘
```

---

## 3. Domain boundaries (service-level responsibilities)

This section defines the logical services/domains. Implementation MAY start as a modular monolith, but boundaries MUST be maintained.

### 3.1 Identity & organization domain

Responsibilities:

- user profiles and organization membership (non-auth identity)
- contextual role bindings (user is an agent for transaction X, not globally)
- verification metadata (licensure, compliance attributes)

Data ownership:

- `users`, `organizations`, contextual role/party binding tables

### 3.2 Transaction domain (the "law carrier")

Responsibilities:

- transaction creation and lifecycle
- state machine enforcement (only legal transitions)
- state transition history (immutable)
- enforcement hooks for cross-domain invariants
- authoritative milestone facts that gate transitions (e.g., offers/acceptance evidence; recording/transfer readiness via referenced facts)

Data ownership:

- `transactions`, `transaction_parties`, state machine tables, transition history

Write rules:

- all state transitions MUST go through authoritative transition command function(s)
- state changes MUST emit domain events inside the same DB transaction

### 3.3 Document & evidence domain

Responsibilities:

- document metadata, types, classifications
- versions and checksums (chain-of-custody)
- signing and locking semantics
- inheritance of transaction visibility constraints

Data ownership:

- `documents`, `document_versions`, `document_signatures`, evidence linking

### 3.4 Inspection domain (role-isolated confidentiality)

Responsibilities:

- inspection scheduling/assignment
- inspection findings and resolution status
- inspection report confidentiality enforcement (explicit lender deny)

Data ownership:

- `inspections`, `inspection_findings`, inspection report documents

### 3.5 Appraisal domain

Responsibilities:

- appraiser assignment (typically lender-hired)
- appraisal results and visibility rules

Data ownership:

- `appraisals` and associated evidence

### 3.6 Escrow and funding domain (regulated)

Responsibilities:

- escrow officer assignment
- escrow instructions
- funding confirmations
- disbursement instructions (if modeled)
- deed recording and ownership transfer milestone facts (regulated close evidence)

Data ownership:

- escrow tables, funding confirmations, regulated documents

### 3.7 Policy and authorization domain

Responsibilities:

- RBAC baseline configuration
- ABAC attribute model
- policy versioning and decision logging
- RLS policy evolution via migrations

Data ownership:

- policy tables, attribute tables, access decision logs

### 3.8 Eventing domain (evidence + propagation)

Responsibilities:

- canonical domain events table (append-only)
- outbox tracking/delivery
- consumers orchestration patterns

Data ownership:

- `domain_events`, `event_outbox` (or equivalent)

### 3.9 AI advisory domain

Responsibilities:

- subscribe to events
- generate non-authoritative insights and tasks
- store provenance and approval workflows
- semantic search via RAG pipeline
- property matching and recommendations
- image classification and tagging

Data ownership:

- `ai_tasks`, `ai_outputs/insights`, prompt templates, model registry
- `ai_embeddings` (vector storage for semantic search)
- `property_matches` (computed match scores)

Hard boundary:

- AI cannot modify authoritative domains; it can only write advisory artifacts.

### 3.10 Document processing domain

Responsibilities:

- text extraction from PDF and DOCX documents
- OCR for scanned documents (Tesseract)
- semantic chunking for RAG
- embedding generation for vector search

Data ownership:

- `document_text` (extracted text, versioned with document)
- `document_chunks` (chunked content for RAG)

Write rules:

- document processing is triggered by `DocumentUploaded` events
- extracted text and chunks inherit visibility from parent document via RLS

### 3.11 Compliance domain

Responsibilities:

- FINRA supervision workflow (Rule 3110)
- immutable compliance records (Rule 4511)
- SOC 2 audit trail generation
- legal hold management

Data ownership:

- `compliance_records` (WORM, 6-year retention)
- `supervision_cases` (review workflow)
- `audit_events` (SOC 2 + FINRA compliant)

### 3.12 Property domain

Responsibilities:

- property data management (attributes, location, characteristics)
- listing lifecycle (draft, active, pending, sold)
- property image management and processing
- geographic search and filtering
- MLS integration (if applicable)

Data ownership:

- `properties` (authoritative property facts)
- `listings` (sale/rent offerings)
- `property_images` (with variants and metadata)

Write rules:

- property and listing updates emit events for downstream consumers
- images trigger processing pipeline on upload

### 3.13 Messaging domain

Responsibilities:

- chat room management (transaction, direct, group)
- message persistence and delivery
- real-time message routing via WebSocket
- attachment handling
- read receipts and typing indicators

Data ownership:

- `chat_rooms`, `chat_room_members`, `messages`, `chat_attachments`

Write rules:

- messages are NOT authoritative for transaction state
- chat access follows transaction party relationships via RLS
- messages are retained per policy but are not legally binding

### 3.14 Matching domain

Responsibilities:

- buyer preference management
- property-to-buyer matching algorithms
- match score computation and caching
- recommendation generation
- match notification triggers

Data ownership:

- `buyer_preferences` (search criteria and lifestyle descriptions)
- `property_matches` (computed scores and explanations)

Write rules:

- matching is AI-driven and advisory
- match scores are recomputable from preferences and listings

---

## 4. Write path vs read path (CQRS-style separation)

### 4.1 Write path (commands)

Characteristics:

- explicit command endpoints (e.g., "transition transaction state")
- intent checks at API level for UX and clarity
- **final authority** in DB (stored procedures + constraints)
- append-only evidence emitted inside the same transaction

### 4.2 Read path (views)

Characteristics:

- read-only endpoints returning shaped data
- built on:
  - base tables protected by RLS, and/or
  - SQL views/materialized views that respect RLS and classification
- consistent pagination and filtering

The read path MUST NOT be used to infer legality; legality is determined by the state machine spec.

---

## 5. Authorization architecture (where enforcement happens)

Enforcement layers:

1. **Authn**: token verification at the API boundary.
2. **Intent checks**: API checks for "is this caller attempting an action they might have the right to do?"
3. **Final authority**: PostgreSQL RLS + DB constraints/stored procedures.

Key requirement:

- the API MUST set request/transaction-scoped DB session variables used by RLS (see `06-authorization-and-data-access.md`).

---

## 6. Event-driven architecture (decoupling truth from inference)

Core rule:

> Events describe facts that already happened.

Therefore:

- a failed transition MUST NOT emit events
- downstream systems MUST subscribe to events rather than user intent directly

See `07-events-and-outbox.md`.

---

## 7. Environment and isolation

The platform SHOULD support:

- separate environments (dev/test/staging/prod)
- strong isolation of data and credentials between environments

Non-production MUST NOT share the same database as production.

---

## 7.1 Multi-region architecture

The platform MUST be architected for multi-region deployment.

**Primary/Secondary Regions**:

| Component | Primary (us-east-1) | Secondary (us-west-2) |
|-----------|---------------------|----------------------|
| Aurora Global DB | Writer instance | Read replica (auto-promote) |
| Kafka (MSK) | Active cluster | Standby cluster (activated on failover) |
| ElastiCache Redis | Primary | Global Datastore replica |
| S3 | Source bucket | Cross-Region Replication |
| ECS Fargate | Active services | Standby (Route 53 failover) |

**Recovery Objectives**:

- **RPO** (Recovery Point Objective): < 1 second (Aurora Global replication)
- **RTO** (Recovery Time Objective): < 1 minute (Route 53 health check + failover)

**Failover Strategy**:

- Route 53 health checks monitor ALB endpoints in both regions
- Automatic DNS failover to secondary region on primary failure
- Aurora Global Database supports managed failover with automatic promotion
- Outbox publisher in the active region re-publishes undelivered outbox rows; consumers reprocess with `event_id` dedupe

---

## 8. Threat boundaries (high-level)

### 8.1 Common failure modes

- API authorization bug causing over-read
- internal tooling misuse accessing data directly
- compromised service token
- AI prompt leakage or over-broad retrieval
- chat message leakage across transaction boundaries

### 8.2 Structural mitigations

- RLS makes unauthorized rows invisible regardless of API behavior
- explicit denies for key separations (inspection → lender)
- append-only evidence allows forensic reconstruction
- AI reads only RLS-filtered views; writes only advisory artifacts
- chat rooms inherit visibility from transaction parties

---

## 9. Required artifacts derived from this architecture

This architecture MUST be reflected in:

- schema and RLS policies (`08-database-schema-and-governance.md`, `06-authorization-and-data-access.md`)
- state machine enforcement (`05-transaction-state-machine-spec.md`)
- event spine and outbox (`07-events-and-outbox.md`)
- API and view contracts (`09-views-and-apis.md`)
- proof suite (`11-testing-and-proof-suite.md`)
- infrastructure and deployment (`16-infrastructure-and-deployment.md`)

---

## 10. Local development environment

The platform MUST provide a Docker Compose configuration for local development with production parity.

**Required Services**:

- `api`: FastAPI application
- `websocket-gateway`: Real-time WebSocket service
- `db`: PostgreSQL 16 with pgvector and PostGIS (`postgis/postgis:16-3.4`)
- `redis`: Redis 7+ for caching, job queue, and pub/sub
- `kafka` + `zookeeper`: Confluent Kafka for event streaming
- `schema-registry`: Confluent Schema Registry
- `minio`: S3-compatible object storage
- `outbox-worker`: Event publishing worker
- `ai-worker`: AI task execution worker
- `document-processor`: PDF/DOCX extraction worker
- `image-processor`: Image processing worker
- `match-computer`: Property matching worker

See `16-infrastructure-and-deployment.md` for complete Docker Compose specification.
