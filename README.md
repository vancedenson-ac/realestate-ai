# RealTrust AI — Technical Overview

DEMO SITE: https://realtrust-mock-v2.vercel.app/listings

*This document summarizes the security-first, specification-driven architecture of RealTrust AI. All normative requirements are traceable to the canonical spec set in `.cursor/skills/realtrust-backend/references/` and `.cursor/skills/realtrust-frontend/references/`.*

---


1. **Single source of truth for legality** — One state machine spec drives DB seeds, transition function, and negative tests. No handwritten drift; illegal transitions are rejected at the database.
2. **Authorization at the data layer** — RLS and explicit denies make “prove the lender could not see inspections” a matter of policy and evidence, not API discipline.
3. **Evidence-first events** — No event without commit; outbox for publishing; payloads that don’t bypass RLS. Audit and replay are built into the design.
4. **Journey = law + milestone facts** — Every UI step that matters for compliance exists as an authoritative fact in PostgreSQL and, where required, as a DB precondition. CLOSED means deed + ownership transfer, not “button clicked.”
5. **AI is advisory only** — No AI writes to authoritative tables or bypasses access control; provenance and governance are specified (02 §9, 10-ai-boundaries).
6. **Proof-oriented testing** — Invariant and negative tests (illegal transitions, wrong role, explicit denies) demonstrate that the system cannot enter disallowed states or grant disallowed access.



All of the above are in `.cursor/skills/realtrust-backend/references/` and `.cursor/skills/realtrust-frontend/references/`. The implementation in `backend/realtrust-ai/` and `frontend_v2/` is aligned with these specifications to deliver a **security-first, audit-ready, regulator-friendly** real estate transaction platform.
