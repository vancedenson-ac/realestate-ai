# realtrust ai — Testing and Proof Suite (Illegal States Are Unrepresentable)

This document defines the testing strategy for realtrust ai. It emphasizes **negative testing** and proof of invariants.

Core principle:

> We do not test features. We test invariants.

If an invariant can be violated, the system is incorrect even if the UI “works.”

---

## 1. Sources of truth under test

The proof suite MUST derive from:

- `05-transaction-state-machine-spec.md` (legality)
- `06-authorization-and-data-access.md` (access boundaries)
- cross-domain invariants as enforced in DB (`08-database-schema-and-governance.md`)
- event spine requirements (`07-events-and-outbox.md`)
- AI governance requirements (`10-ai-boundaries-and-governance.md`)

Tests MUST NOT assert behavior not defined by these artifacts.

---

## 2. Test taxonomy

### 2.1 State transition impossibility tests (generated)

Claim:

- No illegal `(from_state, to_state)` transition can succeed.

Approach:

- generate all non-listed pairs from the canonical spec and assert the DB transition function rejects them.

Example (illustrative Python):

```python
@pytest.mark.parametrize("from_state,to_state", illegal_transitions)
def test_illegal_state_transition_rejected(db, tx, user, from_state, to_state):
    tx.set_state(from_state)
    with pytest.raises(Exception):
        db.call("transition_transaction_state", tx.id, to_state, user.role)
```

### 2.2 Role violation tests (generated)

Claim:

- Even legal transitions cannot be executed by unauthorized roles.

Example:

```python
def test_agent_cannot_close(db, tx_in_clear_to_close, agent_user):
    with pytest.raises(Exception):
        db.call("transition_transaction_state", tx_in_clear_to_close.id, "CLOSED", "SELLER_AGENT")
```

### 2.3 Cross-domain invariant violation tests (required)

Claims:

- Closing is impossible with unresolved critical inspections.
- Closing is impossible without required signed documents.
- Closing is impossible without deed recording and ownership transfer evidence (journey-aligned CLOSED meaning).
- Closing is impossible without regulated disbursement recorded where applicable.

Related precondition-failure claims (journey gating):

- DUE_DILIGENCE → FINANCING is impossible unless appraisal is completed/waived and title is ordered (where required by policy).
- FINANCING → CLEAR_TO_CLOSE is impossible unless title is cleared/insured where required by policy.

Example:

```python
def test_cannot_close_with_unresolved_critical_inspection(db, tx, escrow_user):
    tx.set_state("CLEAR_TO_CLOSE")
    create_inspection_finding(tx, severity="critical", resolved=False)
    with pytest.raises(Exception):
        db.call("transition_transaction_state", tx.id, "CLOSED", "ESCROW_OFFICER")
```

Additional required cases (conceptual):

```python
def test_cannot_close_without_deed_recording(db, tx_in_clear_to_close, escrow_user):
    create_required_close_documents_signed(tx_in_clear_to_close)
    create_funds_confirmed(tx_in_clear_to_close)
    create_disbursement_recorded(tx_in_clear_to_close)
    # Intentionally omit deed_recorded + ownership_transfer_confirmed
    with pytest.raises(Exception):
        db.call("transition_transaction_state", tx_in_clear_to_close.id, "CLOSED", "ESCROW_OFFICER")

def test_cannot_close_without_ownership_transfer(db, tx_in_clear_to_close, escrow_user):
    create_required_close_documents_signed(tx_in_clear_to_close)
    create_funds_confirmed(tx_in_clear_to_close)
    create_disbursement_recorded(tx_in_clear_to_close)
    create_deed_recorded(tx_in_clear_to_close)
    # Intentionally omit ownership_transfer_confirmed
    with pytest.raises(Exception):
        db.call("transition_transaction_state", tx_in_clear_to_close.id, "CLOSED", "ESCROW_OFFICER")
```

### 2.4 RLS and ABAC impossibility tests (required)

Claims:

- Unauthorized users cannot see forbidden rows even with direct SQL queries.
- Explicit denies are absolute (inspection → lender).
- Missing or incomplete session context MUST fail closed (deny).
- Cross-organization isolation MUST hold (org A cannot read org B).

Example (conceptual):

```python
def test_lender_cannot_query_inspection_report(db, lender_user, tx):
    db.set_context(user=lender_user)
    rows = db.query("SELECT * FROM documents WHERE transaction_id=:tx AND document_type='inspection_report'", {"tx": tx.id})
    assert len(rows) == 0
```

Additional required cases (conceptual):

```python
def test_missing_session_context_denies(db, tx):
    # Deliberately do NOT set app.user_id / app.organization_id
    rows = db.query("SELECT * FROM transactions WHERE transaction_id=:tx", {"tx": tx.id})
    assert len(rows) == 0

def test_cross_org_isolation(db, tx_org_a, user_org_b):
    db.set_context(user=user_org_b)  # sets app.organization_id to org_b
    rows = db.query("SELECT * FROM transactions WHERE transaction_id=:tx", {"tx": tx_org_a.id})
    assert len(rows) == 0
```

### 2.5 Event consistency tests (required)

Claim:

- No event exists for failed transitions.
- Event payloads MUST NOT create a side channel that leaks restricted facts (reference-first discipline).

Example:

```python
def test_no_event_emitted_on_failed_transition(db, tx, agent_user):
    tx.set_state("CLEAR_TO_CLOSE")
    with pytest.raises(Exception):
        db.call("transition_transaction_state", tx.id, "CLOSED", "SELLER_AGENT")
    events = db.query("SELECT * FROM domain_events WHERE aggregate_id=:id", {"id": tx.id})
    assert len(events) == 0
```

Additional required cases (conceptual):

```python
def test_event_payloads_do_not_leak_restricted_fields(db, lender_user, tx):
    db.set_context(user=lender_user)
    # Event APIs (or event views) must not leak restricted content.
    # The test should assert payloads are redacted/minimal or omitted for restricted event types.
    events = db.query("SELECT event_type, payload FROM domain_events WHERE transaction_id=:tx", {"tx": tx.id})
    assert all("inspection_report_text" not in e["payload"] for e in events)
```

### 2.6 AI safety tests (required)

Claims:

- SYSTEM_AI cannot write authoritative state.
- AI outputs can be written only to advisory tables.

Example:

```python
def test_ai_cannot_update_transactions(db, ai_user, tx):
    db.set_context(user=ai_user)
    with pytest.raises(Exception):
        db.execute("UPDATE transactions SET current_state='CLOSED' WHERE transaction_id=:id", {"id": tx.id})
```

---

## 3. Property-based testing (recommended)

Use fuzzing/property-based tests to explore state space:

- random sequences of attempted transitions by random roles
- random document/inspection configurations for close attempts

The invariant remains:

- illegal actions must always be rejected

---

## 4. Database assertions (smoke checks)

Examples of DB-level assertions to run in CI:

- no transactions in unknown states
- no terminal regression (no transitions after terminal states)
- no events without corresponding authoritative facts where applicable

---

## 5. CI enforcement rules

Negative tests are mandatory:

- every schema change
- every RLS policy change
- every state machine spec change
- every policy change

If any invariant test fails, the change MUST NOT merge/deploy.

Additional CI gate (MUST):

- Any change to RLS policies, views, or event payload shaping MUST include new/updated negative tests proving:
  - fail-closed behavior when required session settings are missing
  - no cross-organization reads
  - no event payload side-channels

---

## 6. Implementation status (proof suite)

Current coverage in `backend/tests/`: illegal transition (one case: UNDER_CONTRACT → LISTED rejected), transition not_found, and create with invalid initial_state are tested. **Required next:** parametrized illegal `(from_state, to_state)` matrix (all non-listed pairs rejected), role-violation tests (legal transition with wrong role rejected), RLS impossibility tests (e.g. lender cannot see inspection docs; missing session context denies; cross-org isolation), cross-domain invariant tests (e.g. cannot close with unresolved critical inspection), event-consistency tests (no event row emitted on failed transition), and AI-safety tests (SYSTEM_AI cannot update authoritative tables). Add these as the implementation matures; see SKILL.md "Reference–code alignment" and "Implementation map".

---

## 7. Acceptance criteria

The system meets the “proof standard” if:

- illegal transitions are impossible
- cross-domain close preconditions are enforced structurally
- RLS prevents forbidden reads under all query paths
- events cannot lie (no events without committed facts)
- AI cannot mutate authoritative state and has provable provenance

