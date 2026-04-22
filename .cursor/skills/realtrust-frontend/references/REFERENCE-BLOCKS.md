# realtrust frontend — Reference Blocks (for @-mention)

Use this index to choose what to @-mention for quick context.

## By topic

| Topic | @-mention this | Purpose |
|-------|----------------|---------|
| **Frontend spine / non-negotiables** | `.cursor/skills/realtrust-frontend/SKILL.md` | Backend authority, RLS headers, no client security, types match API |
| **Frontend architecture** | `references/19-architecture-frontend.md` | Next.js, React Query, auth, layout, data flow |
| **State machine (law)** | `references/05-transaction-state-machine-spec.md` | States, transitions; same as backend |
| **Journey mapping** | `references/17-journey-mapping-and-milestones.md` | Journey → macro-states → milestone facts; CLOSED meaning |
| **Authorization (backend)** | `references/06-authorization-and-data-access.md` | Permission equation; frontend mirrors for UX only |
| **API contract (backend)** | `references/09-views-and-apis.md` | Backend API design; shared with frontend |
| **API contract (frontend)** | `references/20-api-contract-frontend.md` | Paths, RLS headers, types, errors, path alignment |
| **UI / pages / nav** | `references/21-ui-journey-and-pages.md` | Routes, pages, sidebar, role-based nav, journey alignment |
| **Domain model** | `references/04-domain-model.md` | Aggregates, entities (shared) |
| **Glossary** | `references/13-glossary-and-normative-language.md` | Terms (shared) |
| **MUST/MUST NOT** | `references/15-llm-rules-and-system-contract.md` | Machine-ingestible contract (shared) |
| **Backend API surface** | `.cursor/skills/realtrust-backend/SKILL.md` | Backend paths, router mounts; use to align frontend paths |
| **User flow completion (new features)** | `.cursor/skills/realtrust-frontend/SKILL.md` § New features (user flow completion) | Offers/Escrow/Title/Inspections pages and transaction tabs, offer permissions, use-offers/use-escrow/use-title/useTransactionInspections, API clients, page tests |

## By task

- **Adding a page or flow** → 21 (UI/journey) + 20 (API paths) + SKILL (implementation map). Add route, API calls, types, hooks.
- **Offers/Escrow/Title/Inspections pages or transaction tabs** → SKILL § New features (user flow completion) + 20 (paths). Use offersApi/escrowApi/titleApi/inspectionsApi and use-offers/use-escrow/use-title/useTransactionInspections; gate by permissions.
- **Changing API usage** → 20 (paths, headers, types) + backend skill (API surface). Keep paths in sync with backend router.
- **Role-based nav or visibility** → 21 (sidebar, roles) + 06 (who can see what). Remember: UX only; backend enforces.
- **Transaction state / transitions in UI** → 05 (states) + 17 (journey). Display state; send transition to backend; handle ILLEGAL_TRANSITION / PRECONDITION_FAILED.
- **Auth / seed users** → 19 (auth) + SKILL (seed-users.ts). Production: token-derived identity.
- **Upload / display (documents, property images)** → 20 (types: view_url on PropertyImageOverview, DocumentOverview) + 21 (Documents page upload card, transaction Documents tab, property [id] images). Use "Choose file" button to open picker; show View/Download when view_url present, "Upload pending" otherwise.

## Cursor rules (project `.cursor/rules/`)

- **realtrust-frontend-spine.mdc** — always applies; frontend non-negotiables.
- **realtrust-frontend-implementation.mdc** — where things live under `frontend/`.
- **realtrust-frontend-auth.mdc** — auth context, RLS headers, seed users.
- **realtrust-frontend-api.mdc** — API client, paths, types, errors.
- **realtrust-frontend-ui.mdc** — pages, layout, nav, journey alignment.
- **realtrust-frontend-journey.mdc** — states, milestones, CLOSED in UI.
