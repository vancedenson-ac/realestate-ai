# realtrust ai — Agent Instructions

This repo is **realtrust ai**: backend-first, escrow-safe transaction infrastructure for real estate. When implementing, refactoring, or answering questions about backend, database, APIs, authorization, events, or AI:

## Use the realtrust-ai skill

- **Skill path**: `.cursor/skills/realtrust-backend/`
- **When**: Backend services, domain model, DB schema, RLS, state machine, events/outbox, AI governance, testing, infrastructure.
- **What to load**: Follow the loading order in `SKILL.md` (architecture → state machine → authorization → events → schema → views/APIs → testing → infra). Load `references/15-llm-rules-and-system-contract.md` for MUST/MUST NOT constraints.

## Cursor rules

Rules in **`.cursor/rules/`** (project root) encode the same invariants for file-scoped and always-on guidance:

- **realtrust-spine.mdc** — always applies; non-negotiables.
- **realtrust-authority.mdc** — authority hierarchy (truth, evidence, advice).
- **realtrust-transactions.mdc** — state machine, transitions, preconditions.
- **realtrust-auth.mdc** — RLS, permission equation, explicit denies.
- **realtrust-events.mdc** — events, outbox, no event without commit.
- **realtrust-ai-governance.mdc** — AI advisory-only, provenance.
- **realtrust-api-views.mdc** — API versioning, commands vs queries, observability.
- **realtrust-implementation.mdc** — where things live (config, deps, schema, seeds, endpoints, tests) under `backend/`.
- **realtrust-journey-milestones.mdc** — journey milestones (offers/showings/title/escrow/recording) must be authoritative facts and DB-gated.

## Non-negotiables (spine)

1. PostgreSQL is the system of record.
2. Transaction state machine defines legality; DB is final authority for transitions.
3. Events are evidence of committed facts; no event without commit; outbox for Kafka.
4. AI is advisory only; no AI writes to authoritative state or access bypass.
5. Authorization is enforced at DB (RLS); explicit denies win.
6. Illegal end states are unrepresentable; verified by negative tests.

## Normative language

- **MUST / MUST NOT**: non-negotiable; violations are incorrect.
- **SHOULD / SHOULD NOT**: strong recommendation; deviations need rationale.
- **MAY**: optional.

Definitions and terms: `.cursor/skills/realtrust-backend/references/13-glossary-and-normative-language.md` (or `real-trust-spec/13-glossary-and-normative-language.md` if present).

## Spec location

- **Canonical spec**: `real-trust-spec/` (repo root; may not include all numbered refs).
- **Skill references**: `.cursor/skills/realtrust-backend/references/` — full set including 17 (journey mapping), 18 (authorization audit broker/client/lender), and REFERENCE-BLOCKS.md.

Prefer the skill references when using the realtrust-ai skill; prefer `real-trust-spec/` when sharing paths with humans or docs. For authorization audit (broker/lender/client rules vs implementation), load `references/18-authorization-audit-broker-client-lender.md`.

**Storage (MinIO/S3):** Presigned PUT via MinIO Python SDK (`core/storage.py`); presigned GET for `view_url` on property images list and document list/get. Config: `S3_PUBLIC_ENDPOINT_URL` for browser-accessible presigned URLs when API runs in Docker.

**Phase A/B (UI audit):** Phase A and B from `docs/UI-AUDIT-AND-ENHANCEMENT-PLAN.md` are implemented (waiver, escrow/title forms, etc.). Backend tests for EMD confirm, disbursement, deed recording, and ownership transfer with request bodies are in `test_escrow.py` and `test_title.py`.
