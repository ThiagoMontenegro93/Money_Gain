import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/api';
import type { ClientListItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { Screen } from '@/components/Screen';
import { Badge, Button, Card, Chip, Column, Empty, ErrorState, Input, Loading, ScoreBadge, Select, StatusChip, Table, Stack } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useDebounced } from '@/hooks/useDebounced';
import { useLayout } from '@/hooks/useLayout';
import { useUsers } from '@/hooks/useUsers';
import { classColor, classRow, colors } from '@/theme';
import { brl, CLIENT_STATUS_LABEL, pctText } from '@/utils/format';

type Filter = 'ALL' | 'BOM' | 'REGULAR' | 'RUIM' | 'PERDA' | 'OVERDUE';

export default function ClientsList() {
  const router = useRouter();
  const params = useLocalSearchParams<{ f?: string }>();
  const { isDesktop } = useLayout();
  const { hasRole } = useAuth();
  const users = useUsers();
  const [filter, setFilter] = useState<Filter>((['BOM', 'REGULAR', 'RUIM', 'PERDA', 'OVERDUE'].includes(String(params.f)) ? params.f : 'ALL') as Filter);
  const [search, setSearch] = useState('');
  const [responsible, setResponsible] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const q = useDebounced(search);

  const { data, error, loading, reload } = useAsync(
    () =>
      api.clients.list({
        search: q || undefined,
        classificacao: ['BOM', 'REGULAR', 'RUIM', 'PERDA'].includes(filter) ? filter : undefined,
        overdue: filter === 'OVERDUE' ? true : undefined,
        responsibleUserId: responsible ?? undefined,
        status: status ?? undefined,
      }),
    [q, filter, responsible, status],
  );
  const counts = data?.counts;
  const items = data?.items ?? [];

  const columns: Column<ClientListItem>[] = [
    { key: 'name', title: 'Nome', flex: 2.2, minWidth: 160, render: (c) => (
      <Text style={{ color: classRow[c.classificacao].text, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>
        {c.classificacao === 'PERDA' ? '💀 ' : ''}{c.fullName}{c.isBlocked ? '  🚫' : ''}
      </Text>
    ) },
    { key: 'cpf', title: 'CPF', width: 112, minWidth: 112, render: (c) => c.cpfMasked },
    { key: 'phone', title: 'Telefone', width: 124, minWidth: 122, render: (c) => c.whatsapp ?? '—' },
    { key: 'city', title: 'Cidade', flex: 0.8, minWidth: 70, render: (c) => c.city ?? '—' },
    { key: 'score', title: 'Score', width: 112, minWidth: 104, render: (c) => <ScoreBadge cls={c.classificacao} score={c.score} size="sm" /> },
    { key: 'status', title: 'Status', width: 82, minWidth: 64, render: (c) => <StatusChip status={c.isBlocked ? 'BLOQUEADO' : c.status} label={c.isBlocked ? 'Bloqueado' : CLIENT_STATUS_LABEL[c.status] ?? c.status} /> },
    { key: 'resp', title: 'Responsável', width: 92, minWidth: 66, render: (c) => c.responsible?.name ?? '—' },
    { key: 'loans', title: 'Empr. ativos', width: 66, minWidth: 50, align: 'center', render: (c) => String(c.activeLoans) },
    { key: 'total', title: 'Total emprestado', width: 110, minWidth: 100, align: 'right', render: (c) => brl(c.totalEmprestadoCents) },
    { key: 'open', title: 'Em aberto', width: 124, minWidth: 112, align: 'right', render: (c) => (
      <Text style={{ color: c.overdueCount ? '#B91C1C' : classRow[c.classificacao].text, fontWeight: '800', fontSize: 13 }}>
        {brl(c.emAbertoCents)}{c.overdueCount ? `\n${c.overdueCount} atrasada${c.overdueCount > 1 ? 's' : ''}` : ''}
      </Text>
    ) },
  ];

  const chip = (f: Filter, label: string, color: string) => <Chip testID={`filter-${f}`} key={f} label={label} active={filter === f} color={color} onPress={() => setFilter(f)} />;

  return (
    <Screen
      title="Clientes"
      subtitle={counts ? `${counts.all} clientes cadastrados · ordenados de Bons (topo) a Perda (embaixo)` : undefined}
      actions={<Button testID="new-client" title="Novo Cliente" icon="➕" onPress={() => router.push('/clients/new')} />}
      onRefresh={reload}
      refreshing={loading && !!data}
    >
      <View style={styles.filters}>
        {chip('ALL', `Todos${counts ? ` (${counts.all})` : ''}`, colors.primary)}
        {chip('BOM', `⭐ Bons${counts ? ` (${counts.BOM})` : ''}`, classColor.BOM)}
        {chip('REGULAR', `🟡 Regulares${counts ? ` (${counts.REGULAR})` : ''}`, classColor.REGULAR)}
        {chip('RUIM', `⚠️ Ruins${counts ? ` (${counts.RUIM})` : ''}`, classColor.RUIM)}
        {chip('PERDA', `💀 Perda${counts ? ` (${counts.PERDA})` : ''}`, '#374151')}
        {chip('OVERDUE', `⏰ Atrasados${counts ? ` (${counts.atrasados})` : ''}`, colors.danger)}
      </View>
      <Stack row={isDesktop} colGap={8} style={styles.searchRow}>
        <Input testID="client-search" value={search} onChangeText={setSearch} placeholder="🔍 Busca rápida: nome, CPF, telefone, cidade..." style={{ flex: 2, marginBottom: 0 }} />
        {hasRole('ADMIN', 'SUPER_ADMIN') ? (
          <Select value={responsible} onChange={setResponsible} allowEmpty placeholder="Todos os responsáveis" options={users.map((u) => ({ value: u.id, label: u.name }))} style={{ flex: 1, marginBottom: 0 }} />
        ) : null}
        <Select value={status} onChange={setStatus} allowEmpty placeholder="Todos os status" options={[{ value: 'ATIVO', label: 'Ativo' }, { value: 'RASCUNHO', label: 'Rascunho' }, { value: 'INATIVO', label: 'Inativo' }]} style={{ flex: 1, marginBottom: 0 }} />
      </Stack>

      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && isDesktop ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            testID="clients-table"
            columns={columns}
            rows={items}
            keyOf={(c) => c.id}
            minWidth={1080}
            onRowPress={(c) => router.push(`/clients/${c.id}`)}
            rowStyle={(c) => ({ bg: classRow[c.classificacao].bg, border: classRow[c.classificacao].border, text: classRow[c.classificacao].text })}
            empty={<Empty text={q || filter !== 'ALL' ? 'Nenhum cliente encontrado com esses filtros' : 'Nenhum cliente cadastrado ainda'} icon="👥" />}
          />
        </Card>
      ) : null}
      {data && !isDesktop ? (
        <View>
          {items.length === 0 ? <Empty text="Nenhum cliente encontrado" icon="👥" /> : null}
          {items.map((c) => {
            const rs = classRow[c.classificacao];
            return (
              <Pressable key={c.id} onPress={() => router.push(`/clients/${c.id}`)} style={[styles.mCard, { backgroundColor: rs.bg, borderLeftColor: rs.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: rs.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>
                    {c.classificacao === 'PERDA' ? '💀 ' : ''}{c.fullName}
                  </Text>
                  <ScoreBadge cls={c.classificacao} score={c.score} size="sm" />
                </View>
                <Text style={{ color: rs.textMuted, fontWeight: '600', marginTop: 4 }}>
                  {c.cpfMasked} · {c.whatsapp ?? 'sem telefone'} · {c.city ?? '—'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusChip status={c.isBlocked ? 'BLOQUEADO' : c.status} label={c.isBlocked ? 'Bloqueado' : CLIENT_STATUS_LABEL[c.status]} />
                  <Badge size="sm" text={`${c.activeLoans} ativo(s)`} bg="rgba(15,23,42,0.12)" color={rs.text} />
                  <Badge size="sm" text={`Aberto ${brl(c.emAbertoCents)}`} bg="rgba(15,23,42,0.12)" color={rs.text} />
                  <Badge size="sm" text={`Pont. ${pctText(c.pontualidade)}`} bg="rgba(15,23,42,0.12)" color={rs.text} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 14, alignItems: 'flex-start' },
  mCard: { borderLeftWidth: 5, borderRadius: 10, padding: 12, marginBottom: 8 },
});
