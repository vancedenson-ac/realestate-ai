# Skills and implementation audit (Feb 2025)

Audit of **realtrust-backend** and **realtrust-frontend** skills against the current application in `backend` and `frontend`, with focus on RBAC/ABAC documentation, FINRA/SOC2 alignment, and flexibility for adding features.

---

## 1. Summary

- **Backend skill** and **frontend skill** are aligned with the codebase. Gaps found and fixed:
  - **Frontend API paths:** Several domain APIs used incorrect paths (prepended domain segment for no-prefix backend routers). Corrected in `frontend/src/lib/api.ts`.
  - **Documentation:** Backend skill now includes an explicit **RBAC/ABAC and FINRA/SOC2 alignment** section; frontend skill and `20-api-contract-frontend.md` now state the path rule and compliance notes. API surface table in backend skill now clarifies router prefix vs no-prefix and lists exact escrow/title paths.
- **Authorization (06, 18):** Already well documented. Implementation matches spec (RLS, session context, explicit lender→inspection deny, transition role from session). Remaining gaps are called out in `18-authorization-audit-broker-client-lender.md` (e.g. REGULATED table role restriction, cross-org negative test).
- **Compliance:** Skills and references now make it explicit that authorization is structural (DB-enforced), audit evidence is append-only, and adding features requires updating auth/schema refs and negative tests.

---

## 2. Changes made

### 2.1 Frontend `src/lib/api.ts` (path fixes)

Backend mounts **offers**, **showings**, **documents**, **inspections**, **appraisals**, **events**, **escrow**, and **title** with **no prefix**. Paths are as written in the endpoint (e.g. `transactions/{id}/offers`). The frontend was incorrectly prepending the domain (e.g. `offers/transactions/...`). Updated:

| API | Before | After |
|-----|--------|-------|
| offersApi | `/offers/transactions/${id}/offers`, `/offers/offers/${id}/counter` etc. | `transactions/${id}/offers`, `offers/${id}/counter` etc. |
| showingsApi | `/showings/listings/${id}/showings`, `/showings/showings/${id}` | `listings/${id}/showings`, `showings/${id}` |
| inspectionsApi | `/inspections/transactions/...`, `/inspections/inspections/${id}` | `transactions/.../inspections`, `inspections/${id}` |
| appraisalsApi | `/appraisals/transactions/...`, `/appraisals/appraisals/${id}` | `transactions/.../appraisals`, `appraisals/${id}` |
| eventsApi | `/events/transactions/${id}/events` | `transactions/${id}/events` |
| escrowApi | `/escrow/transactions/.../escrow/...` | `transactions/.../escrow/assignments` etc. |
| titleApi | `/title/transactions/.../title/...`, `/title/title/orders/${id}` | `transactions/.../title/orders` etc., `title/orders/${id}` |

Documents API was already correct (`transactions/${tid}/documents`, `documents/${id}`).

### 2.2 Backend skill (`.cursor/skills/realtrust-backend/SKILL.md`)

- **New section: "RBAC/ABAC and FINRA/SOC2 alignment (self-documenting compliance)".** Covers: permission equation (06), explicit denies, role from session only, audit evidence, and a 4-step checklist for adding new resources/actions. References 02, 06, 18.
- **API surface table:** Renamed column to "Router prefix"; added a **path rule** for clients (no duplicate prefix for no-prefix routers). Filled in exact escrow and title path patterns. Showings row corrected to GET/POST and PATCH.

### 2.3 Frontend skill (`.cursor/skills/realtrust-frontend/SKILL.md`)

- **Non-negotiables:** Added **path rule** bullet (no prepending domain; link to 20-api-contract and backend API surface).
- **Implementation map:** API client row updated to state path rule and examples (`transactions/${id}/offers`, `listings/${id}/showings`, etc.).
- **Backend alignment:** Pointed to full path table in 20-api-contract; added **Compliance (FINRA/SOC2 alignment)** bullet (RLS headers, no role in body, role-based nav as UX only).

### 2.4 Frontend reference `20-api-contract-frontend.md`

- **Section 3:** Replaced short path examples with **exact path table (3.1)** listing every domain and path segment used in the client. New endpoints should be added here and in `api.ts` with the same path.
- **New 3.2 Compliance:** RLS headers required; do not send role/user_id in body for role-scoped operations.

---

## 3. Current alignment checklist

| Area | Status | Notes |
|------|--------|-------|
| Backend API surface ↔ skill table | ✅ | Router prefix and paths match `router.py` and endpoint files. |
| Frontend api.ts paths ↔ backend | ✅ | Paths fixed; match 20-api-contract and backend. |
| RLS / session context | ✅ | deps.py sets app.user_id, app.organization_id, app.role; RLS uses them. |
| Explicit denies (lender → inspection) | ✅ | Document and inspection RLS enforce; test in test_documents_rls. |
| Transition role from session | ✅ | POST /transitions uses DB session role; no role in body. |
| Audit events for regulated milestones | ✅ | escrow/title endpoints call write_audit_event. |
| Frontend RLS headers on every request | ✅ | getRlsHeaders(user) in apiFetch. |
| Frontend no role in mutation body | ✅ | Transition and offer/escrow/title use session identity. |
| Path rule documented | ✅ | Backend skill, frontend skill, 20-api-contract. |
| Compliance / RBAC refs in skills | ✅ | Backend: new section + refs to 02, 06, 18. Frontend: compliance bullet + 20. |

---

## 4. Recommended next steps (from ref 18 and 11)

- **Negative tests:** Cross-org isolation (org B user cannot see org A transaction); wrong-role transition (e.g. BUYER for PRE_LISTING→LISTED).
- **REGULATED tables:** Consider restricting funding/disbursement/deed/ownership reads to ESCROW_OFFICER (and state-gate) where spec suggests least-privilege.
- **Production auth:** Implement token-based resolution of user_id, organization_id, role, license_state; enforce REALTRUST_AUTH_STRICT.
- **Access decision logging:** Optional but recommended for sensitive reads (06 §10).

---

## 5. Adding new features (quick reference)

- **Backend:** (1) Update 05/17/08 if state or milestones change; (2) Update 06 and RLS if new resource or classification; (3) Add/update API under `/v1`; (4) Add negative tests (11); (5) Regenerate seeds if state machine changed; (6) Re-check 18-audit.
- **Frontend:** (1) Add path to `20-api-contract-frontend.md` table and to `src/lib/api.ts` (no extra prefix); (2) Add types in `src/types/api.ts`; (3) Add hook using `user` from `useAuth()`; (4) Add page/route and optional nav item (roles in sidebar if role-scoped UX).

This audit should be re-run when adding new roles, states, resource types, or RLS/transition logic.
