import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { LoanTable } from '@/components/LoanTable';
import { Screen } from '@/components/Screen';
import { Button, Card, Chip, ErrorState, Loading, Select, Stack } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { useUsers } from '@/hooks/useUsers';
import { colors } from '@/theme';
import { brl } from '@/utils/format';

const STATUSES = [
  { key: '', label: 'Todos' },
  { key: 'ATIVO', label: 'Ativos' },
  { key: 'QUITADO', label: 'Quitados' },
  { key: 'PERDA', label: '💀 Perda' },
  { key: 'CANCELADO', label: 'Cancelados' },
];

export default function LoansList() {
  const router = useRouter();
  const { hasRole } = useAuth();
  const { isDesktop } = useLayout();
  const users = useUsers();
  const [status, setStatus] = useState('');
  const [lender, setLender] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => api.loans.list({ status: status || undefined, lenderUserId: lender ?? undefined }), [status, lender]);
  const total = (data ?? []).reduce((s, l) => s + (l.status === 'ATIVO' || l.status === 'PERDA' ? l.saldoDevedorCents : 0), 0);

  return (
    <Screen
      title="Empréstimos"
      subtitle={data ? `${data.length} empréstimo(s) · saldo devedor ${brl(total)}` : undefined}
      actions={<Button testID="new-loan" title="Novo Empréstimo" icon="💸" onPress={() => router.push('/loans/new')} />}
      onRefresh={reload}
      refreshing={loading && !!data}
    >
      <Stack row={isDesktop} gap={10} style={{ marginBottom: 12, alignItems: isDesktop ? 'center' : 'stretch' }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', flex: 1 }}>
          {STATUSES.map((s) => (
            <Chip key={s.key} testID={`loan-status-${s.key || 'ALL'}`} label={s.label} active={status === s.key} onPress={() => setStatus(s.key)} color={s.key === 'PERDA' ? '#374151' : colors.primary} />
          ))}
        </View>
        {hasRole('ADMIN', 'SUPER_ADMIN') ? (
          <Select value={lender} onChange={setLender} allowEmpty placeholder="Todos os funcionários" options={users.map((u) => ({ value: u.id, label: u.name }))} style={{ minWidth: 240, marginBottom: 0 }} />
        ) : null}
      </Stack>
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <Card style={{ padding: isDesktop ? 0 : 10, overflow: 'hidden' }}>
          <LoanTable loans={data} emptyText="Nenhum empréstimo com esses filtros" />
        </Card>
      ) : null}
    </Screen>
  );
}
