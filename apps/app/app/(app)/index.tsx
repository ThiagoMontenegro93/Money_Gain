import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { todayISO } from '@lendcontrol/core';
import { api } from '@/api';
import type { ClientListItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { PieChart } from '@/components/PieChart';
import { Screen } from '@/components/Screen';
import { Button, Card, Empty, ErrorState, Grid, Loading, ScoreBadge, StatCard, Stack } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { classColor, classRow, colors } from '@/theme';
import { brl, dateBR, pctText } from '@/utils/format';

function ClientMiniRow({ c, onPress }: { c: ClientListItem; onPress: () => void }) {
  const rs = classRow[c.classificacao];
  return (
    <Pressable onPress={onPress} style={[styles.mini, { backgroundColor: rs.bg, borderLeftColor: rs.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: rs.text, fontWeight: '800' }} numberOfLines={1}>
          {c.classificacao === 'PERDA' ? '💀 ' : ''}
          {c.fullName}
        </Text>
        <Text style={{ color: rs.textMuted, fontSize: 12, fontWeight: '600' }}>
          Pontualidade {pctText(c.pontualidade)} · {c.diasSemPagar} dias sem pagar · Em aberto {brl(c.emAbertoCents)}
        </Text>
      </View>
      <ScoreBadge cls={c.classificacao} score={c.score} size="sm" />
    </Pressable>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { user, hasRole } = useAuth();
  const { isDesktop, isWide } = useLayout();
  const { data: d, error, loading, reload } = useAsync(() => api.dashboard(), []);
  const cols = isWide ? 4 : isDesktop ? 4 : 2;

  return (
    <Screen
      title="Dashboard"
      subtitle={`Olá, ${user?.name ?? ''}${user?.role === 'OPERATOR' ? ' · números da sua carteira' : ''}`}
      onRefresh={reload}
      refreshing={loading && !!d}
      actions={
        <>
          <Button title="Novo Cliente" icon="➕" variant="secondary" onPress={() => router.push('/clients/new')} />
          <Button title="Novo Empréstimo" icon="💸" onPress={() => router.push('/loans/new')} />
        </>
      }
    >
      {loading && !d ? <Loading /> : null}
      {error && !d ? <ErrorState message={error} onRetry={reload} /> : null}
      {d ? (
        <>
          <Grid cols={cols}>
            <StatCard testID="stat-capital-total" label="Capital total" value={brl(d.capitalTotalCents)} icon="🏦" color="#60A5FA" sub="Emprestado ativo + disponível" />
            <StatCard label="Capital com funcionários" value={brl(d.capitalComFuncionariosCents)} icon="🧑‍💼" color="#A78BFA" />
            <StatCard label="Repasse pendente" value={brl(d.repassePendenteCents)} icon="↩️" color="#FBBF24" sub="Para repassar ao dono" onPress={() => router.push('/team')} />
            <StatCard label="Comissão a pagar" value={brl(d.comissaoAPagarCents)} icon="💼" color="#F472B6" />
            <StatCard label="Total emprestado" value={brl(d.totalEmprestadoCents)} icon="💰" color="#38BDF8" sub="Saldo devedor ativo" onPress={() => router.push('/loans')} />
            <StatCard label="A receber" value={brl(d.totalAReceberCents)} icon="📥" color={colors.success} />
            <StatCard label="Em perda" value={brl(d.totalEmPerdaCents)} icon="💀" color="#9CA3AF" />
            <StatCard label="Juros recebidos no mês" value={brl(d.jurosRecebidosMesCents)} icon="📈" color="#34D399" />
          </Grid>

          <Grid cols={cols}>
            <StatCard label="⭐ Clientes Bons" value={String(d.scoreCounts.BOM)} color={classColor.BOM} onPress={() => router.push('/clients?f=BOM')} />
            <StatCard label="🟡 Regulares" value={String(d.scoreCounts.REGULAR)} color={classColor.REGULAR} onPress={() => router.push('/clients?f=REGULAR')} />
            <StatCard label="⚠️ Ruins" value={String(d.scoreCounts.RUIM)} color={classColor.RUIM} onPress={() => router.push('/clients?f=RUIM')} />
            <StatCard label="💀 Perda" value={String(d.scoreCounts.PERDA)} color="#9CA3AF" onPress={() => router.push('/clients?f=PERDA')} />
          </Grid>

          <Stack row={isDesktop} style={styles.row}>
            <Card title="Distribuição por score" style={styles.col}>
              <PieChart
                size={isDesktop ? 220 : 170}
                data={[
                  { label: '⭐ Bons', value: d.scoreCounts.BOM, color: classColor.BOM },
                  { label: '🟡 Regulares', value: d.scoreCounts.REGULAR, color: classColor.REGULAR },
                  { label: '⚠️ Ruins', value: d.scoreCounts.RUIM, color: classColor.RUIM },
                  { label: '💀 Perda', value: d.scoreCounts.PERDA, color: '#4B5563' },
                ]}
              />
              <Text style={{ color: colors.textMuted, marginTop: 12, fontWeight: '600' }}>⏰ {d.overdueClients} cliente(s) com parcelas atrasadas</Text>
            </Card>
            <Card
              title="Aprovações pendentes"
              style={styles.col}
              right={hasRole('ADMIN', 'SUPER_ADMIN') ? <Button title="Abrir" size="sm" onPress={() => router.push('/approvals')} /> : undefined}
            >
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <StatCard label="Pagamentos" value={String(d.pendingApprovals.payments)} color={colors.warning} style={{ flex: 1 }} onPress={() => router.push('/approvals')} />
                <StatCard label="Repasses" value={String(d.pendingApprovals.transfers)} color={colors.warning} style={{ flex: 1 }} onPress={() => router.push('/approvals')} />
              </View>
              <Text style={{ color: colors.textMuted, marginTop: 10, fontSize: 13 }}>Recibos só baixam parcelas depois de aprovados pelo administrador.</Text>
            </Card>
          </Stack>

          <Stack row={isDesktop} style={styles.row}>
            <Card title="⭐ Top 5 Bons Pagadores" style={styles.col} accent={classColor.BOM}>
              {d.topBons.length === 0 ? <Empty text="Nenhum cliente bom ainda" icon="⭐" /> : d.topBons.map((c) => <ClientMiniRow key={c.id} c={c} onPress={() => router.push(`/clients/${c.id}`)} />)}
            </Card>
            <Card title="🚨 Top 5 Piores - Ação Urgente" style={styles.col} accent={colors.danger}>
              {d.topPiores.length === 0 ? <Empty text="Nenhum cliente em risco 🎉" icon="✅" /> : d.topPiores.map((c) => <ClientMiniRow key={c.id} c={c} onPress={() => router.push(`/clients/${c.id}`)} />)}
            </Card>
          </Stack>

          <Card title="📅 Próximos vencimentos (7 dias) e atrasados">
            {d.upcoming.length === 0 ? <Empty text="Nenhum vencimento nos próximos 7 dias" icon="📅" /> : null}
            {d.upcoming.map((u) => {
              const late = u.dueDate < todayISO();
              return (
                <Pressable key={`${u.loanId}-${u.number}`} onPress={() => router.push(`/loans/${u.loanId}`)} style={styles.up}>
                  <Text style={[styles.upDate, late && { color: '#F87171' }]}>{dateBR(u.dueDate)}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.upName} numberOfLines={1}>{u.clientName}</Text>
                    <Text style={styles.upNum}>Parcela {u.number}{late ? ' · ATRASADA' : ''}</Text>
                  </View>
                  <Text style={styles.upVal}>{brl(u.valueCents)}</Text>
                </Pressable>
              );
            })}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  col: { flex: 1 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 4, borderRadius: 8, padding: 10, marginBottom: 8 },
  up: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  upDate: { color: colors.primary, fontWeight: '800', width: 92 },
  upName: { color: colors.text, fontWeight: '700', flex: 1 },
  upNum: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
  upVal: { color: colors.text, fontWeight: '800', textAlign: 'right' },
});
