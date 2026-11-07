import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, setAuthToken, setUnauthorizedHandler } from '../api';
import { clearCache, setCacheUser } from '../offline/cache';
import { kvGet, kvRemove, kvSet } from '../offline/kv';
import { setOutboxUser, startOutboxSync } from '../offline/outbox';
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

/** Último usuário logado: permite abrir o app sem internet (Fase 4). */
const SESSION_USER = 'lc.session.user';
async function savedUser(): Promise<UserDTO | null> {
  try {
    const raw = await kvGet(SESSION_USER);
    return raw ? (JSON.parse(raw) as UserDTO) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const setUser = useCallback((u: UserDTO | null) => {
    setCacheUser(u?.id ?? null);
    void setOutboxUser(u?.id ?? null);
    if (u) void kvSet(SESSION_USER, JSON.stringify(u));
    setUserState(u);
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    await setToken(null);
    setUser(null);
    // o cache de leitura sai junto com a sessão; a fila de envio fica guardada para o mesmo usuário
    await kvRemove([SESSION_USER]);
    await clearCache();
  }, [setUser]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logout();
    });
    startOutboxSync();
    (async () => {
      const t = await getToken();
      if (t) {
        setAuthToken(t);
        try {
          setUser(await api.auth.me());
        } catch (e) {
          // sem internet: entra com o último usuário salvo (dados do cache, ações vão para a fila)
          const offlineUser = e instanceof ApiError && e.status === 0 ? await savedUser() : null;
          if (offlineUser) setUser(offlineUser);
          else {
            setAuthToken(null);
            await setToken(null);
          }
        }
      }
      setLoading(false);
    })();
    return () => setUnauthorizedHandler(null);
  }, [logout, setUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.auth.login(email.trim(), password);
    setAuthToken(res.accessToken);
    await setToken(res.accessToken);
    setUser(res.user);
  }, [setUser]);

  const refreshMe = useCallback(async () => {
    try {
      setUser(await api.auth.me());
    } catch {
      /* mantém usuário atual */
    }
  }, [setUser]);

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
