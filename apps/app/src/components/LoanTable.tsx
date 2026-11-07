import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { METHOD_LABEL, LoanMethod } from '@lendcontrol/core';
import type { LoanSummary } from '../api/types';
import { useLayout } from '../hooks/useLayout';
import { colors } from '../theme';
import { brl, dateBR, LOAN_STATUS_LABEL, LOAN_TYPE_LABEL } from '../utils/format';
import { Badge, Column, Empty, StatusChip, Table } from './ui';

export function LoanTable({ loans, showClient = true, emptyText = 'Nenhum empréstimo' }: { loans: LoanSummary[]; showClient?: boolean; emptyText?: string }) {
  const router = useRouter();
  const { isDesktop } = useLayout();
  if (!isDesktop) {
    if (!loans.length) return <Empty text={emptyText} icon="💰" />;
    return (
      <View>
        {loans.map((l) => (
          <Pressable key={l.id} onPress={() => router.push(`/loans/${l.id}`)} style={{ backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: l.overdueCount ? colors.danger : l.status === 'QUITADO' ? colors.success : colors.primary }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: colors.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>#{l.code} {showClient ? `· ${l.clientName}` : ''}</Text>
              <StatusChip status={l.status} label={LOAN_STATUS_LABEL[l.status]} />
            </View>
            <Text style={{ color: colors.textMuted, marginTop: 4, fontWeight: '600' }}>
              {brl(l.principalCents)} · {l.ratePercent}% {METHOD_LABEL[l.method as LoanMethod] ?? l.method} · saldo {brl(l.saldoDevedorCents)}
            </Text>
            <Text style={{ color: l.overdueCount ? '#FCA5A5' : colors.textMuted, marginTop: 2, fontSize: 12, fontWeight: '700' }}>
              {l.nextDueDate ? `Próx.: ${dateBR(l.nextDueDate)} - ${brl(l.nextValueCents)}` : l.quitadoEm ? `Quitado em ${dateBR(l.quitadoEm)}` : ''}
              {l.overdueCount ? ` · ${l.overdueCount} atrasada(s)` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }
  const cols: Column<LoanSummary>[] = [
    { key: 'code', title: 'Nº', width: 60, render: (l) => `#${l.code}` },
    ...(showClient ? [{ key: 'client', title: 'Cliente', flex: 2, minWidth: 150, render: (l: LoanSummary) => l.clientName }] : []),
    { key: 'lender', title: 'Funcionário', width: 120, render: (l) => l.lender?.name ?? '—' },
    { key: 'type', title: 'Tipo', width: 170, render: (l) => `${LOAN_TYPE_LABEL[l.type] ?? l.type}` },
    { key: 'method', title: 'Taxa / Método', width: 130, render: (l) => `${l.ratePercent}% ${METHOD_LABEL[l.method as LoanMethod] ?? l.method}` },
    { key: 'principal', title: 'Principal', width: 120, align: 'right', render: (l) => brl(l.principalCents) },
    { key: 'saldo', title: 'Saldo devedor', width: 130, align: 'right', render: (l) => brl(l.saldoDevedorCents) },
    { key: 'next', title: 'Próximo venc.', width: 170, render: (l) => (
      <Text style={{ color: l.overdueCount ? '#FCA5A5' : colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
        {l.nextDueDate ? `${dateBR(l.nextDueDate)} · ${brl(l.nextValueCents)}` : l.quitadoEm ? `Quitado ${dateBR(l.quitadoEm)}` : '—'}
      </Text>
    ) },
    { key: 'overdue', title: 'Atraso', width: 110, render: (l) => (l.overdueCount ? <Badge size="sm" text={`${l.overdueCount} parc. · ${l.diasSemPagar}d`} bg={colors.dangerDark} color="#FFF" /> : <Text style={{ color: colors.textDim }}>—</Text>) },
    { key: 'status', title: 'Status', width: 100, render: (l) => <StatusChip status={l.status} label={LOAN_STATUS_LABEL[l.status]} /> },
  ];
  return <Table columns={cols} rows={loans} keyOf={(l) => l.id} onRowPress={(l) => router.push(`/loans/${l.id}`)} minWidth={showClient ? 1240 : 1100} empty={<Empty text={emptyText} icon="💰" />} />;
}
