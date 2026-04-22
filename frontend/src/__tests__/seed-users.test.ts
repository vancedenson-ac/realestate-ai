import {
  SEED_USERS,
  SEED_ORGANIZATIONS,
  getDefaultSeedUser,
  getSeedUserById,
  getSeedUserByIdAndOrg,
  displayName,
  getUniqueUsers,
} from "@/lib/seed-users";

describe("SEED_ORGANIZATIONS", () => {
  it("contains expected organizations", () => {
    expect(SEED_ORGANIZATIONS["a0000001-0000-0000-0000-000000000001"]).toBe("Acme Realty");
    expect(SEED_ORGANIZATIONS["a0000001-0000-0000-0000-000000000002"]).toBe("First Escrow Co");
    expect(SEED_ORGANIZATIONS["a0000001-0000-0000-0000-000000000003"]).toBe("Sunset Lending");
  });
});

describe("SEED_USERS", () => {
  it("contains expected users", () => {
    expect(SEED_USERS.length).toBeGreaterThan(0);
    
    const aliceAgent = SEED_USERS.find((u) => u.email === "alice@acme.com");
    expect(aliceAgent).toBeDefined();
    expect(aliceAgent?.full_name).toBe("Alice Agent");
    expect(aliceAgent?.role).toBe("SELLER_AGENT");
  });

  it("all users have required fields", () => {
    SEED_USERS.forEach((user) => {
      expect(user.user_id).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.organization_id).toBeDefined();
      expect(user.organization_name).toBeDefined();
      expect(user.role).toBeDefined();
    });
  });
});

describe("getDefaultSeedUser", () => {
  it("returns Bob Buyer as default", () => {
    const user = getDefaultSeedUser();
    expect(user.email).toBe("bob@buyer.com");
    expect(user.role).toBe("BUYER");
  });
});

describe("getSeedUserById", () => {
  it("finds user by ID", () => {
    const user = getSeedUserById("b0000001-0000-0000-0000-000000000001");
    expect(user).toBeDefined();
    expect(user?.email).toBe("alice@acme.com");
  });

  it("returns undefined for unknown ID", () => {
    const user = getSeedUserById("unknown-id");
    expect(user).toBeUndefined();
  });
});

describe("getSeedUserByIdAndOrg", () => {
  it("finds user by ID and organization", () => {
    const user = getSeedUserByIdAndOrg(
      "b0000001-0000-0000-0000-000000000004",
      "a0000001-0000-0000-0000-000000000001"
    );
    expect(user).toBeDefined();
    expect(user?.full_name).toBe("Dave Escrow (Acme)");
  });

  it("returns different users for same ID but different org", () => {
    const daveAcme = getSeedUserByIdAndOrg(
      "b0000001-0000-0000-0000-000000000004",
      "a0000001-0000-0000-0000-000000000001"
    );
    const daveEscrow = getSeedUserByIdAndOrg(
      "b0000001-0000-0000-0000-000000000004",
      "a0000001-0000-0000-0000-000000000002"
    );
    
    expect(daveAcme?.organization_name).toBe("Acme Realty");
    expect(daveEscrow?.organization_name).toBe("First Escrow Co");
  });
});

describe("displayName", () => {
  it("returns full_name when available", () => {
    const user = SEED_USERS.find((u) => u.full_name === "Alice Agent");
    expect(displayName(user!)).toBe("Alice Agent");
  });

  it("falls back to email when full_name is null", () => {
    const userWithNoName = {
      user_id: "test-id",
      email: "test@example.com",
      full_name: null,
      organization_id: "org-id",
      organization_name: "Test Org",
      role: "BUYER" as const,
    };
    expect(displayName(userWithNoName)).toBe("test@example.com");
  });
});

describe("getUniqueUsers", () => {
  it("returns unique user+org combinations", () => {
    const unique = getUniqueUsers();
    const keys = unique.map((u) => `${u.user_id}:${u.organization_id}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it("includes users from different orgs", () => {
    const unique = getUniqueUsers();
    const orgs = new Set(unique.map((u) => u.organization_name));
    expect(orgs.size).toBeGreaterThan(1);
  });
});
