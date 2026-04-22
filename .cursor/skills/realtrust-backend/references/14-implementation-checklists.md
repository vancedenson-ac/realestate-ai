# realtrust ai — Implementation Checklists (Backend, DB, Views, APIs)

This document converts the spec set into concrete implementation checklists.

These checklists are intended for:

- engineering execution planning
- design reviews
- audit readiness gating

**Current status:** See the realtrust-backend skill's "Implementation map" and "Reference–code alignment" in `.cursor/skills/realtrust-backend/SKILL.md` for which checklist items are implemented in `backend/` versus pending (e.g. workers, Alembic, full negative test suite).

---

## 1. Backend service checklist (FastAPI)

- **Framework setup**
  - FastAPI 0.110+ with Pydantic v2
  - SQLAlchemy 2.0 async with asyncpg
  - Alembic for migrations
  - uv for package management
  - Python 3.12+
- **Authn**
  - Validate OIDC/OAuth2 bearer tokens (Cognito).
  - Resolve caller identity to `user_id`.
  - Implement auth provider abstraction for local dev.
- **Contextual authorization**
  - Resolve effective role(s) per transaction (relationship-based).
  - Compute jurisdiction eligibility and other ABAC attributes.
- **DB session context**
  - Set `SET LOCAL app.user_id`, `app.organization_id`, `app.role`, jurisdiction attributes per request transaction.
  - Ensure no session leakage across requests (transaction scoping/reset).
- **Command endpoints**
  - Implement state transition endpoint as a command that calls DB transition function.
  - Ensure no direct updates to `transactions.current_state`.
  - Implement document lock/sign endpoints as commands (audited, event-emitting).
- **Query endpoints**
  - Back query endpoints by RLS-protected tables/views.
  - Never "filter in app" to emulate authorization.
- **Audit integration**
  - Emit audit events for sensitive actions (transition attempts, signing, party changes).
  - Propagate `X-Correlation-Id`.
- **Error discipline**
  - Map DB exceptions to stable API error codes (ILLEGAL_TRANSITION, PRECONDITION_FAILED, etc.).
- **Idempotency**
  - Support `Idempotency-Key` for commands that can be retried safely.
  - Store idempotency keys in PostgreSQL (authoritative) with bounded retention window.
  - Redis MAY be used as a cache, but MUST NOT be the sole source of truth for idempotency.

---

## 2. Database checklist (PostgreSQL)

- **Extensions**
  - Enable `pgvector` for embeddings
  - Enable `postgis` for geographic queries
  - Enable `pgcrypto` for hashing
  - Enable `pg_stat_statements` for monitoring
  - Enable `uuid-ossp` for UUID generation
- **Core tables**
  - `transactions`, `transaction_parties`, `documents`, `document_versions`, `inspections`, etc.
  - Offers/negotiation: `offers`, `offer_decisions`
  - Showings: `showings`
  - Title/recording/transfer: `title_orders`, `title_commitments`, `deed_recordings`, `ownership_transfers`
  - Escrow regulated facts: `earnest_money_deposits`, `funding_confirmations`, `disbursements`
- **State machine**
  - Create `transaction_states`, `transaction_state_transitions` seeded from spec.
  - Implement authoritative transition function with row locking.
- **Cross-domain invariants**
  - Implement invariant assertion function(s) invoked by transition function.
  - Ensure close prerequisites are enforced in DB.
  - Ensure `CLOSED` gating requires deed recording + ownership transfer evidence (journey-aligned meaning of CLOSED).
- **Immutable ledgers**
  - Implement append-only `domain_events`.
  - Implement append-only `audit_events` (SOC 2 + FINRA compliant schema).
- **Outbox**
  - Implement `event_outbox` with Kafka delivery tracking.
  - Track `kafka_partition` and `kafka_offset` for verification.
- **RLS**
  - Enable RLS on transaction-scoped/confidential/regulated tables.
  - Encode explicit denies (inspection → lender).
  - Ensure policies rely on session settings (app.user_id, app.organization_id, app.role, etc.).
  - Ensure policies fail closed when session settings are missing (use `current_setting(..., true)` patterns).
  - For sensitive tables, use `FORCE ROW LEVEL SECURITY` to prevent ownership-based bypass.
- **Privileges**
  - Ensure app DB role cannot bypass RLS.
  - Ensure AI service role cannot write authoritative tables.
  - Revoke UPDATE/DELETE on compliance_records and audit_events.

---

## 3. Views checklist (DB views and API view resources)

- **Define canonical read models**
  - `TransactionOverview`
  - `TransactionDocumentChecklist`
  - `TransactionTimeline`
  - `AuditTimeline` (compliance export)
- **RLS compatibility**
  - Ensure views do not "join around" RLS constraints.
  - Avoid including restricted payloads in views (no side channels).
- **Performance**
  - Add indexes for common filters (transaction_id, emitted_at, state, doc type).
  - Add HNSW index on ai_embeddings for vector search.
  - Use materialized views only for derived analytics where appropriate.

---

## 4. API checklist (contracts)

- **Versioning**
  - Implement `/v1` base path.
- **Standard responses**
  - Implement consistent success and error envelope.
- **Pagination**
  - Cursor-based pagination for lists.
- **Endpoints**
  - Transactions: create/get/list/transition
  - Parties: add/update (highly audited)
  - Documents: create version, lock, sign, process
  - Offers: submit/counter/withdraw/reject/accept (authoritative negotiation)
  - Inspections/Appraisals: create/submit
  - Showings: schedule/list/update
  - Title/recording/transfer: order/commitment/clear; deed recorded; ownership transfer
  - Escrow/funding: assignments; earnest money confirm; funding confirm; disbursements
  - Events: read-only list/stream (policy-filtered)
  - AI: list insights, approve insights, semantic search
- **OpenAPI**
  - Auto-generate OpenAPI spec from FastAPI
  - Version event schemas in Schema Registry (Confluent Schema Registry; JSON Schema)

---

## 5. AI checklist (governance)

- **Service identity**
  - Ensure AI identity is least-privileged and RLS-constrained.
- **Task orchestration**
  - AI reacts to events, not user intent.
  - ARQ workers for task execution.
- **LLM integration**
  - Implement LLMClient abstraction with LiteLLM.
  - Support OpenAI and Anthropic providers.
  - Record all LLM calls with provenance.
- **RAG pipeline**
  - Implement document chunking (1000 tokens, 200 overlap).
  - Generate embeddings with OpenAI text-embedding-3-small.
  - Store embeddings in pgvector.
  - Implement RLS-aware similarity search.
- **Provenance**
  - Store model id/version, prompt template/version, prompt hash, input references.
- **Approval**
  - Implement optional approval gate for sensitive insights.
- **Non-authoritative separation**
  - Ensure AI outputs are stored only as advisory artifacts.

---

## 6. Document processing checklist

- **Text extraction**
  - PDF extraction with PyMuPDF.
  - DOCX extraction with python-docx.
  - OCR fallback with Tesseract for scanned PDFs.
- **Chunking**
  - Semantic chunking with langchain-text-splitters.
  - Token counting with tiktoken.
  - Store chunks in `document_chunks` table.
- **Embedding generation**
  - Batch embedding generation.
  - Store in `ai_embeddings` with pgvector.
- **Worker**
  - ARQ worker for async document processing.
  - Retry policy with DLQ.
- **Docker**
  - Tesseract OCR installed in container.
  - Poppler-utils for PDF support.

---

## 7. Kafka checklist (event streaming)

- **Topics**
  - `realtrust.domain-events` (30-day retention)
  - `realtrust.ai-tasks` (7-day retention)
  - `realtrust.notifications` (7-day retention)
  - `realtrust.audit-events` (1-year retention)
  - `realtrust.dlq.*` (30-day retention)
- **Schema Registry**
  - JSON Schema format for all events.
  - Schema validation before publish.
  - Version increment for breaking changes.
  - Confluent Schema Registry in both local and AWS environments (parity).
- **Consumer groups**
  - `ai-orchestrator`
  - `notification-service`
  - `compliance-exporter`
  - `document-processor`
- **Outbox worker**
  - Poll in transaction order.
  - Publish with transaction_id as partition key.
  - Mark delivered after Kafka ack.
  - Exponential backoff on failures.

---

## 8. Caching checklist (Redis)

- **Use cases**
  - Session cache (1-hour TTL)
  - Rate limiting (1-minute TTL)
  - Idempotency keys (24-hour TTL)
  - Legal transitions cache (5-minute TTL)
- **Restrictions**
  - Never cache authoritative state.
  - Never cache access control decisions.
  - Never cache event data.
- **ARQ**
  - Configure job queues for workers.
  - Set appropriate retry policies.

---

## 9. Compliance checklist (SOC 2 + FINRA)

### 9.1 SOC 2 Type II readiness

- [ ] Access decision logging enabled for all sensitive resources
- [ ] RLS policies tested with negative test suite
- [ ] Encryption verified at rest and in transit
- [ ] Backup and restore procedures tested
- [ ] Incident response procedures documented and tested
- [ ] Multi-region failover tested
- [ ] Change management audit trail complete
- [ ] Vendor security assessments documented

### 9.2 FINRA readiness

- [ ] 6-year retention configured for all regulated records
- [ ] S3 Object Lock enabled for WORM compliance
- [ ] Supervision workflow implemented and tested
- [ ] Legal hold procedures documented
- [ ] Books and records export functionality verified
- [ ] Audit trail immutability verified

### 9.3 Audit evidence generation

- [ ] Transaction timeline export works
- [ ] Document chain-of-custody export works
- [ ] Access decision log export works
- [ ] AI provenance export works

---

## 10. Multi-region checklist

- **Aurora Global Database**
  - Primary in us-east-1
  - Read replica in us-west-2
  - Write forwarding enabled
  - Automated failover configured
- **MSK Kafka**
  - Active cluster in primary region
  - Standby cluster in secondary region (activated on failover)
  - Outbox publisher in active region re-publishes undelivered outbox rows after failover
  - Consumers tolerate duplicates (dedupe by `event_id`)
- **ElastiCache**
  - Global Datastore enabled
  - Automatic failover configured
- **S3**
  - Cross-Region Replication enabled
  - Object Lock for compliance bucket
- **Route 53**
  - Health checks on ALB
  - Failover routing policy
- **Testing**
  - Quarterly DR tests
  - Failover completes within RTO (< 1 minute)
  - Data loss within RPO (< 1 second)
  - DR drill includes verification that outbox republish restores derived systems without violating invariants

---

## 11. Testing checklist (proof suite)

- **Negative tests**
  - Generated illegal transition tests (all non-edges must fail).
  - Wrong-role tests for all legal edges.
- **Invariant tests**
  - Close blocked by unresolved critical inspection findings.
  - Close blocked by missing/unsigned required docs.
  - Close blocked by missing deed recording / ownership transfer evidence.
  - Due diligence progression blocked when required title/appraisal milestone facts are missing (policy/jurisdiction dependent).
- **RLS tests**
  - Forbidden rows invisible under direct SQL.
  - Explicit denies always win (inspection → lender).
  - Missing required session settings deny access (fail closed).
  - Cross-organization isolation holds (org A cannot see org B).
- **Event consistency**
  - No events for failed transitions.
  - Event payloads do not leak restricted fields (reference-first payload discipline).
- **AI safety**
  - AI identity cannot update authoritative tables.
  - RAG respects RLS boundaries.
- **Document processing**
  - PDF extraction works for text and scanned documents.
  - DOCX extraction preserves structure.
  - Chunks inherit document visibility.

---

## 12. Local development checklist

- **Docker Compose services**
  - [ ] API (FastAPI)
  - [ ] WebSocket gateway
  - [ ] PostgreSQL with pgvector and PostGIS
  - [ ] Redis
  - [ ] Kafka + Zookeeper
  - [ ] Schema Registry
  - [ ] MinIO
  - [ ] Outbox worker
  - [ ] AI worker
  - [ ] Document processor
  - [ ] Image processor
  - [ ] Match computer
- **Environment**
  - [ ] `.env` file with all required variables
  - [ ] Database migrations run on startup
  - [ ] Seed data for development
- **Testing**
  - [ ] pytest configured
  - [ ] Test database with RLS enabled
  - [ ] Negative test suite passing

---

## 17. Observability checklist (OpenTelemetry)

- **Tracing standard**
  - [ ] All services use OpenTelemetry SDKs
  - [ ] W3C Trace Context propagation (`traceparent`, `tracestate`)
  - [ ] `X-Correlation-Id` propagated into logs/audit/events (audit correlation)
- **Local**
  - [ ] OTel Collector running in Docker Compose
  - [ ] Jaeger running for trace UI
  - [ ] Prometheus scraping metrics
- **AWS**
  - [ ] ADOT Collector deployed (ECS or sidecar)
  - [ ] Traces exported to X-Ray (or chosen vendor)
  - [ ] Logs in CloudWatch Logs with retention policies

---

## 13. Property and listing checklist

- **Property tables**
  - [ ] `properties` table with PostGIS location column
  - [ ] `listings` table with status workflow
  - [ ] `property_images` table with variant paths
  - [ ] Geographic index on location column
  - [ ] Full-text search index on descriptions
- **Image processing**
  - [ ] Presigned URL generation for uploads
  - [ ] Image validation (format, size, safety)
  - [ ] EXIF metadata extraction
  - [ ] Variant generation (thumbnail, medium, large, webp)
  - [ ] AI image classification (type, room)
  - [ ] Image embedding generation
  - [ ] OCR pipeline for floor plans
- **Search**
  - [ ] Geographic search within radius
  - [ ] Filter by price, beds, baths, property type
  - [ ] Full-text search on description
  - [ ] Sort by price, date, relevance
  - [ ] Image similarity search
- **API endpoints**
  - [ ] Property CRUD
  - [ ] Listing CRUD
  - [ ] Image upload/list/delete
  - [ ] Search endpoint

---

## 14. Messaging checklist

- **Database**
  - [ ] `messaging.chat_rooms` table
  - [ ] `messaging.chat_room_members` table
  - [ ] `messaging.messages` table
  - [ ] `messaging.chat_attachments` table
  - [ ] RLS policies for party-gated access
- **REST API**
  - [ ] Room CRUD endpoints
  - [ ] Message list/send/edit/delete
  - [ ] Member management
  - [ ] Read status tracking
  - [ ] Attachment upload
- **WebSocket**
  - [ ] WebSocket endpoint with JWT auth
  - [ ] Message send/receive handlers
  - [ ] Typing indicators
  - [ ] Presence tracking
  - [ ] Redis Pub/Sub for horizontal scaling
- **Integration**
  - [ ] Transaction chat auto-creation
  - [ ] Property sharing in messages
  - [ ] Document sharing in messages
  - [ ] Notification triggers for offline users

---

## 15. Matching checklist

- **Buyer preferences**
  - [ ] `buyer_preferences` table
  - [ ] Preference embedding generation
  - [ ] Location preferences with PostGIS
  - [ ] Must-have vs nice-to-have separation
- **Match computation**
  - [ ] `property_matches` table
  - [ ] Match score calculation algorithm
  - [ ] Hard filter implementation
  - [ ] Feature scoring
  - [ ] Semantic similarity scoring
  - [ ] Location scoring
- **Match worker**
  - [ ] ARQ worker for match computation
  - [ ] Triggered by listing events
  - [ ] Triggered by preference events
  - [ ] Daily batch recomputation
- **Match explanations**
  - [ ] LLM-generated explanations
  - [ ] Score breakdown display
  - [ ] Provenance tracking
- **Notifications**
  - [ ] Instant notifications for high scores
  - [ ] Daily/weekly digests
  - [ ] User feedback collection
- **API endpoints**
  - [ ] Preference CRUD
  - [ ] Recommendations list
  - [ ] Feedback submission
  - [ ] Agent view (interested buyers)

---

## 16. WebSocket gateway checklist

- **Infrastructure**
  - [ ] FastAPI WebSocket endpoints
  - [ ] JWT validation on connection
  - [ ] Redis Pub/Sub integration
  - [ ] Connection manager with heartbeat
  - [ ] Graceful disconnect handling
- **Scaling**
  - [ ] Multiple gateway instances
  - [ ] Redis channel per room
  - [ ] Presence sync across instances
- **Message handling**
  - [ ] Inbound message validation
  - [ ] Outbound message routing
  - [ ] Error handling and disconnect
  - [ ] Rate limiting per connection
- **Events**
  - [ ] message.new
  - [ ] message.updated
  - [ ] message.deleted
  - [ ] typing.indicator
  - [ ] presence.changed
  - [ ] notification.new
  - [ ] property.match
