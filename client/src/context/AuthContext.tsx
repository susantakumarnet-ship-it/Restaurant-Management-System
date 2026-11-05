import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore, adminBranchStore } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  setSession: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => Promise<void>;
  hasPerm: (...perms: string[]) => boolean;
}

const Ctx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.set(null);
    adminBranchStore.set(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      setUser(res.user);
    } catch {
      tokenStore.set(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.set(null);
      setUser(null);
    });
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const setSession = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setUser(u);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { identifier, password });
    setSession(res.token, res.user);
    return res.user;
  }, [setSession]);

  const hasPerm = useCallback((...perms: string[]) => !!user && (user.role === 'super_admin' || perms.some((p) => user.permissions?.includes(p))), [user]);

  const value = useMemo(() => ({ user, ready, login, setSession, logout, refresh, hasPerm }), [user, ready, login, setSession, logout, refresh, hasPerm]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Where to send a user after login. */
export const homeFor = (u: User) => (u.role === 'super_admin' ? '/super' : u.is_staff ? '/admin' : '/');
