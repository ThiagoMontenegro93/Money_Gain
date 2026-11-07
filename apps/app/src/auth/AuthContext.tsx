import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../api';
import type { Role, UserDTO } from '../api/types';
import { getToken, setToken } from './tokenStorage';

interface AuthState {
  user: UserDTO | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    setAuthToken(null);
    await setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
    (async () => {
      const t = await getToken();
      if (t) {
        setAuthToken(t);
        try {
          setUser(await api.auth.me());
        } catch {
          setAuthToken(null);
          await setToken(null);
        }
      }
      setLoading(false);
    })();
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.auth.login(email.trim(), password);
    setAuthToken(res.accessToken);
    await setToken(res.accessToken);
    setUser(res.user);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      setUser(await api.auth.me());
    } catch {
      /* mantém usuário atual */
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, refreshMe, hasRole: (...roles) => !!user && roles.includes(user.role) }),
    [user, loading, login, logout, refreshMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}

export const ROLE_LABEL: Record<Role, string> = { SUPER_ADMIN: 'Super Admin (Dono)', ADMIN: 'Administrador', OPERATOR: 'Funcionário' };
