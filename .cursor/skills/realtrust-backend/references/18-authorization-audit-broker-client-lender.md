# realtrust ai — Authorization Audit: Broker, Client, Lender Rules

This document audits authorization and visibility rules typical for a detailed broker/client/lender application against the realtrust-ai spec and implementation. It is derived from **06-authorization-and-data-access.md**, **17-journey-mapping-and-milestones.md**, **05-transaction-state-machine-spec.md**, **08-database-schema-and-governance.md**, and **09-views-and-apis.md**.

---

## 1. Permission equation (canonical)

**Spec (06):**  
Permission = Organization ∩ Role ∩ Relationship ∩ TransactionState ∩ DataClassification ∩ Jurisdiction

| Factor | Implementation | Status |
|--------|----------------|--------|
| **Organization** | RLS: `transactions.organization_id = app.organization_id`; party/listing/org checks throughout | ✅ Enforced |
| **Role** | `app.role` set from header (dev) / token (prod); transition function uses `allowed_roles` | ✅ Enforced |
| **Relationship** | RLS: `EXISTS (transaction_parties WHERE user_id = app.user_id)` for tx visibility | ✅ Enforced |
| **TransactionState** | Transition legality in DB; LISTED-browse path; PRE_LISTING deny for buyers (added) | ✅ Enforced |
| **DataClassification** | Explicit denies (lender → inspection_report); no full classification enum yet | ⚠️ Partial |
| **Jurisdiction** | RLS: `transactions.jurisdiction` vs `app.license_state` (optional match) | ✅ Enforced |

---

## 2. Transaction visibility (state + role)

| Rule | Spec ref | Backend (RLS/API) | Frontend | Gap / note |
|------|----------|-------------------|----------|------------|
| **BUYER/BUYER_AGENT must NOT see PRE_LISTING** | 06, 17 (PRE_LISTING = seller-side only) | RLS: explicit deny in `tx_visibility_policy`; test: `test_buyer_cannot_see_pre_listing_transaction` | `filterTransactionsByRole()` hides PRE_LISTING for buyer roles | ✅ Addressed |
| **Only LISTED with public listing** visible to non-parties (for offer submission) | 06, 09 | RLS: second branch of `tx_visibility_policy` (LISTED + listing_id + is_public) | N/A | ✅ Enforced |
| **Seller/agent see PRE_LISTING** | 05 (allowed_roles PRE_LISTING→LISTED) | Party path: SELLER/SELLER_AGENT as party | N/A | ✅ Enforced |
| **CLEAR_TO_CLOSE / CLOSED read-only for most roles** | 06 (“state progression collapses permissions”) | No write to `current_state` except via `transition_transaction_state`; no RLS read restriction by state beyond PRE_LISTING | Optional: restrict edits in UI by state | ⚠️ UX only |

---

## 3. Explicit denies (compliance)

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Lender MUST NOT see inspection reports** | 06 §3.1 (canonical) | RLS: `documents`, `document_versions`, `document_chunks`, `document_text`, `document_insert_policy`, `document_update_policy` all have `NOT (document_type = 'inspection_report' AND role = 'lender')` | ✅ Enforced |
| **Lender MUST NOT see inspection rows** (metadata) | 06 §7.4 | Inspections: visible to inspector or party with role IN (BUYER, BUYER_AGENT, SELLER, SELLER_AGENT, ESCROW_OFFICER) — lender not in list | ✅ Enforced |
| **BUYER/BUYER_AGENT must NOT see PRE_LISTING** | 06, 17 | RLS: `tx_visibility_policy` AND NOT (role IN (buyer, buyer_agent) AND state = PRE_LISTING) | ✅ Enforced |

---

## 4. Role-scoped transitions (state machine)

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Transition actor role from session only** | 05, 09 | `transition_transaction_state()` uses `current_setting('app.role', true)`; API does not accept role in body | ✅ Enforced |
| **Only allowed_roles per edge** | 05 | DB: `v_actor_role = ANY(t.allowed_roles)`; seed from 05 spec | ✅ Enforced |
| **PRE_LISTING → LISTED** (SELLER_AGENT only) | 05 | Seed: `ARRAY['SELLER_AGENT']` | ✅ Enforced |
| **LISTED → OFFER_MADE** (BUYER, BUYER_AGENT) | 05 | Seed + offers_insert RLS (LISTED + role BUYER/BUYER_AGENT) | ✅ Enforced |
| **OFFER_MADE → UNDER_CONTRACT** (SELLER, SELLER_AGENT) | 05 | Seed | ✅ Enforced |
| **UNDER_CONTRACT → DUE_DILIGENCE** (ESCROW_OFFICER) | 05 | Seed | ✅ Enforced |
| **DUE_DILIGENCE → FINANCING** (BUYER_AGENT) | 05 | Seed | ✅ Enforced |
| **FINANCING → CLEAR_TO_CLOSE** (LENDER) | 05 | Seed | ✅ Enforced |
| **CLEAR_TO_CLOSE → CLOSED** (ESCROW_OFFICER) | 05 | Seed | ✅ Enforced |
| **Cancellation roles** (PRE_LISTING/LISTED: SELLER; OFFER_MADE: BUYER/SELLER agents; UNDER_CONTRACT: BUYER, SELLER, ESCROW) | 05 | Seed | ✅ Enforced |

---

## 5. Documents and classification

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Inspection report: lender deny** | 06 §3.1, §7.3 | RLS on documents, versions, chunks, text, insert, update | ✅ Enforced |
| **Document insert by type/state/role** | 08, 09 | RLS: offer (LISTED, BUYER/BUYER_AGENT); purchase_agreement (OFFER_MADE, SELLER/SELLER_AGENT); escrow_instructions (UNDER_CONTRACT, ESCROW_OFFICER); loan_commitment (FINANCING, LENDER); funding_confirmation (CLEAR_TO_CLOSE, ESCROW_OFFICER) | ✅ Enforced |
| **CONFIDENTIAL_ROLE / REGULATED** (e.g. title redaction, funding least-privilege) | 06 §3 | No document-level classification column; regulated tables (funding_confirmations, disbursements, deed_recordings, ownership_transfers) use “party to transaction” visibility | ⚠️ Gap: REGULATED could be restricted to ESCROW_OFFICER (and specific roles) for certain tables |

---

## 6. Regulated milestones (escrow, funding, recording)

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Funding confirmations / disbursements / deed / ownership** (REGULATED, least-privilege) | 06 §3, 17 §2.1 | RLS: party to transaction can read/write (no role filter) | ⚠️ Gap: spec suggests state-gated, role-restricted (e.g. only ESCROW_OFFICER for funding_confirmations, disbursements, deed_recordings, ownership_transfers) |
| **Audit evidence for regulated actions** | 17 §6 | `audit_events` table; core/audit.py for append-only evidence | ⚠️ Implementation target; not fully wired to every regulated write |
| **CLOSED = deed recorded + ownership transfer confirmed** | 17 §4, 05 | `assert_transaction_invariants` and transition preconditions; deed_recordings / ownership_transfers tables exist | ⚠️ Preconditions in transition function may not yet assert all journey facts (see 17 §5) |

---

## 7. Showings and buyer identity (side-channel)

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Showings MUST NOT become identity side-channel** | 06 §3 (CONFIDENTIAL_ROLE) | Showings RLS: LENDER cannot see showings via listing path (only created_by/requested_by); explicit deny so lender never sees `requested_by_user_id` (buyer) via showings | ✅ Enforced (explicit deny in showings_visibility) |

---

## 8. Listings and properties

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Public listings** visible to all authenticated | 06, 09 | RLS: `listings.is_public = true` OR listing_agent_id = user OR listing_broker_id = org | ✅ Enforced |
| **Properties** visible when linked listing is public or agent/broker | 08 | RLS: property visible if listing is public or agent/broker | ✅ Enforced |
| **Listings: create/update** by agent or broker | 08 | RLS INSERT/UPDATE: listing_agent_id = user OR listing_broker_id = org | ✅ Enforced |

---

## 9. Offers and offer decisions

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Only BUYER/BUYER_AGENT submit offers** | 05, 09 | RLS offers_insert: party OR (LISTED + role BUYER/BUYER_AGENT). API offers: validation “Only BUYER/BUYER_AGENT can submit offers” | ✅ Enforced |
| **Offer visibility** | 06 | Party to transaction | ✅ Enforced |
| **Offer decisions** (accept/reject) by SELLER/SELLER_AGENT | 05 | Transition OFFER_MADE→UNDER_CONTRACT; offer_decisions RLS: party to transaction (no role restriction on who can insert decision) | ⚠️ Optional: restrict offer_decisions INSERT to SELLER/SELLER_AGENT for accept/reject. |

---

## 10. API and session context

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Session context SET LOCAL** (user_id, organization_id, role, license_state) | 06 §6 | deps.py: `get_db_with_rls` sets app.user_id, app.organization_id, app.role, app.license_state | ✅ Enforced |
| **Context from validated identity in production** | 06 §6 | Dev: headers (X-User-Id, X-Role, etc.); production MUST use token (REALTRUST_AUTH_STRICT=1) | ⚠️ Prod path not implemented |
| **Fail closed if required setting missing** | 06 §6 | RLS policies check `app.user_id IS NOT NULL AND != ''` | ✅ Enforced |
| **Transition command: role from session only** | 05, 09 | POST /transactions/{id}/transitions: body has to_state only; role from app.role | ✅ Enforced |

---

## 11. Frontend (defense in depth)

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **RLS headers sent** (X-User-Id, X-Organization-Id, X-Role) | 09 | api.ts: getRlsHeaders(user); useApi passes user to apiFetch | ✅ Enforced |
| **Hide PRE_LISTING for buyer role in list/dashboard** | 06, 17 | filterTransactionsByRole() in transactions page and DashboardContent | ✅ Addressed |
| **No client-driven authorization** | 09 | Backend is authority; frontend does not grant access | ✅ N/A |

---

## 12. Negative tests (proof suite)

| Rule | Spec ref | Implementation | Status |
|------|----------|----------------|--------|
| **Buyer cannot see PRE_LISTING** | 11, 06 | test_buyer_cannot_see_pre_listing_transaction (list + get 404) | ✅ Added |
| **Illegal transition rejected** | 11, 05 | test_transactions.py (illegal transition) | ✅ Present |
| **Lender cannot see inspection report** | 11, 06 | test_documents_rls::test_lender_cannot_see_inspection_report (Eve GET document → 404) | ✅ Added |
| **Wrong role on transition rejected** | 11, 05 | Milestone gating tests; no full matrix (every edge × wrong role) | ⚠️ Add: e.g. BUYER calls PRE_LISTING→LISTED → 400 |
| **Cross-org isolation** | 11, 06 | No test that org B user cannot see org A transaction | ⚠️ Add |

---

## 13. Summary: gaps and recommended actions

### High priority (compliance / spec alignment)

1. **REGULATED tables (funding, disbursement, deed, ownership)**  
   Consider restricting read/write to ESCROW_OFFICER (and where appropriate LENDER for loan-related) instead of “any party,” and state-gate to CLEAR_TO_CLOSE/CLOSED where applicable.

2. **Showings / buyer identity**  
   ✅ Addressed: RLS showings_visibility denies LENDER access via the listing path (lender only sees rows where they are created_by or requested_by).

3. **Negative tests**  
   Add: lender cannot see inspection report (document/inspection endpoint); wrong-role transition (e.g. BUYER for PRE_LISTING→LISTED); cross-org isolation.

### Medium priority (hardening)

4. **Transaction create**  
   Optionally restrict POST /transactions (initial state PRE_LISTING) to SELLER_AGENT or SELLER so only listing-side can create PRE_LISTING transactions.

5. **Offer decisions**  
   Optionally restrict INSERT on offer_decisions to SELLER/SELLER_AGENT for accept/reject actions.

6. **Document/resource classification**  
   Introduce classification (PUBLIC, TRANSACTION_SHARED, CONFIDENTIAL_ROLE, REGULATED) on documents or resource types and gate RLS by classification + role.

### Lower priority (operational)

7. **Production auth**  
   Implement token-based resolution of user_id, organization_id, role, license_state and enforce REALTRUST_AUTH_STRICT.

8. **Access decision logging**  
   Log allow/deny for sensitive reads (06 §10) to support provability.

---

## 14. Reference quick links

| Doc | Purpose |
|-----|---------|
| 05-transaction-state-machine-spec.md | States, transitions, allowed_roles, preconditions |
| 06-authorization-and-data-access.md | Permission equation, RLS, explicit denies |
| 17-journey-mapping-and-milestones.md | PRE_LISTING semantics, REGULATED milestones, CLOSED definition |
| 08-database-schema-and-governance.md | Schema, RLS patterns, invariants |
| 09-views-and-apis.md | API contracts, command vs query |
| 11-testing-and-proof-suite.md | Negative tests, proof standard |

This audit should be re-run when adding new roles, states, or resource types, or when changing RLS or transition logic.
