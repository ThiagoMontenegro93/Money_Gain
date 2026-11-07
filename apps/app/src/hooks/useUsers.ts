import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UserDTO } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/** Lista de usuários (ADMIN+) para filtros e seleção de funcionário. */
export function useUsers() {
  const { hasRole } = useAuth();
  const [users, setUsers] = useState<UserDTO[]>([]);
  const allowed = hasRole('ADMIN', 'SUPER_ADMIN');
  useEffect(() => {
    if (!allowed) return;
    api.users.list().then(setUsers).catch(() => setUsers([]));
  }, [allowed]);
  return users;
}
