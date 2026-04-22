# realtrust ai — Operability, Reliability, and SRE Requirements (Backend)

This document specifies the operational requirements for running realtrust ai backend services and databases reliably and safely.

---

## 1. Operational principles

- Operability is part of compliance: you must be able to explain and reconstruct behavior years later.
- Reliability must not weaken correctness: fail "safe" (deny/stop) rather than "open" on access control and legality.
- Observability must not become a privacy leak: logs and traces must respect classification.

---

## 2. Logging, tracing, and correlation

### 2.1 Correlation IDs (required)

All requests MUST carry or be assigned a correlation id (see `09-views-and-apis.md`).

The correlation id MUST propagate to:

- API logs
- audit events (where applicable)
- domain events (where applicable)
- worker logs for derived effects

### 2.2 Structured logging (required)

Logs MUST be structured (JSON) and include:

- timestamp
- correlation_id
- user_id (where appropriate; avoid storing PII beyond identifiers)
- effective role
- transaction_id (if applicable)
- operation name
- outcome (success/failure)

### 2.3 Tracing (required)

Distributed tracing MUST be used to track:

- API request spans
- DB calls (including transition function invocations)
- outbox publishing worker spans
- AI task execution spans
- Document processing spans

Traces MUST NOT include restricted payloads that would violate classification.

### 2.4 OpenTelemetry standard (MUST)

All services MUST use **OpenTelemetry (OTel)** for traces (and SHOULD use OTel for metrics) to avoid vendor lock-in and ensure consistent correlation across API + workers.

Propagation requirements (MUST):

- Support W3C Trace Context:
  - `traceparent`
  - `tracestate`
- Continue to accept and emit `X-Correlation-Id` for audit correlation, but do not treat it as a trace identifier.

Export strategy:

- Local: OTel Collector → Jaeger (traces) + Prometheus (metrics)
- AWS: OTel Collector → AWS X-Ray (traces) + CloudWatch (logs/metrics)

---

## 3. Observability stack

### 3.1 Required components

| Component | Local Development | AWS Production |
|-----------|-------------------|----------------|
| Metrics | Prometheus | CloudWatch Metrics |
| Traces | Jaeger | AWS X-Ray |
| Logs | stdout (JSON) | CloudWatch Logs |
| Dashboards | Grafana | CloudWatch Dashboards |
| Alerting | Alertmanager | CloudWatch Alarms + SNS |

### 3.2 Required metrics

The platform MUST expose and track these metrics:

**Transaction Metrics**:
- `transaction_transitions_total` (by from_state, to_state, outcome)
- `db_transition_latency_seconds` (histogram)
- `transaction_close_duration_seconds` (time from UNDER_CONTRACT to CLOSED)

**Event Metrics**:
- `outbox_backlog_size` (gauge)
- `outbox_delivery_latency_seconds` (histogram)
- `kafka_publish_success_total` / `kafka_publish_failure_total`

**AI Metrics**:
- `ai_task_duration_seconds` (by task_type)
- `ai_task_success_total` / `ai_task_failure_total`
- `embedding_generation_latency_seconds`

**Document Processing Metrics**:
- `document_extraction_duration_seconds` (by format: pdf, docx)
- `document_chunks_generated_total`
- `ocr_fallback_total` (count of scanned documents)

**Access Control Metrics**:
- `rls_policy_denials_total` (for monitoring)
- `access_decision_allow_total` / `access_decision_deny_total`

### 3.3 SLIs and SLOs

| Service Level Indicator | Target SLO |
|-------------------------|------------|
| API availability | 99.9% |
| State transition success rate | 99.95% |
| Event delivery latency (p99) | < 5 seconds |
| API latency (p99) | < 500ms |
| Document processing latency (p95) | < 30 seconds |

SLOs should prioritize correctness-critical flows:

- state transitions
- document signing/locking milestones
- escrow closing path

---

## 4. Multi-region disaster recovery

### 4.1 Architecture overview

| Component | Primary (us-east-1) | Secondary (us-west-2) |
|-----------|---------------------|----------------------|
| Aurora Global DB | Writer instance | Read replica (auto-promote) |
| Kafka (MSK) | Active cluster | Standby cluster (activated on failover) |
| ElastiCache Redis | Primary | Global Datastore replica |
| S3 | Source bucket | Cross-Region Replication |
| ECS Fargate | Active services | Standby (Route 53 failover) |

### 4.2 Recovery objectives

| Objective | Target | Implementation |
|-----------|--------|----------------|
| RPO (Recovery Point Objective) | < 1 second | Aurora Global replication |
| RTO (Recovery Time Objective) | < 1 minute | Route 53 health check + failover |

### 4.3 Failover strategy

1. **Detection**: Route 53 health checks monitor ALB endpoints in both regions
2. **DNS Failover**: Automatic DNS failover to secondary region on primary failure
3. **Database Promotion**: Aurora Global Database supports managed failover with automatic promotion
4. **Event Recovery**: outbox publisher in the active region re-publishes undelivered outbox rows to the active region’s Kafka cluster
5. **Derived System Recovery**: Kafka consumers MUST tolerate duplicates (dedupe by `event_id`) and re-hydrate state from PostgreSQL under RLS as needed
6. **Cache Warming**: ElastiCache Global Datastore maintains cache consistency (derived)

### 4.4 Backup requirements

The platform MUST support:

- regular automated backups
- point-in-time recovery (PITR) with 35-day retention
- backup encryption using AWS KMS
- tested restore procedures (quarterly)

**Backup Schedule**:

| Component | Backup Type | Retention |
|-----------|-------------|-----------|
| Aurora | Automated + PITR | 35 days |
| S3 Documents | Versioning + CRR | Indefinite (lifecycle rules apply) |
| Kafka Topics | Log retention | 30 days (domain events), 1 year (audit) |
| Redis | Snapshots | 7 days |

### 4.5 Restore testing (required)

Restore procedures MUST be tested quarterly.

The platform MUST verify after restore that:

- schema version is correct
- RLS policies are present and enabled
- append-only ledgers preserve integrity
- pgvector indexes are functional

---

## 5. Secrets and key management

### 5.1 Secrets storage

| Environment | Secret Store | Access Method |
|-------------|--------------|---------------|
| Local | `.env` file (gitignored) | python-dotenv |
| AWS | AWS Secrets Manager | IAM role + boto3 |

### 5.2 Managed secrets

- Database credentials
- Redis credentials (if auth enabled)
- Kafka credentials (MSK IAM or SASL)
- S3/MinIO credentials
- LLM API keys (OpenAI, Anthropic)
- Cognito client secrets
- Encryption keys (KMS key ARNs)

### 5.3 Rotation requirements

- Secrets MUST NOT be stored in source control.
- Credentials MUST be rotated (90-day maximum for production).
- Service identities MUST be least-privileged.
- KMS keys MUST have automatic rotation enabled.

---

## 6. Migration safety

Schema migrations MUST be:

- versioned and reproducible
- run with appropriate maintenance windows or online-safe strategies
- validated via the proof suite (`11-testing-and-proof-suite.md`)

RLS/policy migrations are high risk and MUST be tested for:

- "fail closed" semantics (no accidental broadening)
- explicit denies still holding

---

## 7. Incident response and forensics readiness

### 7.1 Incident severity levels

| Severity | Description | Response Time | Notification |
|----------|-------------|---------------|--------------|
| P1 | Data breach, system-wide outage | 15 minutes | PagerDuty, Executive, Legal |
| P2 | Partial outage, security incident | 1 hour | PagerDuty, Engineering Lead |
| P3 | Performance degradation, minor issue | 4 hours | Slack on-call |

### 7.2 Automated alerting triggers

- Error rate > 5% (P2)
- Latency p99 > 5s (P3)
- Unauthorized access attempts > 10/min (P1)
- Audit log gap > 5min (P1 - SOC 2 requires continuous logging)
- Outbox backlog age > 5min (P2)
- Database connection pool exhaustion (P2)

### 7.3 Forensics capabilities

The platform MUST be able to support investigations by:

- reconstructing a transaction's evidence timeline
- extracting audit trails for access and actions
- identifying attempted unauthorized reads/writes (if access decision logging enabled)

Incident processes SHOULD include:

- data classification impact analysis
- policy regression checks (RLS drift)
- postmortem documentation with references to evidence timelines

---

## 8. Operational failure mode requirements

### 8.1 Outbox publisher failure

If outbox publishing fails:

- transactional correctness MUST remain intact
- events remain stored and can be delivered later
- backlog metrics trigger alerting

### 8.2 AI subsystem failure

If AI workers fail:

- no authoritative path may be blocked
- AI artifacts may be delayed or missing without impacting transaction legality
- degraded mode notifications to users

### 8.3 Document processing failure

If document processing fails:

- document upload succeeds (S3 storage is authoritative)
- text extraction and embeddings are retried
- transactions can proceed without AI-derived insights

### 8.4 Authorization uncertainty

If the system cannot confidently evaluate authorization (missing session vars, policy errors):

- it MUST deny rather than allow
- audit log the denial with reason

### 8.5 Multi-region failover

If primary region fails:

- Route 53 detects failure within 30 seconds
- DNS failover to secondary region
- Aurora promotes read replica to writer
- Kafka consumers resume from last offset
- Users experience < 1 minute of unavailability

---

## 9. Acceptance criteria

Operations are compliant with this spec if:

- the system can be restored and proven correct (schema + RLS + ledgers)
- logs/traces support investigations without leaking restricted payloads
- critical flows have measurable SLIs/SLOs
- failures degrade safely (deny/stop) rather than widening access or violating legality
- multi-region failover completes within RTO (< 1 minute)
- quarterly DR tests pass successfully
