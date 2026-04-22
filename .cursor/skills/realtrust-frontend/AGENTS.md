# realtrust frontend — Agent Instructions

This repo includes the **realtrust ai** web frontend: Next.js (App Router), React Query, and an RLS-aware API client. When implementing, refactoring, or answering questions about the frontend (pages, components, API layer, auth, types):

## Use the realtrust-frontend skill

- **Skill path**: `.cursor/skills/realtrust-frontend/`
- **When**: Frontend app (frontend), pages, components, auth context, API client, types, hooks, tests.
- **What to load**: Follow the loading order in `SKILL.md` (architecture frontend → state machine → journey → authorization → API contract → UI/journey pages). Load shared refs from the realtrust-ai skill when you need backend API paths or state-machine details.

## Cursor rules

Rules in **`.cursor/rules/`** (project root) encode frontend invariants for file-scoped and always-on guidance:

- **realtrust-frontend-spine.mdc** — always applies; frontend non-negotiables (backend authority, RLS headers, no client-side security).
- **realtrust-frontend-implementation.mdc** — where things live under `frontend/` (api, types, auth, hooks, pages, components).
- **realtrust-frontend-auth.mdc** — auth context, seed users, RLS headers, production auth target.
- **realtrust-frontend-api.mdc** — API client, paths, types, error handling, alignment with backend.
- **realtrust-frontend-ui.mdc** — pages, layout, nav, role-based visibility, journey alignment.
- **realtrust-frontend-journey.mdc** — transaction states, journey milestones, CLOSED meaning in UI.

## Non-negotiables (frontend spine)

1. Backend is the authority for legality, state transitions, and visibility (RLS).
2. Every API request MUST send RLS headers from the current auth context (user/org/role).
3. One identity per request; no client-supplied role in mutation bodies.
4. UI and navigation align with transaction macro-states and milestone facts.
5. Frontend types MUST stay in sync with backend API contracts.
6. Security is not enforced in the UI; backend rejects unauthorized actions; frontend handles errors and surfaces codes (e.g. ILLEGAL_TRANSITION, NOT_FOUND).

## Normative language

- **MUST / MUST NOT**: non-negotiable; violations are incorrect.
- **SHOULD / SHOULD NOT**: strong recommendation; deviations need rationale.
- **MAY**: optional.

Definitions and terms: `.cursor/skills/realtrust-backend/references/13-glossary-and-normative-language.md` (or real-trust-spec equivalent).

## Spec and backend alignment

- **Backend skill**: `.cursor/skills/realtrust-backend/` — API surface, router paths, state machine, RLS. Use when adding or changing API calls so paths and types match.
- **Shared spec**: `real-trust-spec/` or `.cursor/skills/realtrust-backend/references/` — product, domain model, state machine, journey mapping, authorization.

Prefer the realtrust-frontend skill for frontend work; prefer the realtrust-backend skill when touching backend or when you need canonical API paths and error codes.

**Upload and display:** Property images and documents list/get include `view_url` (presigned GET) for display; show "Upload pending" when absent. Use a visible "Choose file" button that triggers the file input so the system file picker opens reliably (transaction Documents tab and Documents page). Documents page: full upload card with transaction selector, type, Choose file, Upload. Use simple inline upload failure messages (e.g. "Upload failed. Please try again.").

**Phase A/B (UI audit):** Phase A and B from `docs/UI-AUDIT-AND-ENHANCEMENT-PLAN.md` are done (waiver, precondition card, EMD/disbursement/deed/transfer dialogs, quick actions, pipeline filter, open house, version history, escrow picker). `TransactionDetailPage.test.tsx` includes waiver card, waived message, and Next transition card; tests wrap with `TooltipProvider`.
