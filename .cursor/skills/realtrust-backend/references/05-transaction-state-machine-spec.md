# realtrust ai — Transaction State Machine Specification (Authoritative “Law”)

This document defines the **single authoritative state machine** for realtrust ai transactions.

It is the system’s “law”:

- what transitions are legal
- what preconditions are required
- what evidence must be emitted
- what cross-domain invariants must be asserted

No other document, service, or UI may redefine legality.

---

## 1. Non-negotiable principles

1. **Single source of truth**: there is exactly one authoritative state machine specification.
2. **No handwritten drift**: schema seeds, DB enforcement functions, API guards, and tests are derived from this spec.
3. **No state skipping**: transitions not explicitly listed are illegal.
4. **Terminal states are terminal**: CLOSED and CANCELLED have no outgoing transitions.
5. **Transitions are commands**: state changes are not generic updates; they are validated commands.
6. **DB is final authority**: API may pre-check for UX, but DB enforcement is definitive.

---

## 2. Canonical states (macro-states)

These states model escrow progression at the level required for compliance and audit.

- PRE_LISTING
- LISTED
- OFFER_MADE
- UNDER_CONTRACT
- DUE_DILIGENCE
- FINANCING
- CLEAR_TO_CLOSE
- CLOSED (terminal)
- CANCELLED (terminal)

### 2.1 State semantics (what each state means)

- **PRE_LISTING**: seller/agent preparation; no buyer-facing deal context.
- **LISTED**: listing is active; buyers may view public listing data.
- **OFFER_MADE**: at least one offer exists; negotiation underway.
- **UNDER_CONTRACT**: offer accepted; executed purchase agreement exists.
- **DUE_DILIGENCE**: inspections/appraisals/disclosures and contingency windows are active.
- **FINANCING**: underwriting and lender-driven conditions.
- **CLEAR_TO_CLOSE**: final signatures, funding confirmation, recording readiness; edits collapse.
- **CLOSED**: deed recorded and ownership transfer confirmed; completed; read-only.
- **CANCELLED**: terminated; read-only with cancellation reason captured.

Binding note (journey alignment):

- The user journey includes “sign → disburse → record deed → transfer ownership → post-close”.
- Therefore, `CLOSED` is reached only when recording and ownership transfer evidence exists (see `references/17-journey-mapping-and-milestones.md`).

---

## 3. Canonical machine-readable spec (YAML)

This YAML is the canonical format that downstream generators MUST consume.

```yaml
version: 1
entity: transaction

states:
  - name: PRE_LISTING
    terminal: false
  - name: LISTED
    terminal: false
  - name: OFFER_MADE
    terminal: false
  - name: UNDER_CONTRACT
    terminal: false
  - name: DUE_DILIGENCE
    terminal: false
  - name: FINANCING
    terminal: false
  - name: CLEAR_TO_CLOSE
    terminal: false
  - name: CLOSED
    terminal: true
  - name: CANCELLED
    terminal: true

transitions:
  - from: PRE_LISTING
    to: LISTED
    action: publish_listing
    allowed_roles: [SELLER_AGENT]
    required_documents: [listing_agreement]
    preconditions: [listing_agreement_signed]
    emits_event: ListingPublished

  - from: LISTED
    to: OFFER_MADE
    action: submit_offer
    allowed_roles: [BUYER, BUYER_AGENT]
    required_documents: [offer]
    preconditions: [offer_document_valid]
    emits_event: OfferSubmitted

  - from: OFFER_MADE
    to: LISTED
    action: reject_offer
    allowed_roles: [SELLER, SELLER_AGENT]
    required_documents: []
    preconditions: [rejection_reason_recorded]
    emits_event: OfferRejected

  - from: OFFER_MADE
    to: UNDER_CONTRACT
    action: accept_offer
    allowed_roles: [SELLER, SELLER_AGENT]
    required_documents: [purchase_agreement]
    preconditions: [purchase_agreement_executed, buyer_and_seller_signed]
    emits_event: ContractExecuted

  - from: UNDER_CONTRACT
    to: DUE_DILIGENCE
    action: open_escrow
    allowed_roles: [ESCROW_OFFICER]
    required_documents: [escrow_instructions]
    preconditions: [earnest_money_received, escrow_officer_assigned, compliance_context_resolved]
    emits_event: EscrowOpened

  - from: DUE_DILIGENCE
    to: FINANCING
    action: complete_due_diligence
    allowed_roles: [BUYER_AGENT]
    required_documents: []
    preconditions:
      - inspection_window_closed
      - appraisal_completed_or_waived
      - title_ordered
    emits_event: DueDiligenceCompleted

  - from: FINANCING
    to: CLEAR_TO_CLOSE
    action: approve_funding
    allowed_roles: [LENDER]
    required_documents: [loan_commitment]
    preconditions:
      - loan_approval_issued
      - underwriting_conditions_met
      - title_cleared_or_insured
    emits_event: LoanApproved

  - from: CLEAR_TO_CLOSE
    to: CLOSED
    action: close_transaction
    allowed_roles: [ESCROW_OFFICER]
    required_documents: [funding_confirmation]
    preconditions:
      - all_signatures_completed
      - funds_confirmed
      - disbursement_recorded
      - deed_recorded
      - ownership_transfer_confirmed
    emits_event: TransactionClosed

  # cancellation edges (role-dependent and may require compliance review)
  - from: PRE_LISTING
    to: CANCELLED
    action: cancel_transaction
    allowed_roles: [SELLER, SELLER_AGENT]
    required_documents: []
    preconditions: [cancellation_reason_provided]
    emits_event: TransactionCancelled

  - from: LISTED
    to: CANCELLED
    action: cancel_transaction
    allowed_roles: [SELLER, SELLER_AGENT]
    required_documents: []
    preconditions: [cancellation_reason_provided]
    emits_event: TransactionCancelled

  - from: OFFER_MADE
    to: CANCELLED
    action: cancel_transaction
    allowed_roles: [BUYER, BUYER_AGENT, SELLER, SELLER_AGENT]
    required_documents: []
    preconditions: [cancellation_reason_provided]
    emits_event: TransactionCancelled

  - from: UNDER_CONTRACT
    to: CANCELLED
    action: cancel_transaction
    allowed_roles: [BUYER, SELLER, ESCROW_OFFICER]
    required_documents: []
    preconditions: [cancellation_reason_provided, compliance_review_completed]
    emits_event: TransactionCancelled
```

Notes:

- The cancellation set MAY be expanded by jurisdiction-specific rules, but additions MUST be made in this spec (and thus generate DB/API/tests).
- Some states are “compound” (e.g., DUE_DILIGENCE) and may have internal subflows. Subflows MUST NOT bypass the macro-state machine; they should be modeled as domain facts and preconditions.

---

## 4. Preconditions and invariants

### 4.1 Preconditions are pure predicates

Each precondition MUST be a deterministic predicate over authoritative state. Examples:

- `listing_agreement_signed`: there exists a signed listing agreement document for this transaction context
- `earnest_money_received`: escrow has confirmed deposit receipt (authoritative escrow fact)
- `funds_confirmed`: funding confirmation exists and is verified
- `disbursement_recorded`: a regulated disbursement record exists for this transaction (where applicable)
- `deed_recorded`: a deed recording confirmation exists (authoritative recording fact)
- `ownership_transfer_confirmed`: an ownership transfer confirmation exists (authoritative transfer fact)

Preconditions MUST NOT:

- call external services inline
- depend on time-of-check/time-of-use races without locking semantics

#### Journey-critical precondition glossary (non-exhaustive)

This spec intentionally names preconditions as pure predicates. Implementations MUST map each predicate to authoritative facts in PostgreSQL (tables/rows) and enforce them in the DB transition path (see `08-database-schema-and-governance.md`).

Common journey predicates:

- `appraisal_completed_or_waived`: an appraisal is completed for the transaction, or a waiver fact exists (policy/jurisdiction dependent)
- `title_ordered`: a title order fact exists for the transaction
- `title_cleared_or_insured`: title clearance evidence exists (or an insurance-bound fact exists where policy allows)
- `deed_recorded`: deed recording confirmation exists
- `ownership_transfer_confirmed`: ownership transfer confirmation exists

Canonical journey mapping and gating matrix:

- `references/17-journey-mapping-and-milestones.md`

### 4.2 Cross-domain invariants are asserted during transitions

On transition attempts to target states (especially `CLOSED`), the DB MUST assert cross-domain invariants such as:

- no unresolved critical inspection findings
- required documents exist and are signed
- separation-of-duties constraints are not violated

Additional CLOSE invariants (journey + compliance aligned):

- deed recording confirmation exists (authoritative recording fact)
- ownership transfer confirmation exists (authoritative transfer fact)
- funds disbursement is recorded/authorized where applicable (regulated escrow fact)

These are enforced in the DB transition command (see `08-database-schema-and-governance.md`) and tested (see `11-testing-and-proof-suite.md`).

### 4.3 Journey milestone facts (authoritative subflows)

Many journey steps are not macro-states but MUST still be enforceable and auditable.

Rule:

> Subflows (offers, showings, title, escrow funding, recording) MUST be modeled as authoritative milestone facts and referenced by preconditions/invariants. Subflows MUST NOT bypass the macro-state machine.

Canonical mapping and gating matrix:

- `references/17-journey-mapping-and-milestones.md`

---

## 5. Required generated artifacts (no drift)

The following artifacts MUST be generated from this spec:

### 5.1 Database artifacts

- `transaction_states` seed data (state list + terminal flags)
- `transaction_state_transitions` seed data (edges + roles + doc requirements + event type)
- an authoritative DB function (e.g., `transition_transaction_state(...)`) that:
  - locks the transaction row
  - checks legality of `(from_state, to_state)`
  - checks role eligibility
  - checks transition preconditions (pure predicates over authoritative milestone facts)
  - asserts cross-domain invariants for the target state
  - applies the state update
  - emits domain events (in the same transaction)

### 5.2 API artifacts

- an API registry of legal transitions
- an API guard that rejects illegal transitions with clear errors
- an API command endpoint that calls the DB transition function as final authority

### 5.3 Test artifacts (negative tests)

- for every non-listed `(from_state, to_state)` pair: test that DB rejects
- for every listed transition: test that wrong roles are rejected
- for critical invariants (e.g., inspection secrecy, close prerequisites): tests that violations are impossible

---

## 6. Event emission requirements

Event emission MUST follow the rule:

> If a transition does not commit, no event may exist.

Events MUST be emitted inside the same DB transaction as the state change.

The canonical event spine is specified in `07-events-and-outbox.md`.

---

## 7. Acceptance criteria (“this spec is correctly implemented if…”)

The implementation is correct if:

- the DB cannot represent illegal state transitions (stored procedure rejects, and no alternate mutation path exists)
- events cannot exist without committed facts
- the API cannot cause the DB to violate legality or invariants
- negative tests pass and demonstrate that illegal states are unrepresentable

