# realtrust frontend — Architecture (Next.js, React Query, Auth)

This document defines the frontend architecture for **realtrust ai** web app.

---

## 1. Stack (MUST)

| Component | Technology | Rationale |
|-----------|------------|------------|
| Framework | Next.js 16+ (App Router) | RSC, file-based routes, API proxy option |
| UI | React 18 | Hooks, concurrent features |
| Data | TanStack React Query v5 | Server state, cache, mutations, invalidation |
| Styling | Tailwind CSS | Utility-first, design tokens |
| Components | Radix UI primitives | Accessible, unstyled; shadcn-style in `components/ui/` |
| Forms | React Hook Form + Zod (optional) | Validation aligned with backend |
| Types | TypeScript | Strict; types mirror backend API |

---

## 2. Project structure (frontend)

```
frontend/
├── src/
│   ├── app/                    # App Router pages and layout
│   │   ├── layout.tsx          # Root: QueryProvider → AuthProvider → MainLayout
│   │   ├── page.tsx            # Dashboard
│   │   ├── globals.css
│   │   ├── transactions/      # List + [id] detail
│   │   ├── properties/         # List + [id]
│   │   ├── listings/           # List + [id]
│   │   ├── offers/
│   │   ├── showings/
│   │   ├── documents/
│   │   ├── inspections/
│   │   ├── escrow/
│   │   ├── title/
│   │   ├── chat/
│   │   └── recommendations/
│   ├── components/
│   │   ├── layout/             # main-layout, header, sidebar
│   │   ├── ui/                 # Radix-based primitives (button, card, input, etc.)
│   │   └── *.tsx               # shared: transaction-state-badge, loading-spinner, error-message, empty-state
│   ├── context/
│   │   ├── auth-context.tsx    # AuthProvider, useAuth(), SeedUser
│   │   └── query-provider.tsx  # QueryClientProvider
│   ├── hooks/                  # use-transactions, use-listings, use-properties, use-recommendations, use-chat
│   ├── lib/
│   │   ├── api.ts              # buildApiUrl, getRlsHeaders, apiFetch, *Api
│   │   ├── seed-users.ts       # SEED_USERS, getDefaultSeedUser, etc.
│   │   └── utils.ts            # cn, formatCurrency, formatDate, getRoleDisplayName
│   ├── types/
│   │   └── api.ts              # API types aligned with backend Pydantic
│   └── __tests__/
├── .env.local                  # NEXT_PUBLIC_API_BASE
├── next.config.ts
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

---

## 3. Auth (dev vs production)

- **Dev**: `AuthProvider` holds current `SeedUser` (user_id, organization_id, role, etc.). Stored in `localStorage` under `realtrust_dev_user` (user_id + organization_id only); full user resolved from `seed-users.ts`. Header/sidebar may offer a “Login as” switcher using `setUser` and `getUniqueUsers()`.
- **Production (target)**: Identity MUST come from verified OIDC/OAuth2 token. Backend validates token and sets RLS context; frontend MUST send `Authorization: Bearer <token>` and MUST NOT trust client-supplied identity for security. Session or token claims provide user_id, organization_id, role for RLS headers (or backend derives them from token and does not require header override).

---

## 4. Data flow

1. **Auth**: `useAuth()` provides `user` (SeedUser). All API calls use this user for RLS headers.
2. **API client**: `apiFetch(path, { user, method?, body?, params? })` builds URL via `buildApiUrl(path)`, attaches `getRlsHeaders(user)`, and throws `ApiException` on non-2xx with `code` and `details`.
3. **Hooks**: Each domain hook (e.g. `useTransactions`, `useTransaction(id)`) calls the corresponding `*Api` method with `user` from `useAuth()`. Query keys include user identity so cache is per-identity. Mutations invalidate relevant query keys on success.
4. **Pages**: Pages are client components (`"use client"`) that use hooks and render loading/error/empty states. No security decisions in UI—only UX (e.g. hide PRE_LISTING for buyers).

---

## 5. Layout and navigation

- **Root layout**: Wraps children with `QueryProvider` → `AuthProvider` → `TooltipProvider` → `MainLayout`. MainLayout includes sidebar + main content; header shows current user and optional switcher.
- **Sidebar**: Nav items may have optional `roles`; items are filtered by `user.role` so only allowed links show. Links align with journey (Dashboard, Transactions, Properties, Listings, Showings, Offers, Documents, Inspections, Escrow, Title, Chat, Recommendations).

---

## 6. Non-goals (current)

- Server-side session (future)
- Real-time (WebSocket) in this doc—reference backend 03/07 for events
- Design system doc (e.g. USWDS) as separate reference if adopted
