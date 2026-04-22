# realtrust ai — Journey Mapping and Milestone Facts (Image → Law → Evidence)

This document maps the **user journey diagram** (listing → offer → escrow → closing → post-close) to:

- the **canonical transaction macro-state machine** (“law”) in `05-transaction-state-machine-spec.md`
- the **authoritative milestone facts** (tables/rows) that make subflows enforceable
- the **evidence spine** (domain events + audit events) required for SOC 2 / FINRA survivability

Core rule:

> The macro-state machine defines legality. Journey “boxes” that are not macro-states MUST be modeled as authoritative milestone facts and enforced as DB preconditions/invariants where required.

---

## 1. Canonical mapping: Journey phases → macro-states

| Journey phase (image) | Macro-state (law) | Notes |
|---|---|---|
| Listing agreement → property prep → create listing → marketing | PRE_LISTING | Prep is a subflow; listing publish transition is the legal edge. |
| Listing active; buyer search/alerts/saved properties; showings/viewing | LISTED | Search/alerts are derived; showings are authoritative scheduling facts. |
| Make/submit offer; negotiation loop; counteroffers; friction points | OFFER_MADE | Negotiation is authoritative as an Offer/Counteroffer chain; macro-state stays OFFER_MADE until executed contract. |
| Purchase contract signed | UNDER_CONTRACT | “Signed contract exists” is an enforceable precondition. |
| Escrow opened; parallel processes start | DUE_DILIGENCE | Due diligence contains inspections/appraisals/title/disclosures as subflows. |
| Underwriting / mortgage processing | FINANCING | Lender-driven conditions; loan commitment is an enforceable fact. |
| Closing preparation; final review/verification; closing day; signing package | CLEAR_TO_CLOSE | Read-only and regulated readiness gating; edits collapse. |
| Disburse funds; record deed; transfer ownership; post-close | CLOSED | **CLOSED means deed recorded and ownership transfer is complete** (see §4). |

---

## 2. Authoritative vs derived: what must exist as facts

### 2.1 Authoritative milestone facts (MUST be persisted in PostgreSQL)

These facts either:

- gate legal state transitions (preconditions), and/or
- are regulated/forensic requirements (audit survivability), and/or
- define visibility boundaries (RLS/classification).

Minimum authoritative milestone fact families:

1. **Offers & negotiation (authoritative, transaction-scoped)**
   - Offer created / countered / withdrawn / rejected / accepted
   - Executed contract references (purchase agreement version + signatures)
2. **Showings (authoritative scheduling)**
   - Showing scheduled / completed / cancelled, tied to listing and optionally a prospective buyer
3. **Title & insurance (regulated-ish, jurisdiction-dependent)**
   - Title order placed, title commitment received, title cleared/exceptioned
   - Insurance bound (when required)
4. **Escrow & funding (REGULATED)**
   - Escrow officer assignment
   - Earnest money deposit confirmation
   - Funding confirmation (cleared funds), disbursement authorization + records
5. **Closing & recording (REGULATED)**
   - Closing package readiness
   - Signatures completed (document signature evidence)
   - Deed recording confirmation
   - Ownership transfer confirmation / possession date

### 2.2 Derived/advisory outputs (MUST NOT be authoritative)

These may appear in the journey diagram but MUST be derived:

- Marketing/analytics dashboards
- AI “insights”, summaries, checklists, risk flags
- Property match scores and explanations
- Notifications

Derived systems MUST subscribe to evidence (domain events) and write only to derived/advisory tables.

---

## 3. Journey boxes → required facts (checklist)

This section lists the journey’s major boxes and what the backend MUST be able to represent.

### 3.1 Pre-listing / listing

- **Listing agreement**: a `listing_agreement` document exists and is signed.
- **Property preparation**: MAY be modeled as tasks, but if it gates listing publish, the gating condition MUST be an authoritative fact (e.g., required disclosures signed).
- **Create property listing**: a `listing` exists with `status=ACTIVE` for publish; listing status changes are authoritative property-domain facts.
- **Marketing & analytics**: derived; MUST NOT gate legality.

### 3.2 Buyer search / alerts / saved

- **Search & alerts**: derived read models + preferences; authoritative records are `buyer_preferences`.
- **Saved searches/properties**: SHOULD be authoritative user-owned rows (preference + saved items) but not regulated.

### 3.3 Agent discovery / showings / viewing

- **Schedule showing**: authoritative `showings` row with time, listing_id, and status.
- **Property viewing**: authoritative “showing completed” or “viewing completed” fact (can be the same row).

### 3.4 Offer / negotiation / counteroffer

- **Make/submit offer**: authoritative `offers` row, plus evidence linking to an offer document (optional) and terms.
- **Negotiation/counteroffer loop**: authoritative “offer chain” as immutable versions or linked offers; contract amendments are evidence.
- **Purchase contract signed**: purchase agreement document version(s) + signatures + “executed” fact.

### 3.5 Escrow opened / parallel processes

- **Escrow opened**: authoritative escrow assignment + earnest money confirmed + escrow instructions signed.
- **Inspection scheduled / report**: authoritative inspection + findings; inspection report is a document with explicit deny to lender.
- **Appraisal ordered / report / value mismatch**: authoritative appraisal; “value mismatch” is derived from appraisal value vs offer/loan constraints but may produce regulated actions (renegotiate/amend).
- **Title search & insurance**: authoritative title order + commitment + clearance.
- **Manage funds transfer**: authoritative funding confirmation + disbursement records.

### 3.6 Closing → post-close

- **Closing preparation**: authoritative checklist readiness is derived; the gating prerequisites MUST be authoritative facts.
- **Closing day / sign documents**: authoritative signature evidence and document locking.
- **Disburse funds**: authoritative disbursement record(s) (REGULATED).
- **Record deed**: authoritative recording confirmation (REGULATED).
- **Transfer ownership**: authoritative ownership transfer confirmation (REGULATED).
- **Post-closing access**: read-only record access; exports must respect legal hold and retention.

---

## 4. Canonical meaning of CLOSED (binding)

To match the journey diagram and compliance expectations:

- **CLOSED** means: **deed recorded** and **ownership transfer confirmed** (and disbursement authorized/recorded where applicable).
- “Closing day signed” is not sufficient to be CLOSED if recording has not occurred.

Implications:

- The transition `CLEAR_TO_CLOSE → CLOSED` MUST assert recording and ownership transfer evidence (in DB preconditions/invariants).
- Any “post-close” experiences MUST be read-only and derive from immutable evidence.

---

## 5. Transition gating matrix (macro edges → milestone facts)

This matrix is the canonical “journey → enforceable law” bridge.

| Macro transition | Required authoritative facts (preconditions) | Required evidence artifacts |
|---|---|---|
| PRE_LISTING → LISTED | listing agreement signed; listing is ACTIVE | signed `listing_agreement` doc; `ListingPublished` event; audit entry for publish |
| LISTED → OFFER_MADE | offer exists (submitted) | `OfferSubmitted` event; offer record (and/or offer doc) |
| OFFER_MADE → UNDER_CONTRACT | accepted offer exists; purchase agreement executed | executed purchase agreement doc version + signatures; `ContractExecuted` event |
| UNDER_CONTRACT → DUE_DILIGENCE | escrow officer assigned; earnest money confirmed; escrow instructions signed; compliance context resolved | `EscrowOpened` event; regulated audit entries for deposit confirmation |
| DUE_DILIGENCE → FINANCING | inspection window closed (or waived); appraisal complete (if required); title ordered (at minimum) | `DueDiligenceCompleted` event; inspection/appraisal events; title events |
| FINANCING → CLEAR_TO_CLOSE | loan commitment issued; underwriting conditions met; title cleared (if required) | `LoanApproved` event; lender audit entries |
| CLEAR_TO_CLOSE → CLOSED | signatures complete; funds confirmed/cleared; disbursement recorded; deed recorded; ownership transfer confirmed | `TransactionClosed` event; regulated audit entries; immutable chain-of-custody |

Notes:

- Jurisdiction/policy MAY alter which facts are required, but any change MUST be versioned and test-gated (see `02-regulatory-and-compliance-spec.md`, `06-authorization-and-data-access.md`, `11-testing-and-proof-suite.md`).
- Preconditions MUST be pure predicates over authoritative facts; no external calls inside the commit.

---

## 6. Compliance evidence requirements per milestone (SOC 2 / FINRA)

For each regulated milestone (funding confirmation, disbursement, recording, policy changes):

- **MUST** write an append-only `audit_events` row (actor, role, IP/UA, outcome, correlation id, hash).
- **MUST** emit a domain event (reference-first payload; no restricted side-channel).
- **SHOULD** log access decisions for sensitive reads/writes (`access_decisions`) to prove “could not access.”

For all evidence/export surfaces:

- FINRA 4511: records MUST be WORM (S3 Object Lock for regulated docs/exports; DB tables revoke UPDATE/DELETE).
- SOC2 CC6.*: prove access boundaries (RLS + explicit denies + negative tests) and traceability (correlation id + OTel).

---

## 7. Implementation drift guard (documentation-first note)

This reference is the canonical mapping and gating intent. If implementation lags:

- the repo MUST be updated to enforce these milestone preconditions/invariants in the DB transition path
- seeds (`transaction_state_transitions.required_documents`) and invariants MUST be kept in sync with `05-transaction-state-machine-spec.md`
- the proof suite MUST add negative tests for the new CLOSE gating facts (deed recording, ownership transfer, disbursement)

Until those changes land in code, treat any “close without recording/transfer evidence” behavior as a known non-compliance gap.

