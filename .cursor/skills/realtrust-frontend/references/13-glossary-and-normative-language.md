# realtrust ai — Glossary, Definitions, and Normative Language

This document defines shared vocabulary and the normative language used across `real-trust-spec/`.

---

## 1. Normative language

The following terms are interpreted as described:

- **MUST / MUST NOT**: absolute requirements.
- **SHOULD / SHOULD NOT**: strong recommendations; deviations must be explicitly documented and justified.
- **MAY**: optional behavior.

When there is a conflict between documents, precedence is:

1. `05-transaction-state-machine-spec.md` (legality / "law")
2. `06-authorization-and-data-access.md` (access boundaries / "who can know what")
3. `08-database-schema-and-governance.md` (system-of-record constraints)
4. `07-events-and-outbox.md` (evidence and propagation)
5. `09-views-and-apis.md` (interfaces)

---

## 2. Core terms

### 2.1 Authoritative vs non-authoritative

- **Authoritative**: data that directly represents legally or operationally binding facts (e.g., transaction state, signed documents, escrow funding confirmations, role assignments). Authoritative data is stored in PostgreSQL as the system of record and is protected by hard invariants.
- **Non-authoritative (derived/advisory)**: data produced from authoritative facts but not itself binding (e.g., AI summaries, risk scores, recommendations, analytics). Non-authoritative data may be recomputed and MUST NOT be treated as truth.

### 2.2 System of record

- **System of record**: the canonical store whose contents are legally and operationally defensible and replayable. For realtrust ai, this is **PostgreSQL** (via Amazon Aurora Global Database in production).

### 2.3 Transaction (real estate)

- **Transaction**: the unit of coordinated work and legal progression from listing to escrow to close/cancel. A transaction has:
  - a **current state**
  - **participants** with contextual roles
  - **documents** and evidence
  - **events** (immutable history)

### 2.4 State machine (law)

- **State machine**: the finite, explicit model defining legal transaction progression.
- **Legal transition**: a transition present in the canonical transition table/spec; anything else MUST be rejected.
- **Precondition**: a deterministic predicate over authoritative system state that must hold for a transition to commit.
- **Invariant**: a constraint that MUST always hold; the system is incorrect if an invariant can be violated.

### 2.4.1 Milestone fact (journey subflows)

- **Milestone fact**: an authoritative, transaction-scoped fact representing a journey step that is not itself a macro-state (e.g., offer accepted, title cleared, funds confirmed, deed recorded). Milestone facts:
  - live in PostgreSQL authoritative tables
  - are referenced by state transition preconditions/invariants
  - emit domain events and (for regulated milestones) audit events

See `references/17-journey-mapping-and-milestones.md`.

### 2.4.2 Meaning of CLOSED (binding)

- **CLOSED**: the terminal macro-state meaning **deed recorded** and **ownership transfer confirmed** (and disbursement recorded where applicable). “Closing day signed” is a milestone inside `CLEAR_TO_CLOSE`, not sufficient for `CLOSED`.

### 2.5 Event (evidence)

- **Domain event**: an immutable record that a fact occurred (after commit), with a stable envelope and payload.
- **Outbox**: a reliable publishing mechanism that ensures events are delivered to Kafka without breaking transactional correctness.
- **Replay**: the ability to reconstruct derived state, AI insights, and notifications from stored events and authoritative tables.

### 2.6 Role and relationship

- **System role**: a base role category (BUYER, SELLER, ESCROW_OFFICER, etc.).
- **Effective role**: role as applied to a specific transaction context (a user may be an agent for Transaction A and unrelated to Transaction B).
- **Relationship**: the binding that connects a user to a transaction and constrains access (party, agent, lender, inspector hired-by, etc.).

### 2.7 Data classification

Every data object relevant to a transaction MUST be assigned a classification that influences visibility:

- **PUBLIC**: safe for broad consumption (e.g., public listing metadata).
- **TRANSACTION_SHARED**: shared among parties to the transaction with relationship-based gating.
- **CONFIDENTIAL_ROLE**: role-isolated data (e.g., inspection reports restricted to buyer + buyer agent; lender explicitly denied).
- **REGULATED**: subject to retention/handling and audit requirements (e.g., loan docs, funding confirmations).
- **SYSTEM**: internal-only (policies, access decisions, prompt registries, internal audits).

### 2.8 Separation of duties

Structural enforcement that prevents improper access by design (schema + RLS + explicit denies), not "best effort" conventions.

### 2.9 "View"

This spec uses "view" in two related senses:

- **Database view**: a SQL `VIEW` (or materialized view) representing a shaped read model. It MUST respect RLS and classifications.
- **API view resource**: a read-only API representation (often derived from a DB view) exposed to a caller within an authorized scope.

---

## 3. Canonical roles (system-level)

Realtrust ai treats roles as contextual; a user's effective permissions are derived from:

\[
Permission = Organization \cap Role \cap Relationship \cap TransactionState \cap DataClassification \cap Jurisdiction
\]

Canonical roles referenced across specs:

- BUYER
- SELLER
- BUYER_AGENT
- SELLER_AGENT
- ESCROW_OFFICER (and/or NOTARY depending on jurisdiction)
- LENDER
- APPRAISER (lender-hired)
- INSPECTOR (buyer/agent-hired)
- SYSTEM_AI (service identity; advisory only)
- ADMIN (break-glass only; heavily audited)

---

## 4. Escrow is sacred (design axiom)

Any design decision that conflicts with escrow compliance, separation-of-duties requirements, or audit survivability is incorrect.

---

## 5. The "proof standard"

When this spec says the platform "guarantees" something, that guarantee MUST be backed by:

- DB constraints / RLS policies that make violations unrepresentable, and/or
- an append-only audit trail that can prove access/decisions, and/or
- negative tests that demonstrate violations are impossible.

---

## 6. Technology terms

### 6.1 Infrastructure

- **Aurora Global Database**: Amazon's managed PostgreSQL-compatible database with multi-region replication (< 1 second RPO).
- **MSK (Managed Streaming for Kafka)**: Amazon's managed Apache Kafka service for event streaming.
- **ElastiCache Global Datastore**: Amazon's managed Redis with cross-region replication.
- **ECS Fargate**: Amazon's serverless container orchestration platform.
- **S3 Object Lock**: S3 feature enabling WORM (Write Once Read Many) storage for compliance.

### 6.2 AI/ML terms

- **RAG (Retrieval-Augmented Generation)**: Pattern combining vector similarity search with LLM generation for document Q&A.
- **pgvector**: PostgreSQL extension for vector similarity search using HNSW indexes.
- **Embedding**: Dense vector representation of text (e.g., 1536 dimensions for OpenAI text-embedding-3-small).
- **Chunk**: Segment of document text optimized for embedding and retrieval (typically 1000 tokens with 200 token overlap).
- **LLM (Large Language Model)**: AI model for text generation (e.g., GPT-4, Claude 3).
- **Provenance**: Audit trail for AI outputs including model, prompt, inputs, and approvals.

### 6.3 Event streaming terms

- **Kafka Topic**: Named channel for publishing and consuming events.
- **Consumer Group**: Set of consumers that share event processing load for a topic.
- **Schema Registry**: Service for managing and validating event schemas (JSON Schema format).
- **Dead-Letter Queue (DLQ)**: Queue for events that failed processing after max retries.

### 6.3.1 Multi-region posture note (Kafka)

- Kafka is treated as **event transport for derived behavior**. PostgreSQL (Aurora Global) remains the system of record.
- Multi-region continuity is achieved by **outbox republish** + consumer **`event_id` dedupe** after failover, not by assuming cross-region topic replication is always available.

### 6.8 Tenancy terms

- **Organization / Tenant**: The isolation boundary for most non-public data. For multi-tenant SaaS operation, all org-scoped data MUST be tagged with `organization_id` and constrained by RLS using `app.organization_id` session context.

### 6.4 Document processing terms

- **Text Extraction**: Process of converting PDF/DOCX to plain text.
- **OCR (Optical Character Recognition)**: Converting scanned document images to text (via Tesseract).
- **Semantic Chunking**: Splitting documents at natural boundaries (paragraphs, sentences) for RAG.

### 6.5 Real-time communication terms

- **WebSocket**: Protocol for full-duplex communication between client and server.
- **Redis Pub/Sub**: Redis feature for publish-subscribe messaging between services.
- **Presence**: User online/offline status tracking.
- **Typing Indicator**: Real-time notification that a user is composing a message.
- **Read Receipt**: Confirmation that a message has been viewed by a recipient.

### 6.6 Property and matching terms

- **Listing**: A property offered for sale or rent with pricing and agent information.
- **Property**: The physical real estate asset with its characteristics and location.
- **PostGIS**: PostgreSQL extension for geographic data types and queries.
- **Buyer Preference**: Saved search criteria for property matching.
- **Match Score**: Computed compatibility (0.0 to 1.0) between a buyer preference and a listing.
- **Semantic Matching**: Using embedding similarity to match lifestyle descriptions to property features.
- **Hard Filter**: Non-negotiable criteria that eliminate properties (e.g., max price, min bedrooms).
- **Soft Filter**: Weighted preferences that affect match score but don't eliminate properties.

### 6.7 Image processing terms

- **Image Variant**: Resized version of an image (thumbnail, medium, large, webp).
- **EXIF**: Exchangeable Image File Format - metadata embedded in images (camera, date, GPS).
- **Image Classification**: AI categorization of images by type (interior/exterior) and room.
- **Image Embedding**: Vector representation of image content for similarity search.
- **Floor Plan**: Architectural drawing of property layout, often processed with OCR.

---

## 7. Compliance terms

### 7.1 SOC 2

- **SOC 2 Type II**: Service Organization Control audit covering security, availability, and confidentiality over a period of time.
- **Trust Service Criteria**: SOC 2 control categories (Security, Availability, Processing Integrity, Confidentiality, Privacy).
- **Common Criteria (CC)**: Security controls within SOC 2 (e.g., CC6.1 - Logical Access).

### 7.2 FINRA

- **FINRA Rule 4511**: Books and records retention requirement (6 years, WORM storage).
- **FINRA Rule 3110**: Supervision requirements for registered representatives.
- **WORM (Write Once Read Many)**: Storage that prevents modification or deletion (S3 Object Lock Compliance mode).
- **Legal Hold**: Suspension of retention policy to preserve records for litigation.

### 7.3 Recovery objectives

- **RPO (Recovery Point Objective)**: Maximum acceptable data loss measured in time (target: < 1 second).
- **RTO (Recovery Time Objective)**: Maximum acceptable downtime (target: < 1 minute).

---

## 8. Abbreviations

| Abbreviation | Meaning |
|--------------|---------|
| ABAC | Attribute-Based Access Control |
| ARQ | Async Redis Queue (Python job queue) |
| CRR | Cross-Region Replication (S3) |
| DLQ | Dead-Letter Queue |
| ECS | Elastic Container Service |
| HNSW | Hierarchical Navigable Small World (vector index algorithm) |
| IaC | Infrastructure as Code |
| JWT | JSON Web Token |
| KMS | Key Management Service |
| LLM | Large Language Model |
| MSK | Managed Streaming for Kafka |
| OIDC | OpenID Connect |
| PITR | Point-in-Time Recovery |
| MLS | Multiple Listing Service |
| OCR | Optical Character Recognition |
| RAG | Retrieval-Augmented Generation |
| RBAC | Role-Based Access Control |
| RLS | Row-Level Security |
| RPO | Recovery Point Objective |
| RTO | Recovery Time Objective |
| SLI | Service Level Indicator |
| SLO | Service Level Objective |
| SSE | Server-Side Encryption |
| TLS | Transport Layer Security |
| WORM | Write Once Read Many |
