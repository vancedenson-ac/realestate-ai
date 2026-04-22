/**
 * Seed users derived from backend/scripts/03-seed.sql.
 * Used for dev "login as" switcher. Each user has a primary org/role for RLS headers.
 */

import type { SeedUser, UserRole } from "@/types/api";

export const SEED_ORGANIZATIONS: Record<string, string> = {
  "a0000001-0000-0000-0000-000000000001": "Acme Realty",
  "a0000001-0000-0000-0000-000000000002": "First Escrow Co",
  "a0000001-0000-0000-0000-000000000003": "Sunset Lending",
};

export const SEED_USERS: SeedUser[] = [
  // --- Acme Realty (main pipeline: tx 001–009 in various states) ---
  {
    user_id: "b0000001-0000-0000-0000-000000000001",
    email: "alice@acme.com",
    full_name: "Alice Agent",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "SELLER_AGENT" as UserRole,
  },
  {
    user_id: "b0000001-0000-0000-0000-000000000002",
    email: "bob@buyer.com",
    full_name: "Bob Buyer",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "BUYER" as UserRole,
  },
  {
    user_id: "b0000001-0000-0000-0000-000000000003",
    email: "carol@acme.com",
    full_name: "Carol Seller",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "SELLER" as UserRole,
  },
  {
    user_id: "b0000001-0000-0000-0000-000000000006",
    email: "buyer-agent.complete@seed.realtrust.local",
    full_name: "Bailey Buyer Agent",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "BUYER_AGENT" as UserRole,
  },
  {
    user_id: "b0000001-0000-0000-0000-000000000013",
    email: "inspector.complete@seed.realtrust.local",
    full_name: "Ivy Inspector",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "INSPECTOR" as UserRole,
  },
  {
    user_id: "b0000001-0000-0000-0000-000000000015",
    email: "appraiser.complete@seed.realtrust.local",
    full_name: "Andy Appraiser",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "APPRAISER" as UserRole,
  },
  // Dave / Eve with Acme org (see Acme pipeline)
  {
    user_id: "b0000001-0000-0000-0000-000000000004",
    email: "dave@escrow.com",
    full_name: "Dave Escrow (Acme)",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "ESCROW_OFFICER" as UserRole,
  },
  {
    user_id: "b0000001-0000-0000-0000-000000000005",
    email: "eve@lending.com",
    full_name: "Eve Lender (Acme)",
    organization_id: "a0000001-0000-0000-0000-000000000001",
    organization_name: "Acme Realty",
    role: "LENDER" as UserRole,
  },
  // --- First Escrow Co (sees tx 010 only) ---
  {
    user_id: "b0000001-0000-0000-0000-000000000004",
    email: "dave@escrow.com",
    full_name: "Dave Escrow",
    organization_id: "a0000001-0000-0000-0000-000000000002",
    organization_name: "First Escrow Co",
    role: "ESCROW_OFFICER" as UserRole,
  },
  // --- Sunset Lending (sees tx 011 only) ---
  {
    user_id: "b0000001-0000-0000-0000-000000000005",
    email: "eve@lending.com",
    full_name: "Eve Lender",
    organization_id: "a0000001-0000-0000-0000-000000000003",
    organization_name: "Sunset Lending",
    role: "LENDER" as UserRole,
  },
];

export function getDefaultSeedUser(): SeedUser {
  return SEED_USERS[1]; // Bob Buyer
}

export function getSeedUserById(userId: string): SeedUser | undefined {
  return SEED_USERS.find((u) => u.user_id === userId);
}

export function getSeedUserByIdAndOrg(userId: string, orgId: string): SeedUser | undefined {
  return SEED_USERS.find((u) => u.user_id === userId && u.organization_id === orgId);
}

export function displayName(user: SeedUser): string {
  return user.full_name || user.email || user.user_id;
}

export function getUniqueUsers(): SeedUser[] {
  // Get unique users by user_id + organization_id combination
  const seen = new Set<string>();
  return SEED_USERS.filter((u) => {
    const key = `${u.user_id}:${u.organization_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
