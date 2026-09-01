/**
 * Auth stub for local-only PrisonBreak.
 *
 * There is no login flow — every caller gets the same static
 * `LOCAL_USER` and `isAuthenticated` is always true. Pages that gate
 * UI on auth state therefore always render the authenticated branch.
 */
import { useCallback } from "react";

const LOCAL_USER = {
  id: 1,
  openId: "local-user",
  name: "Local User",
  email: null,
  loginMethod: null,
  role: "admin" as const,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignedIn: new Date(0),
};

export function useAuth(_options?: { redirectOnUnauthenticated?: boolean }) {
  const logout = useCallback(async () => {
    // No-op locally.
  }, []);

  return {
    user: LOCAL_USER,
    loading: false,
    error: null,
    isAuthenticated: true,
    refresh: () => Promise.resolve(),
    logout,
  };
}
