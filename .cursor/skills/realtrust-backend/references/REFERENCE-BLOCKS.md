# realtrust ai — Reference Blocks (for @-mention)

Use this index to choose what to @-mention for quick context.

## By topic

| Topic | @-mention this | Purpose |
|-------|----------------|---------|
| **Spine / non-negotiables** | `.cursor/skills/realtrust-backend/SKILL.md` | Six non-negotiables, workflow, implementation map |
| **State machine (law)** | `references/05-transaction-state-machine-spec.md` | States, transitions, preconditions, events; derive seeds and DB function |
| **Journey mapping / milestones** | `references/17-journey-mapping-and-milestones.md` | Image → macro-states → authoritative milestone facts; transition gating matrix; CLOSED meaning |
| **Authorization / RLS** | `references/06-authorization-and-data-access.md` | Permission equation, session context, RLS patterns, explicit denies |
| **Events / outbox** | `references/07-events-and-outbox.md` | Event envelope, domain_events, event_outbox, Kafka, no event without commit |
| **Schema / governance** | `references/08-database-schema-and-governance.md` | Tables, invariants, RLS, migrations, idempotency |
| **APIs / views** | `references/09-views-and-apis.md` | Endpoints, versioning, commands vs queries, error codes |
| **Testing / proof** | `references/11-testing-and-proof-suite.md` | Negative tests, illegal transitions, RLS impossibility, event consistency |
| **MUST/MUST NOT** | `references/15-llm-rules-and-system-contract.md` | Machine-ingestible contract; authority, legality, auth, events, AI |
| **Authorization audit** | `references/18-authorization-audit-broker-client-lender.md` | Broker/client/lender rules vs spec; RLS and transition status checklist |
| **Implementation map** | `.cursor/skills/realtrust-backend/SKILL.md` (Implementation map + Backend layout + API surface) or `.cursor/rules/realtrust-implementation.mdc` | Where config, deps, schema, seeds, endpoints, tests live |
| **User flow completion (new features)** | `.cursor/skills/realtrust-backend/SKILL.md` § New features | Buyer create transaction (LISTED + listing_id), escrow/title/inspections GET list endpoints, milestone gating test (seeded tx 005, BUYER_AGENT) |

## By task

- **Adding a state or transition** → 05 + SKILL (workflow) → update 03-seed.sql, 02-schema.sql if needed, add negative tests.
- **Mapping UI journey boxes to enforceable back-end facts** → 17 (journey mapping) → update 05 (preconditions), 08 (schema/invariants), 09 (commands/views), 11 (proof suite).
- **Adding/changing RLS** → 06 → update policies in 02-schema.sql (or migrations), add RLS negative tests (11).
- **Adding an API endpoint** → 09 + SKILL (implementation map) → add under `api/v1/endpoints/`, back reads with RLS.
- **Escrow/Title/Inspections list or buyer create transaction** → SKILL § New features (user flow completion) + 09 (API contracts). List endpoints use `get_db_with_rls`; buyer create validates initial_state and listing_id.
- **Adding event types** → 07 + 05 (emits_event) → domain_events/event_outbox in same transaction.
- **Storage / presigned URLs** → SKILL (implementation map: Storage row). `core/storage.py`: `get_presigned_put_url` (MinIO SDK), `get_presigned_get_url`, `ensure_bucket_exists`; config `S3_PUBLIC_ENDPOINT_URL` for browser. List responses (property images, documents) include `view_url` when object/version exists.
- **Checking constraints** → 15 (LLM rules) for MUST/MUST NOT.

## Cursor rules (project `.cursor/rules/`)

Rules are in the **project root** `.cursor/rules/` (not under the skill). Applied by glob when editing matching paths:

- **realtrust-spine.mdc** — always applies (non-negotiables).
- **realtrust-implementation.mdc** — when editing `backend/**/*.py` or `backend/scripts/**/*.sql` or `backend/tests/**/*.py`.
- **realtrust-transactions.mdc** — when editing transaction domain, DB, schema, migrations.
- **realtrust-auth.mdc** — when editing api/, db/, core/, scripts (RLS).
- **realtrust-events.mdc** — when editing events, workers, outbox, event-related SQL.
- **realtrust-ai-governance.mdc** — when editing AI, matching, RAG, embeddings.
- **realtrust-api-views.mdc** — when editing api/, v1/, views, schemas.
- **realtrust-journey-milestones.mdc** — when editing journey milestone facts (offers/showings/title/escrow/recording) and their gating.
- **realtrust-authority.mdc** — authority hierarchy (truth, evidence, advice).
