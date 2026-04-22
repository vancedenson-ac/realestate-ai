# realtrust ai — Product & Stakeholder Brief (Backend-First)

This document is written for **VC/partner stakeholders** and executive decision-makers. It explains *what realtrust ai is*, why it is defensible, and what is in/out of scope for the platform specification.

---

## 1. Executive summary

**realtrust ai** is a backend-first, escrow-safe transaction infrastructure for real estate deals. It provides:

- **Deterministic transaction progression** via a single authoritative state machine (“law”)
- **Provable access boundaries** via RBAC + ABAC + state gating + data classification, enforced at the **database layer** (PostgreSQL RLS)
- **Immutable evidence trails** (events, audit ledger, access decisions) for regulatory survivability
- **AI augmentation** that is strictly **advisory**, traceable, and non-authoritative

The core strategy is to treat real estate transactions like regulated infrastructure:

- truth is stored as immutable or versioned facts,
- illegal states are unrepresentable,
- access cannot be “accidentally” widened,
- auditability is designed-in, not retrofitted.

---

## 2. The problem (why existing systems fail)

Typical real estate transaction platforms fail structurally in at least one of these ways:

- **State drift**: UI steps and backend states diverge; “what happened” becomes ambiguous over time.
- **RBAC-only authorization**: role-based checks cannot encode contextual and jurisdictional restrictions; privilege creep happens silently.
- **UI/ORM-enforced permissions**: access control exists in application code and is bypassable (bugs, admin tools, direct queries).
- **Non-replayable history**: overwritten data prevents reconstructing timelines for disputes years later.
- **AI safety ambiguity**: AI outputs become treated as truth; provenance is unclear; regulators cannot be satisfied.

Realtrust ai is designed to be robust under the conditions that cause disputes:

- multiple parties with conflicting incentives,
- delayed legal scrutiny,
- cross-jurisdiction compliance requirements,
- high consequences of data leakage and mistaken progression.

---

## 3. The “why now”

Three trends make this architecture essential:

- **Regulatory pressure**: audit survivability and privacy expectations are rising across markets and AI usage.
- **Operational complexity**: timelines, documents, and third-parties create many failure modes.
- **AI adoption**: AI can materially help with summarization, anomaly detection, and procedural guidance—but only when bounded by strong guarantees.

---

## 4. Product scope (backend-only)

This spec set focuses on:

- backend services and domain boundaries
- PostgreSQL schema, row-level security, audit ledgers
- exposed read views and APIs
- event-driven architecture
- AI governance (as a bounded consumer/producer of advisory artifacts)

Explicitly out of scope:

- frontend UI/UX, mobile/web app design
- marketing pages, lead-gen funnels
- client-side authorization (the backend does not rely on it)

---

## 5. Platform differentiators (defensibility)

### 5.1 “Law, evidence, and advice” separation

Realtrust ai formalizes three layers:

- **Law**: the transaction state machine defines what is legal.
- **Evidence**: events and audit logs record only what actually committed.
- **Advice**: AI generates recommendations/summaries that cannot mutate law or evidence.

This prevents the common category error: treating AI and notifications as authoritative.

### 5.2 Database-enforced authorization (provable boundaries)

The platform binds ABAC into PostgreSQL RLS so that:

- even if application logic fails, **data remains physically invisible** to unauthorized users.
- internal tools cannot accidentally over-read.
- AI cannot receive data it is not allowed to see, reducing prompt leakage risk by construction.

### 5.3 Illegal states are unrepresentable

Critical invariants are enforced in the database and verified with a negative test suite:

- state skipping is impossible,
- escrow cannot close with missing prerequisites,
- certain cross-role leaks (e.g., inspection → lender) are structurally blocked.

### 5.4 Replayability and audit survivability

The architecture is designed to answer, years later:

- what happened?
- when?
- who did it?
- who could not have known it?
- what did the system decide, and on what basis?

This is achieved through append-only ledgers, versioning, access decision logs, and event replay.

---

## 6. Risk posture (what can go wrong and how it is contained)

### 6.1 Application bugs

Mitigation:

- DB is final authority for state transitions and access filtering.
- event emission is coupled to commit (no phantom events).

### 6.2 Insider misuse and internal tooling

Mitigation:

- RLS plus explicit denies reduce accidental over-read.
- break-glass admin access is narrow and auditable.

### 6.3 AI failures (hallucinations, privacy leakage)

Mitigation:

- AI is advisory; cannot mutate authoritative state.
- AI provenance is stored (model, prompt hash, input snapshot).
- AI inputs are bounded by RLS-filtered data views.

---

## 7. What the platform guarantees (high-level)

Provided the system is implemented per this spec, realtrust ai guarantees:

- **Deterministic transaction legality**: only legal transitions can commit.
- **Provable access control**: forbidden rows are invisible (RLS); decisions are loggable.
- **Immutable evidence**: events describe committed facts; audit trails are append-only.
- **AI non-authoritativeness**: AI outputs cannot become truth; they are always derived and traceable.

These guarantees are the basis for stakeholder confidence and regulatory survivability.

---

## 8. Implementation philosophy (what engineering must optimize for)

- optimize for **auditability**, not demos
- optimize for **provability**, not “it usually works”
- optimize for **structural compliance**, not policy memos
- optimize for **zero drift** by deriving code/schema/tests from the same specs

---

## 9. Where to go next

For stakeholders who want deeper assurance:

- **Regulatory survivability**: `02-regulatory-and-compliance-spec.md`
- **Architecture overview**: `03-architecture-backend.md`
- **Core legality model**: `05-transaction-state-machine-spec.md`
- **Proof standard**: `11-testing-and-proof-suite.md`

