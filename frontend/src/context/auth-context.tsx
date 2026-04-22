"use client";

import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from "react";
import type { SeedUser } from "@/types/api";
import { getDefaultSeedUser, getSeedUserByIdAndOrg, SEED_USERS } from "@/lib/seed-users";

interface AuthContextValue {
  user: SeedUser;
  setUser: (user: SeedUser) => void;
  isHydrated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "realtrust_dev_user";

function loadStoredUser(): SeedUser | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const { user_id, organization_id } = JSON.parse(stored);
    return getSeedUserByIdAndOrg(user_id, organization_id) ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<SeedUser>(getDefaultSeedUser);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const stored = loadStoredUser();
    if (stored) {
      setUserState(stored);
    }
    setIsHydrated(true);
  }, []);

  const setUser = useCallback((next: SeedUser) => {
    setUserState(next);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          user_id: next.user_id,
          organization_id: next.organization_id,
        })
      );
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const value = useMemo(() => ({ user, setUser, isHydrated }), [user, setUser, isHydrated]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { SEED_USERS };
