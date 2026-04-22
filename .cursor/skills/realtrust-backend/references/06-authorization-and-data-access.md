# realtrust ai — Authorization, Data Access, and PostgreSQL RLS (RBAC + ABAC + State)

This document defines the authorization model for realtrust ai and the rules for enforcing it in the database and API.

The guiding requirement:

> Authorization decisions MUST be enforceable at the data layer, not just the API layer.

FastAPI performs intent and UX checks. PostgreSQL RLS performs **final authority** visibility filtering.

---

## 1. The permission equation (canonical)

Every request is evaluated against:

\[
Permission = Organization \cap Role \cap Relationship \cap TransactionState \cap DataClassification \cap Jurisdiction
\]

Implications:

- Organization/tenant isolation MUST be structural. A valid role/relationship in one organization MUST NOT grant visibility into another organization’s data.
- A global “agent” role is insufficient; role is contextual to a transaction.
- A valid role does not imply access if relationship is missing.
- State progression collapses permissions (e.g., CLEAR_TO_CLOSE becomes read-only for many roles).
- Data classification gates visibility even within the same transaction.
- Jurisdiction restrictions must be enforceable without relying on UI discipline.

---

## 2. Roles (canonical set)

- BUYER
- SELLER
- BUYER_AGENT
- SELLER_AGENT
- ESCROW_OFFICER
- LENDER
- APPRAISER
- INSPECTOR
- SYSTEM_AI (service identity)
- ADMIN (break-glass only)

Notes:

- “Agent” is always contextual (buyer’s agent vs seller’s agent).
- ADMIN is not a normal operating role; it is break-glass with strict audit controls.

---

## 3. Resource classification (visibility gates)

Every protected resource MUST have a classification:

- PUBLIC
- TRANSACTION_SHARED
- CONFIDENTIAL_ROLE
- REGULATED
- SYSTEM

Classification guidance for journey milestones (non-exhaustive):

- **Offers / counteroffers**: typically `TRANSACTION_SHARED` (with role-based redaction as needed).
- **Showings**: typically `TRANSACTION_SHARED` or `CONFIDENTIAL_ROLE` if they embed buyer identity; MUST NOT become a side-channel.
- **Escrow funding confirmations / disbursements / deed recording confirmations / ownership transfer records**: `REGULATED` (strong audit, least-privilege, state-gated).
- **Title commitment details**: jurisdiction-dependent; often `TRANSACTION_SHARED` with redaction; exceptions MAY be `CONFIDENTIAL_ROLE` depending on policy.

### 3.1 Explicit deny precedence

Explicit denies MUST override allows.

Canonical example (non-negotiable):

- **DENY** lender access to inspection reports, regardless of any other attributes.

---

## 4. ABAC attribute model (data-driven)

ABAC is expressed via subject, object, and context attributes.

### 4.1 Subject attributes (users)

Required examples:

- license_state / jurisdiction eligibility
- risk clearance
- organization type
- compliance flags

Suggested schema pattern (from prior docs):

```sql
CREATE TABLE subject_attributes (
  user_id UUID NOT NULL,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, attribute)
);
```

### 4.2 Object attributes (transactions/resources)

Required examples:

- transaction jurisdiction
- deal size / offer price
- transaction risk level

Suggested schema pattern:

```sql
CREATE TABLE transaction_attributes (
  transaction_id UUID NOT NULL,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (transaction_id, attribute)
);
```

In practice, many “attributes” SHOULD be modeled as explicit columns on authoritative tables (jurisdiction, offer_price) with attribute tables used for extensibility and policy evolution.

---

## 5. Where authorization is enforced

### 5.1 Layer 1 — API authentication (token verification)

The API MUST validate the caller’s identity (OIDC/OAuth2 token verification).

### 5.2 Layer 2 — API intent checks (UX + clarity)

The API SHOULD reject obviously invalid intents early (wrong role, missing relationship, state mismatch) to provide clear errors.

### 5.3 Layer 3 — Database final authority (RLS + constraints)

The database MUST enforce:

- row visibility (RLS)
- legality of state transitions (stored procedures/constraints)
- cross-domain invariants (assertion functions)

This ensures that even if the API has a bug, data access remains constrained.

---

## 6. PostgreSQL session context (required)

At request entry, the API MUST set PostgreSQL session variables that RLS policies depend on.

Minimum required session settings:

- `app.user_id` (UUID)
- `app.organization_id` (UUID) — effective tenant/org for this request (MUST be derived from validated identity + membership, not caller input)
- `app.role` (effective role for the transaction context; or a list/claims structure if modeling multiple roles)
- `app.jurisdiction` (or `app.license_state` / jurisdiction eligibility attribute)
- optional: `app.risk_clearance`, `app.org_type`, `app.break_glass`

Example:

```sql
SET LOCAL app.user_id = '<uuid>';
SET LOCAL app.organization_id = '<uuid>';
SET LOCAL app.role = 'buyer_agent';
SET LOCAL app.license_state = 'CA';
SET LOCAL app.risk_clearance = 'high';
```

Rules:

- Settings MUST be **transaction-scoped** (`SET LOCAL`) where possible.
- Settings MUST NOT be caller-controlled; they are derived from validated identity and policy evaluation.
- DB connections MUST NOT leak session settings across requests (use transaction scoping and/or explicit resets).
- RLS policies MUST be written to **fail closed** if any required setting is missing (use `current_setting('app.user_id', true)` patterns).

### 6.1 Required DB roles and RLS non-bypass (MUST)

To prevent accidental RLS bypass, the database MUST use role separation:

- **migration_owner** (or equivalent): owns tables, creates/updates RLS policies, runs migrations.
- **app_user** (or equivalent): used by API and workers; MUST NOT own tables and MUST NOT have privileges that bypass RLS.

For tables protected by RLS, the schema SHOULD use:

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` for any table where ownership or privilege could otherwise bypass RLS.

---

## 7. RLS patterns (authoritative enforcement)

### 7.1 Transactions: relationship + jurisdiction (example)

Enable RLS:

```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
```

Policy: caller can read a transaction if they are a party and jurisdiction matches license eligibility.

```sql
CREATE POLICY tx_visibility_policy
ON transactions
USING (
  EXISTS (
    SELECT 1
    FROM transaction_parties tp
    WHERE tp.transaction_id = transactions.transaction_id
      AND tp.user_id = current_setting('app.user_id')::uuid
  )
  AND transactions.organization_id = current_setting('app.organization_id')::uuid
  AND transactions.jurisdiction = current_setting('app.license_state')
);
```

Notes:

- This policy should be complemented with state gating and classification gating in view-level queries as needed.
- Jurisdiction matching MAY be more complex than equality (multi-state licensure); model accordingly.

### 7.2 Deal size / risk gating (example)

Policy: high-value transactions require high clearance.

```sql
CREATE POLICY tx_risk_policy
ON transactions
USING (
  (offer_price < 1000000)
  OR (offer_price >= 1000000 AND current_setting('app.risk_clearance') = 'high')
);
```

### 7.3 Documents: inherit transaction visibility + classification + explicit denies

Enable RLS:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
```

Canonical compliance rule:

- Inspection reports MUST NOT be visible to lenders.

Example policy (illustrative; tune to schema):

```sql
CREATE POLICY document_visibility_policy
ON documents
USING (
  -- explicit deny
  NOT (document_type = 'inspection_report' AND current_setting('app.role') = 'lender')
  AND documents.organization_id = current_setting('app.organization_id')::uuid
  AND EXISTS (
    SELECT 1 FROM transactions t
    JOIN transaction_parties tp ON tp.transaction_id = t.transaction_id
    WHERE t.transaction_id = documents.transaction_id
      AND tp.user_id = current_setting('app.user_id')::uuid
  )
);
```

Classification nuance:

- CONFIDENTIAL_ROLE documents SHOULD enforce owner-role visibility rules (e.g., buyer/buyer-agent only).

### 7.4 Inspections: inspector isolation (example)

Enable RLS:

```sql
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
```

Example:

```sql
CREATE POLICY inspection_policy
ON inspections
USING (
  (current_setting('app.role') = 'inspector' AND inspector_id = current_setting('app.user_id')::uuid)
  OR EXISTS (
    SELECT 1 FROM transaction_parties tp
    WHERE tp.transaction_id = inspections.transaction_id
      AND tp.user_id = current_setting('app.user_id')::uuid
      AND tp.role IN ('buyer','buyer_agent','seller','seller_agent','escrow_officer')
  )
);
```

This policy MUST be paired with document classification policies to prevent inspection report leakage to lender identities.

---

## 8. SYSTEM_AI boundaries (service identity rules)

SYSTEM_AI is not a human user and MUST have:

- read access only to permitted scopes (RLS-filtered views)
- write access only to non-authoritative tables:
  - AI tasks
  - AI insights/outputs
  - draft notifications (if modeled)

SYSTEM_AI MUST NOT be able to:

- call state transition functions
- write to transaction tables directly
- write to regulated/authoritative documents
- bypass RLS

---

## 9. Break-glass admin (strictly controlled)

If an ADMIN break-glass pathway exists:

- it MUST be narrow and time-bounded
- it MUST be explicitly invoked (no implicit “superuser” behavior)
- it MUST generate immutable audit records for all accesses
- it MUST NOT erase the need for RLS; instead it should be implemented as:
  - separate audited access mode, or
  - separate secure reporting exports

---

## 10. Access decision logging (recommended)

For sensitive resources (inspection reports, regulated documents, funding confirmations), the platform SHOULD log allow/deny outcomes with policy version references to support provability.

See `02-regulatory-and-compliance-spec.md`.

---

## 11. Acceptance criteria

This authorization model is correctly implemented if:

- unauthorized rows are physically invisible via RLS (even with raw SQL)
- explicit denies override allows (inspection → lender deny always holds)
- API bugs cannot cause over-read/over-write of authoritative data
- negative tests demonstrate that key leaks and illegal transitions are impossible (`11-testing-and-proof-suite.md`)

