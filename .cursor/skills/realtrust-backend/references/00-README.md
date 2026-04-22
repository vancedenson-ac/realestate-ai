# realtrust ai — Backend, Data, and API Specifications (LLM + Stakeholder Ready)

This directory is the **canonical specification set** for **realtrust ai** (backend-only).

It is written to serve **three simultaneous consumers**:

- **LLMs / rule-setting systems**: deterministic constraints, invariants, and "non-negotiables"
- **Stakeholders**: VC/partner narrative, risk posture, regulatory survivability
- **Implementers**: backend services, database schema, exposed views, and API contracts

Frontend/client application behavior is explicitly **out of scope** unless it impacts backend guarantees.

---

## How to read this spec set

### Normative language

This spec uses RFC-style keywords:

- **MUST / MUST NOT**: non-negotiable requirements
- **SHOULD / SHOULD NOT**: strong recommendations; deviations require explicit rationale
- **MAY**: optional

Definitions and shared terms live in `13-glossary-and-normative-language.md`.

### LLM consumption guidance (recommended loading order)

If you are building rules, generating code, or answering implementation questions, load:

1. `03-architecture-backend.md` (system shape and boundaries)
2. `05-transaction-state-machine-spec.md` (system "law")
3. `06-authorization-and-data-access.md` (who can see/do what, enforced at DB)
4. `07-events-and-outbox.md` (events as evidence, outbox, Kafka)
5. `08-database-schema-and-governance.md` (how truth is stored and evolved)
6. `09-views-and-apis.md` (API/view contracts)
7. `11-testing-and-proof-suite.md` (executable proofs of invariants)
8. `16-infrastructure-and-deployment.md` (Docker, AWS, multi-region)

### What "backend-complete" means here

This spec set is intended to fully define:

- **Backend service boundaries** and cross-service contracts
- **Canonical domain model**, authoritative vs derived data
- **PostgreSQL schema shape**, including temporal versioning, audit ledgers, pgvector, and PostGIS
- **Authorization model** (RBAC + ABAC + state + classification), including **Postgres RLS**
- **Event model** (domain events as immutable evidence; Kafka-based outbox publishing)
- **Read models**: exposed database views and API view resources
- **API surface**: endpoints, auth, errors, pagination, versioning
- **Real-time communication**: WebSocket-based chat and presence
- **Property management**: listings, images, geographic search
- **AI-powered matching**: buyer preferences, property recommendations
- **Testing strategy**: negative tests that prove illegal states are unrepresentable
- **Infrastructure**: Docker Compose for local development, AWS multi-region for production

---

## Document map (by audience)

### Stakeholders (VC/partner)

- `01-product-and-stakeholder-brief.md`
- `03-architecture-backend.md` (high-level components, defensibility)
- `10-ai-boundaries-and-governance.md` (AI safety posture)
- `02-regulatory-and-compliance-spec.md` (regulatory survivability claims)

### Regulatory / Compliance / Audit

- `02-regulatory-and-compliance-spec.md` (SOC 2 + FINRA requirements)
- `06-authorization-and-data-access.md`
- `07-events-and-outbox.md`
- `08-database-schema-and-governance.md`
- `11-testing-and-proof-suite.md`
- `18-authorization-audit-broker-client-lender.md` (audit of broker/client/lender visibility rules vs implementation)

### Engineering (backend, data, platform)

- `03-architecture-backend.md`
- `04-domain-model.md`
- `05-transaction-state-machine-spec.md`
- `06-authorization-and-data-access.md`
- `07-events-and-outbox.md`
- `08-database-schema-and-governance.md`
- `09-views-and-apis.md`
- `10-ai-boundaries-and-governance.md` (LLM abstraction, RAG pipeline)
- `12-operability-and-sre.md`
- `14-implementation-checklists.md`
- `16-infrastructure-and-deployment.md`
- `17-journey-mapping-and-milestones.md`
- `18-authorization-audit-broker-client-lender.md`

---

## Technology stack (hardened decisions)

| Layer | Technology |
|-------|------------|
| Web Framework | FastAPI 0.110+ with Pydantic v2 |
| WebSocket Gateway | FastAPI WebSocket + Redis Pub/Sub |
| ORM | SQLAlchemy 2.0 (async) |
| Database | PostgreSQL 16 + pgvector + PostGIS (Aurora Global Database) |
| Cache | Redis 7+ (ElastiCache Global Datastore) |
| Message Bus | Apache Kafka (MSK Serverless) |
| Schema Registry | Confluent Schema Registry (local + AWS) |
| Object Storage | S3 with Cross-Region Replication |
| Job Queue | ARQ (Async Redis Queue) |
| Observability | OpenTelemetry (Collector → Jaeger/Prometheus local; X-Ray/CloudWatch in AWS) |
| IaC | Terraform |
| Container Orchestration | ECS Fargate |

---

## The "non-negotiables" (spec spine)

These constraints are repeated across documents; they form the system's backbone.

1. **PostgreSQL is the system of record** for all authoritative facts.
2. **The transaction state machine defines legality ("law")**.
3. **All state changes are commands**; there is exactly one legal mutation path per domain.
4. **Events are evidence of committed facts**; no event may exist unless the corresponding state/fact commit occurred.
5. **AI is advisory, never authoritative**; AI outputs cannot mutate authoritative state or bypass access control.
6. **Separation of duties is structural** (schema + RLS), not a UI convention.
7. **Access control is provable**: explicit denies, access decision logging, and DB-layer enforcement.
8. **Illegal end states are unrepresentable**: invariants enforced in DB; verified by negative tests.
9. **Multi-region ready**: Aurora Global Database with < 1 second RPO, < 1 minute RTO.
10. **Compliance by design**: SOC 2 Type II and FINRA requirements built into architecture.
11. **Chat is auxiliary**: Messaging cannot change transaction state or serve as legal evidence.
12. **Matching is advisory**: Property recommendations are AI-driven and do not affect transaction legality.

---

## Files in this directory

- `00-README.md` (this file)
- `01-product-and-stakeholder-brief.md`
- `02-regulatory-and-compliance-spec.md`
- `03-architecture-backend.md`
- `04-domain-model.md`
- `05-transaction-state-machine-spec.md`
- `06-authorization-and-data-access.md`
- `07-events-and-outbox.md`
- `08-database-schema-and-governance.md`
- `09-views-and-apis.md`
- `10-ai-boundaries-and-governance.md`
- `11-testing-and-proof-suite.md`
- `12-operability-and-sre.md`
- `13-glossary-and-normative-language.md`
- `14-implementation-checklists.md`
- `15-llm-rules-and-system-contract.md`
- `16-infrastructure-and-deployment.md`
- `17-journey-mapping-and-milestones.md`
- `18-authorization-audit-broker-client-lender.md`
- `changes_v1.md` (review document - framework hardening, compliance)
- `changes_v2.md` (review document - messaging, property, matching)
