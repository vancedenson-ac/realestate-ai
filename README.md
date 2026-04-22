# RealTrust AI — Technical Overview

*This document summarizes the security-first, specification-driven architecture of RealTrust AI. All normative requirements are traceable to the canonical spec set in `.cursor/skills/realtrust-backend/references/` and `.cursor/skills/realtrust-frontend/references/`.*

---

## 1. Design axiom: compliance overrides convenience

**Policy (02-regulatory-and-compliance-spec):**  
*“If a design choice conflicts with escrow compliance, separation of duties, or audit survivability, the design choice is wrong.”*

The platform is built so that:

- **Legality and access are enforced in the database**, not in application code alone.
- **Evidence is append-only**; no UPDATE/DELETE on audit or domain-event ledgers.
- **Explicit denies win** (e.g. lender cannot see inspection reports—ever).
- **Illegal end states are unrepresentable** and verified by negative tests.

This makes the system **provable** to auditors and regulators: “Show that the lender could not access the inspection report” is answered by RLS policies and access-decision logs, not by trust in the API.

---

## 2. Authority hierarchy: truth, evidence, advice

**Policy (15-llm-rules-and-system-contract, 03-architecture-backend):**

| Layer | What it is | Rule |
|-------|------------|------|
| **PostgreSQL** | System of record for binding facts | All authoritative writes go through a single legal mutation path (DB functions/constraints). |
| **Transaction state machine** | Source of truth for legality | Exactly one spec (`05-transaction-state-machine-spec`); seeds, guards, and tests are derived from it. No state skipping; terminal states (CLOSED, CANCELLED) have no outgoing transitions. |
| **Domain events** | Evidence of committed facts | Events are effects, never causes. If a transition does not commit, no event may exist (07-events-and-outbox). |
| **AI** | Advisory only | AI MUST NOT change transaction state, sign documents, disburse funds, or override access control (02 §9, 10-ai-boundaries-and-governance). |

**Concrete example — CLOSED:**  
Per `17-journey-mapping-and-milestones`, **CLOSED** is defined as: deed recorded **and** ownership transfer confirmed. The DB transition function enforces this via preconditions; “closing day signed” alone is insufficient. Illegal states (e.g. CLOSED without deed evidence) cannot be represented in the schema.

---

## 3. Authorization: permission equation and RLS as final authority

**Policy (06-authorization-and-data-access):**  
*“Authorization decisions MUST be enforceable at the data layer, not just the API layer.”*

**Permission equation (canonical):**

\[
\text{Permission} = \text{Organization} \cap \text{Role} \cap \text{Relationship} \cap \text{TransactionState} \cap \text{DataClassification} \cap \text{Jurisdiction}
\]

- **Organization:** Row-level visibility is scoped to `organization_id`; cross-tenant access is structurally impossible.
- **Role:** Set from **session only** (`current_setting('app.role')`). The API does **not** accept role or user_id in request bodies for transitions or role-scoped commands (09-views-and-apis, 18-authorization-audit §10).
- **Explicit deny precedence:** Per 06 §3.1, an explicit deny overrides any allow. **Canonical example:** Lender access to inspection reports is **denied** in RLS on `documents`, `document_versions`, `document_chunks`, `document_text`, and inspection metadata; the lender never sees inspection data regardless of relationship (18-authorization-audit §3).

**Where it is enforced:**

- **Layer 1:** API validates identity (token in production).
- **Layer 2:** API may reject obviously invalid intents for UX.
- **Layer 3:** **Database is final authority** — RLS policies and transition constraints enforce visibility and legality. A bug in the API cannot grant access the DB denies.

**Frontend (20-api-contract-frontend):**  
Every request sends RLS headers (`X-User-Id`, `X-Organization-Id`, `X-Role`). The frontend does **not** send role in mutation bodies; the backend derives the actor from session. Security is not delegated to the UI—hiding a button is UX only; the backend must reject unauthorized actions.

---

## 4. Transaction state machine: single source of truth

**Policy (05-transaction-state-machine-spec):**  
*“No other document, service, or UI may redefine legality.”*

- **States** are canonical (PRE_LISTING → LISTED → … → CLEAR_TO_CLOSE → CLOSED / CANCELLED). Terminal states have no outgoing transitions.
- **Transitions** are **commands**: each edge has `allowed_roles`, `required_documents`, `preconditions`, and `emits_event`. The DB function `transition_transaction_state()` enforces them; the API calls the DB and does not re-implement legality.
- **Seeds** for `transaction_states` and `transaction_state_transitions` are generated from the same spec to prevent drift.
- **Journey milestones** (e.g. title ordered, appraisal completed/waived, deed recorded, ownership transfer) are **authoritative facts in PostgreSQL**, not UI flags. They gate transitions (e.g. DUE_DILIGENCE → FINANCING requires title ordered and appraisal or waiver per 17-journey-mapping-and-milestones).

**Concrete example — regulated writes:**  
Funding confirmations, disbursements, deed recordings, and ownership transfers are **REGULATED** (06 §3). RLS and state gating restrict who can insert; e.g. only ESCROW_OFFICER in CLEAR_TO_CLOSE for funding/disbursement. Attempts by wrong role or wrong state return 403 FORBIDDEN_BY_POLICY with a server message—auditable and testable.

---

## 5. Events and evidence: no event without commit

**Policy (07-events-and-outbox):**  
*“Events are effects, never causes. If a state transition does not commit, no event may exist.”*

- **Domain events** are written in the **same transaction** as the authoritative commit. No event is emitted for a failed transition.
- **Storage:** `domain_events` (and equivalent) are **append-only**; no UPDATE/DELETE.
- **Payloads** must not become an authorization side-channel: reference-first (identifiers + policy-safe summaries); consumers re-hydrate from PostgreSQL under RLS where applicable.
- **Outbox:** Publishing to Kafka or other consumers is done via an outbox (or equivalent) after commit, so delivery is reliable and decoupled from the write path.

**Audit (02-regulatory-and-compliance-spec §4–5):**  
The platform maintains an **append-only audit ledger** (event_type, entity, actor_id, effective_role, timestamp, payload snapshot, payload hash). **AccessDecision** logging records allow/deny for sensitive reads (e.g. GET transaction, GET document, GET inspection) so that “prove the lender could not access the inspection report” and “show denied attempts” are answerable from evidence.

---

## 6. Schema and invariants: legality in the database

**Policy (08-database-schema-and-governance):**  
*“Truth lives in Postgres; legality is enforceable; visibility is enforceable; evidence is immutable.”*

- **Authoritative vs derived:** Authoritative tables (transactions, parties, documents, escrow/title milestones) are clearly separated from derived/advisory (e.g. AI insights) and immutable ledgers (`domain_events`, `audit_events`).
- **Transition function:** All state changes go through a single DB function that (1) validates from_state → to_state, (2) checks allowed_roles from session, (3) asserts preconditions (e.g. required documents signed, deed/ownership facts), (4) updates state, (5) writes domain event in the same transaction. Concurrency is handled (e.g. `SELECT ... FOR UPDATE`).
- **RLS:** Every request sets `app.user_id`, `app.organization_id`, `app.role` (and optionally jurisdiction). Policies fail closed if required settings are missing.

---

## 7. Testing: invariants, not just features

**Policy (11-testing-and-proof-suite):**  
*“We do not test features. We test invariants. If an invariant can be violated, the system is incorrect even if the UI works.”*

- **Illegal transition tests:** Generated or parametrized tests assert that every **non-allowed** (from_state, to_state) pair is **rejected** by the DB transition function.
- **Role violation tests:** Legal transitions are rejected when executed by an unauthorized role (e.g. SELLER_AGENT cannot execute CLEAR_TO_CLOSE → CLOSED).
- **Cross-domain invariant tests:** e.g. Cannot close without deed recording and ownership transfer; cannot enter FINANCING without title ordered and appraisal/waiver where required.
- **Explicit deny tests:** e.g. Lender receives empty list or 403 for inspection reports; buyer cannot see PRE_LISTING transactions (18-authorization-audit).

The test suite is derived from the same specs (05, 06, 08, 17) so that **illegal states remain unrepresentable** in implementation.

---

## 8. Regulatory and compliance alignment

**SOC 2 (02 §13):**  
Designed for SOC 2 Type II. Controls map to Trust Service Criteria (e.g. CC6.1 Logical Access → RLS + JWT + session context; CC6.8 Unauthorized Access → RLS explicit denies + negative tests).

**FINRA 4511 — Books and records (02 §14):**  
Records preserved in non-rewritable, non-erasable format (WORM). Audit and compliance ledgers are append-only; production MUST revoke UPDATE/DELETE for app role on `audit_events` (and `compliance_records` where applicable).

**Separation of duties (02 §3, 06 §3.1):**  
Structurally enforced: inspection reports (lender deny), escrow operations (state-gated, role-restricted), document types (insert policy by document_type, state, and role). “No shared bucket” rule: documents are classified and role-bound; no undifferentiated bucket without visibility semantics.

**Access decision evidence (02 §5):**  
Sensitive reads (transaction get, document get, inspection get) log AccessDecision (allow/deny, identity, resource, policy_reference) so that denials and attempted violations are provable.

---

## 9. Frontend: zero security in the UI

**Policy (19-architecture-frontend, 20-api-contract-frontend):**  
The frontend passes RLS context on **every** request; it does not enforce authorization. Types and API paths are aligned with backend contracts; path rules (e.g. no prepending domain for no-prefix routers: `transactions/${id}/offers`, not `offers/transactions/...`) ensure compliance with backend routing and 09-views-and-apis.

- **Auth:** Identity from verified token in production; RLS headers (or backend-derived context from token) only. No client-supplied role in mutation bodies.
- **Errors:** 403/404 and structured error codes (ILLEGAL_TRANSITION, PRECONDITION_FAILED, FORBIDDEN_BY_POLICY) are surfaced via a single toast/error path; precondition messages are mapped to user-friendly copy (e.g. “Complete the appraisal or waive it before moving to Financing”) per backend policy.

---

## 10. Why this is groundbreaking

1. **Single source of truth for legality** — One state machine spec drives DB seeds, transition function, and negative tests. No handwritten drift; illegal transitions are rejected at the database.
2. **Authorization at the data layer** — RLS and explicit denies make “prove the lender could not see inspections” a matter of policy and evidence, not API discipline.
3. **Evidence-first events** — No event without commit; outbox for publishing; payloads that don’t bypass RLS. Audit and replay are built into the design.
4. **Journey = law + milestone facts** — Every UI step that matters for compliance exists as an authoritative fact in PostgreSQL and, where required, as a DB precondition. CLOSED means deed + ownership transfer, not “button clicked.”
5. **AI is advisory only** — No AI writes to authoritative tables or bypasses access control; provenance and governance are specified (02 §9, 10-ai-boundaries).
6. **Proof-oriented testing** — Invariant and negative tests (illegal transitions, wrong role, explicit denies) demonstrate that the system cannot enter disallowed states or grant disallowed access.

**Spec references (canonical):**  
Backend: `02-regulatory-and-compliance-spec`, `03-architecture-backend`, `05-transaction-state-machine-spec`, `06-authorization-and-data-access`, `07-events-and-outbox`, `08-database-schema-and-governance`, `11-testing-and-proof-suite`, `17-journey-mapping-and-milestones`, `18-authorization-audit-broker-client-lender`.  
Frontend: `19-architecture-frontend`, `20-api-contract-frontend`, `21-ui-journey-and-pages`.  
Cross-cutting: `15-llm-rules-and-system-contract`, `13-glossary-and-normative-language`.

All of the above are in `.cursor/skills/realtrust-backend/references/` and `.cursor/skills/realtrust-frontend/references/`. The implementation in `backend/` and `frontend/` is aligned with these specifications to deliver a **security-first, audit-ready, regulator-friendly** real estate transaction platform.
