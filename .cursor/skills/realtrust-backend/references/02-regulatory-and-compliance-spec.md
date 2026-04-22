# realtrust ai — Regulatory, Compliance, and Audit Survivability Specification

This document defines the compliance-first requirements for **realtrust ai**.

It is not a legal opinion. It is an engineering specification designed to make compliance **structural**:

- enforced in schema and database policies,
- captured in immutable evidence,
- and verifiable through replay and negative tests.

---

## 1. Design axiom: escrow compliance overrides convenience

If a design choice conflicts with escrow compliance, separation of duties, or audit survivability, the design choice is wrong.

This axiom is operationalized as:

- DB-layer enforcement of legality and access boundaries
- append-only evidence trails
- explicit denies for sensitive separations
- provable reconstruction of history

---

## 2. Compliance objectives (what we must be able to prove)

The platform MUST be able to prove, years later:

- **What happened**: authoritative facts and transitions
- **When it happened**: time-ordered evidence with stable timestamps
- **Who did it**: actor identity, effective role, and relationship
- **Who could not have known**: access boundaries enforced at the DB
- **What the system recommended vs what humans executed**: AI outputs are advisory and traceable

The platform MUST be able to support:

- legal discovery/subpoena workflows (exportable evidence)
- regulator/auditor inquiries with minimal inference
- internal incident investigations (forensics-ready logs)

---

## 3. Structural separation of duties (non-negotiable)

Separation of duties MUST be enforced structurally via **schema boundaries + RLS policies + explicit denies**.

### 3.1 Canonical separation examples

1. **Inspection reports**
   - MUST be visible to BUYER and BUYER_AGENT (subject to relationship + state gating)
   - MUST NOT be visible to LENDER (explicit deny overrides all allows)
2. **Appraisals**
   - typically visible to LENDER and ESCROW (and sometimes BUYER_AGENT), jurisdiction-dependent
   - MUST NOT be able to "inherit" inspection visibility
3. **Escrow operations**
   - escrow officer capabilities MUST collapse outside escrow-related states
   - funding confirmations and disbursements MUST be handled under regulated classification

### 3.2 "No shared bucket" rule

The schema MUST NOT use a single undifferentiated "documents" bucket without classification/typing and role-bound visibility semantics.

---

## 4. Evidence model: immutable audit ledger (append-only)

### 4.1 Append-only audit events

The platform MUST maintain an append-only audit ledger capturing:

- event_type
- entity_type
- entity_id/reference
- transaction_id (if applicable)
- actor_id and effective_role
- timestamp (server-side)
- payload snapshot (or structured details)
- payload hash (integrity)
- optional correlation/request id

Rules:

- MUST NOT allow `UPDATE`/`DELETE` of audit records.
- MUST NOT allow unlogged writes for regulated domains (state transitions, document signing/locking, escrow funding confirmations, policy changes).

### 4.2 Why audit is not "logging"

Operational logs are insufficient for compliance. The audit ledger MUST be:

- queryable with stable identifiers
- integrity-protected (hashing / checksums)
- retained per policy (often longer than standard logs)

---

## 5. Access decision evidence (prove you couldn't)

### 5.1 AccessDecision logging (recommended / compliance-critical surfaces)

The system SHOULD log access decisions for sensitive reads/writes:

- user_id, effective_role, organization (if applicable)
- resource_type, resource_id, transaction_id
- decision: allow/deny
- policy reference/version
- timestamp

This allows proving:

- denies happened as required
- attempted violations were rejected
- visibility boundaries were enforced consistently over time

### 5.2 Explicit deny precedence

An explicit deny MUST override any allow (including "admin convenience" paths unless break-glass is invoked).

---

## 6. Policy governance and change control

The platform MUST treat policy changes as regulated changes:

- policies MUST be versioned
- effective dates MUST be tracked (temporal governance)
- changes SHOULD require approvals (org policy dependent)
- policy evaluation MUST reference a policy version

This includes:

- RBAC role/permission mappings
- ABAC attribute definitions
- RLS policy definitions/migrations
- classification rules

---

## 7. Data retention, deletion, and privacy

### 7.1 Immutability vs privacy

Some records must remain immutable for audit/legal reasons. Therefore:

- the platform MUST support **logical deletion** and **anonymization** strategies.
- the platform MUST avoid physical deletion for audit-ledger-like records.

### 7.2 Retention policies

The system MUST support retention policies by entity type and jurisdiction:

- retention period
- anonymization strategy (fields to redact/replace)
- legal hold overrides (see below)

### 7.3 Legal holds

The system MUST support legal holds that prevent deletion/anonymization while a hold is active, and MUST record:

- hold reason
- scope (entity types, transaction ids, user ids)
- start/end dates
- issuer and approvals (org-specific)

---

## 8. Jurisdictional compliance as first-class data

Real estate and lending requirements vary by jurisdiction. The system MUST model a compliance context per transaction:

- jurisdiction identifier(s) (state/county/country as applicable)
- governing ruleset id/version
- retention policy references
- disclosure requirements references

This enables:

- jurisdiction-specific retention windows
- jurisdiction-specific visibility rules
- jurisdiction-specific export/reporting behavior

---

## 9. AI governance and traceability (future-proofing)

### 9.1 AI is advisory and non-authoritative

AI outputs MUST NOT be treated as system-of-record facts.

AI MUST NOT:

- change transaction state
- sign or lock documents
- disburse or approve funds
- override access control

### 9.2 AI provenance requirements

Each AI output MUST store enough provenance to reconstruct and audit:

- model identifier/version
- prompt template/version and prompt hash
- input snapshot references (authorized data only)
- timestamp and initiating event reference
- confidence/quality metadata
- human approval state (if required by policy)

### 9.3 AI "least privilege"

AI processes MUST only read from:

- RLS-filtered views/resources appropriate to the transaction and audience scope
- explicitly authorized datasets

AI processes MUST write only to non-authoritative tables (AI insights/tasks) and must not be able to mutate authoritative state.

---

## 10. Compliance reporting and evidence export

The platform SHOULD provide export mechanisms for:

- transaction timeline (state transitions + document milestones)
- audit ledger extracts (filtered by transaction_id, date range)
- access decision logs (for sensitive resources)
- document chain-of-custody (versions, checksums, who uploaded/locked/signed)

Exports MUST:

- be reproducible (same query inputs produce same outputs)
- include integrity metadata (hashes/checksums)
- respect legal holds and privacy policies

---

## 11. Controls matrix (implementation requirements)

### 11.1 Core controls (MUST)

- **C1: Law is explicit**: state machine transitions and invariants are explicit and enforced at DB.
- **C2: Evidence is immutable**: audit ledger append-only; domain events immutable.
- **C3: Access boundaries are structural**: RLS and explicit denies for critical separations.
- **C4: Separation of duties**: schema + RLS ensure role isolation.
- **C5: Replayable history**: enough evidence exists to reconstruct transaction progression.
- **C6: Least privilege identities**: service identities constrained; break-glass is narrow and audited.

### 11.2 Recommended controls (SHOULD)

- **C7: Access decision logging** for sensitive surfaces
- **C8: Policy versioning** referenced in every decision
- **C9: Integrity hashing** for audit/event payload snapshots

---

## 12. "Pass/fail" audit questions (acceptance criteria)

The platform is considered compliant with this spec if it can answer these without inference:

1. **Timeline**: "Show every state transition and its prerequisites for Transaction T."
2. **Evidence**: "Show every signed document version and checksum at close, plus deed recording and ownership transfer evidence."
3. **Separation**: "Prove the lender could not access the inspection report."
4. **Attempts**: "Show denied attempts (if any) to access inspection data by lender identities."
5. **AI provenance**: "Show what data the AI used, what model, and who approved surfacing it."
6. **Replay**: "Recompute derived outputs and show they match stored advisory outputs (or explain drift)."

---

## 13. SOC 2 Type II compliance

The platform MUST be designed for SOC 2 Type II certification.

### 13.1 Trust Service Criteria mapping

**Security (Common Criteria)**:

| Control | Implementation | Evidence |
|---------|----------------|----------|
| CC6.1 - Logical Access | PostgreSQL RLS, JWT auth, session context | Access decision logs, RLS policies |
| CC6.2 - Access Provisioning | Transaction-party bindings, role assignments | Party change audit events |
| CC6.3 - Access Removal | Party removal workflow, automatic expiration | Party removal events |
| CC6.6 - System Boundaries | VPC isolation, security groups, WAF | Terraform IaC, network logs |
| CC6.7 - Transmission Encryption | TLS 1.3, encrypted S3, KMS | Certificate inventory, KMS policies |
| CC6.8 - Unauthorized Access | RLS explicit denies, break-glass audit | Negative test results, audit logs |

**Availability (A1)**:

| Control | Implementation | Evidence |
|---------|----------------|----------|
| A1.1 - Capacity Planning | Aurora auto-scaling, ECS auto-scaling | CloudWatch metrics, scaling policies |
| A1.2 - Recovery Objectives | Aurora Global DB (RPO < 1s, RTO < 1min) | DR test results, failover logs |
| A1.3 - Backup/Recovery | Automated backups, S3 versioning, CRR | Backup logs, restore test results |

**Confidentiality (C1)**:

| Control | Implementation | Evidence |
|---------|----------------|----------|
| C1.1 - Data Classification | Document classification enum, RLS policies | Schema, classification audit |
| C1.2 - Confidentiality Commitments | Privacy policy, ToS, data handling | Legal documents, training records |

### 13.2 SOC 2 audit event requirements

Audit events for SOC 2 MUST include:

- Actor identification (user_id, role, IP address, user agent)
- Action performed and outcome (success/failure/denied)
- Resource affected (type, id, transaction context)
- Timestamp with timezone
- Correlation ID for request tracing
- Event hash for integrity verification

---

## 14. FINRA compliance

The platform MUST support FINRA compliance for financial industry operations.

### 14.1 FINRA Rule 4511 - Books and Records

**Requirements**:

- Maintain books and records for 6 years (first 2 years readily accessible)
- Records MUST be preserved in non-rewritable, non-erasable format (WORM)

**Implementation**:

- `compliance_records` table with revoked UPDATE/DELETE privileges
- S3 Object Lock for document storage (Compliance mode, 6-year retention)
- Retention tracking with `retention_until` and `legal_hold` fields
- Content hashing (SHA-256) for integrity verification

### 14.2 FINRA Rule 3110 - Supervision

**Requirements**:

- Supervisory system for registered representatives
- Review of communications and transactions
- Escalation procedures

**Implementation**:

- `supervision_cases` table for tracking flagged transactions
- AI-assisted flagging for high-value or unusual transactions
- Approval workflow with audit trail
- Escalation to senior compliance officers

### 14.3 WORM storage compliance

Documents subject to FINRA retention MUST use S3 Object Lock:

- Mode: COMPLIANCE (cannot be overridden, even by root)
- Retention: 6 years minimum
- Applied to: All regulated documents, compliance records, audit exports

---

## 15. Encryption requirements

| Data State | Encryption | Key Management |
|------------|------------|----------------|
| At Rest (Aurora) | AES-256 | AWS KMS (CMK) |
| At Rest (S3) | AES-256 | AWS KMS (CMK) |
| At Rest (ElastiCache) | AES-256 | AWS managed |
| In Transit | TLS 1.3 | ACM certificates |
| Secrets | AES-256 | AWS Secrets Manager |

All encryption keys MUST:

- Enable automatic rotation
- Have restricted key policies
- Be tagged with compliance metadata

---

## 16. Incident response requirements

The platform MUST have documented incident response procedures:

| Severity | Description | Response Time |
|----------|-------------|---------------|
| P1 | Data breach, system-wide outage | 15 minutes |
| P2 | Partial outage, security incident | 1 hour |
| P3 | Performance degradation, minor issue | 4 hours |

**Automated Alerting Triggers**:

- Error rate > 5% (P2)
- Latency p99 > 5s (P3)
- Unauthorized access attempts > 10/min (P1)
- Audit log gap > 5min (P1 - SOC 2 requires continuous logging)

---

## 17. Pointers to implementation specs

- Legality ("law"): `05-transaction-state-machine-spec.md`
- Access boundaries (RBAC/ABAC/RLS): `06-authorization-and-data-access.md`
- Evidence/event spine: `07-events-and-outbox.md`
- Schema governance and auditing patterns: `08-database-schema-and-governance.md`
- Proof suite: `11-testing-and-proof-suite.md`
- Infrastructure and deployment: `16-infrastructure-and-deployment.md`
