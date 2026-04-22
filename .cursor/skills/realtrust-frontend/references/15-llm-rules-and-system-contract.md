# realtrust ai — LLM Rules and System Contract (Machine-Ingestible)

This document is a compact, machine-ingestible contract for LLM consumption and rule setting.

It encodes the highest-priority invariants and prohibitions across the spec set.

If an LLM-generated plan, code change, migration, or API contract violates any **MUST / MUST NOT** below, it is incorrect by definition.

---

## 1. Authority hierarchy (truth, evidence, advice)

- **MUST** treat PostgreSQL authoritative tables as the system of record for binding facts.
- **MUST** treat the transaction state machine as the source of truth for legality.
- **MUST** treat domain events as immutable evidence of committed facts.
- **MUST** treat AI outputs as advisory and non-authoritative.
- **MUST NOT** store AI outputs as authoritative facts.

---

## 2. Transaction legality (state machine)

- **MUST** implement exactly one authoritative state machine spec (`05-transaction-state-machine-spec.md`).
- **MUST** generate DB seeds/guards/tests from the same spec to prevent drift.
- **MUST NOT** allow state skipping.
- **MUST NOT** allow outgoing transitions from terminal states (CLOSED, CANCELLED).
- **MUST** enforce transitions as commands, not generic updates.
- **MUST** ensure the database is final authority for transition legality.
- **MUST** lock the transaction row during transition (`SELECT ... FOR UPDATE`) or equivalent concurrency control.
- **MUST** reject illegal transitions deterministically.

---

## 3. Cross-domain invariants (illegal end states unrepresentable)

When transitioning to CLOSED (and other gated states as defined by policy):

- **MUST** enforce: required documents are present and signed.
- **MUST** enforce: unresolved critical inspection findings prevent closure.
- **MUST** enforce: deed recording and ownership transfer evidence exist (journey-aligned CLOSED meaning).
- **MUST** enforce invariants in the database transition path.
- **MUST NOT** rely solely on API-layer validation for invariants.

## 3.1 Journey milestones vs macro-states (binding)

- **MUST** treat the macro-state machine as legality (“law”) and treat UI journey steps as either:
  - macro-states, or
  - **authoritative milestone facts** (tables/rows) referenced by preconditions/invariants.
- **MUST NOT** implement regulated/journey-critical steps (offers/counteroffers, title clearance, funding/disbursement, deed recording) as “UI-only” flags or derived-only fields.
- **MUST** define `CLOSED` consistently as: deed recorded + ownership transfer confirmed (see `references/17-journey-mapping-and-milestones.md`).

---

## 4. Authorization and data access (RBAC + ABAC + state + classification)

- **MUST** use the canonical permission equation:
  - \(Permission = Organization \cap Role \cap Relationship \cap TransactionState \cap DataClassification \cap Jurisdiction\)
- **MUST** enforce final visibility in PostgreSQL via RLS for transaction-scoped/confidential/regulated tables.
- **MUST** set DB session context per request/transaction (`SET LOCAL app.user_id`, `app.organization_id`, `app.role`, jurisdiction attributes).
- **MUST** ensure RLS policies fail closed when required session settings are missing.
- **MUST NOT** rely on frontend/client-side gating for security.
- **MUST** implement explicit denies for separation-of-duties constraints.
- **MUST** treat “inspection report visible to lender” as structurally impossible (explicit deny wins).

---

## 5. Events and outbox (evidence architecture)

- **MUST** follow: if a transition/fact does not commit, no event may exist.
- **MUST** emit domain events inside the same DB transaction as the authoritative commit.
- **MUST NOT** perform external network calls inside the authoritative commit transaction.
- **MUST** use an outbox (or equivalent) to publish committed events to external systems reliably.
- **MUST** ensure event delivery is idempotent (dedupe on `event_id`).
- **MUST** ensure event payloads do not become an authorization side channel (no leaking restricted facts).
- **MUST** treat Kafka as an event transport for derived behavior; PostgreSQL remains the system of record.

---

## 6. AI governance (advisory-only)

- **MUST** treat AI as a bounded subsystem that reacts to events.
- **MUST** restrict AI reads to RLS-filtered views/resources.
- **MUST** restrict AI writes to advisory artifacts (AI tasks/insights), not authoritative tables.
- **MUST NOT** allow AI to:
  - change transaction state
  - sign/lock documents
  - disburse/approve funds
  - bypass access control
- **MUST** store AI provenance (model id/version, prompt template/version, prompt hash, input references).

---

## 7. Auditing and provability

- **MUST** maintain append-only audit evidence for sensitive actions and policy changes.
- **MUST** be able to reconstruct “what happened, when, who did it” for any transaction.
- **SHOULD** log access decisions for sensitive resources to prove “could not access.”

---

## 8. API and view contract rules

- **MUST** version APIs (e.g., `/v1`).
- **MUST** separate commands (writes) from queries (reads).
- **MUST** ensure all reads are RLS-constrained and classification-aware.
- **MUST NOT** expose raw event payloads if that would leak restricted information.
- **SHOULD** support idempotency keys for retriable commands.
- **MUST** persist idempotency dedupe records in PostgreSQL (authoritative); caches are optional.

---

## 8.1 Observability (OpenTelemetry)

- **MUST** standardize on OpenTelemetry for tracing across API + workers.
- **MUST** propagate W3C Trace Context (`traceparent`, `tracestate`) end-to-end.
- **MUST** propagate `X-Correlation-Id` into logs, audit events, and domain events where applicable.

---

## 9. Proof suite requirements

- **MUST** include generated negative tests proving:
  - all non-edges in the state graph are rejected
  - wrong-role transitions are rejected
  - RLS prevents forbidden reads
  - no events exist for failed transitions
  - AI cannot update authoritative state

---

## 10. Machine-readable contract (summary YAML)

This is a compact summary intended for tooling and prompt injection into LLM system prompts.

```yaml
realtrust_ai_contract:
  authority:
    system_of_record: postgres
    legality_source: transaction_state_machine_spec
    events_are: evidence_of_committed_facts
    ai_is: advisory_only
  prohibitions:
    - no_state_skipping
    - no_terminal_outgoing_transitions
    - no_events_without_commit
    - no_external_calls_inside_commit
    - no_ai_authoritative_writes
    - no_lender_access_to_inspection_reports
  enforcement:
    legality: db_transition_function
    visibility: postgres_rls
    invariants: db_assertions
    publishing: outbox_idempotent_delivery
    tenancy: organization_id_enforced_in_rls
  proof:
    - negative_tests_generated_from_spec
    - rls_visibility_tests
    - event_consistency_tests
    - ai_safety_tests
    - cross_tenant_isolation_tests
```

