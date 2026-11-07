import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PaymentDTO } from '../api/types';
import { colors } from '../theme';
import { openFile } from '../utils/files';
import { APPROVAL_LABEL, brl, dateBR, dateTimeBR, PAYMENT_TYPE_LABEL } from '../utils/format';
import { useToast } from './Toast';
import { Button, Empty, StatusChip } from './ui';

export function PaymentRow({ p, showLoan, actions }: { p: PaymentDTO; showLoan?: boolean; actions?: React.ReactNode }) {
  const toast = useToast();
  const diff = p.expectedValueCents != null ? p.valueCents - p.expectedValueCents : null;
  return (
    <View testID={`payment-${p.id}`} style={[styles.row, { borderLeftColor: p.status === 'APROVADO' ? colors.success : p.status === 'REJEITADO' ? colors.danger : colors.warning }]}>
      <View style={styles.head}>
        <Text style={styles.title}>
          {PAYMENT_TYPE_LABEL[p.type] ?? p.type}
          {p.installmentNumber ? ` · parcela ${p.installmentNumber}` : ''}
          {showLoan ? ` · ${p.clientName} · empréstimo #${p.loanCode}` : ''}
        </Text>
        <StatusChip size="md" status={p.status} label={APPROVAL_LABEL[p.status] ?? p.status} />
      </View>
      <View style={styles.vals}>
        <View>
          <Text style={styles.k}>INFORMADO</Text>
          <Text style={styles.v}>{brl(p.valueCents)}</Text>
        </View>
        <View>
          <Text style={styles.k}>ESPERADO</Text>
          <Text style={[styles.v, { color: colors.textMuted }]}>{brl(p.expectedValueCents)}</Text>
        </View>
        {diff != null && diff !== 0 ? (
          <View>
            <Text style={styles.k}>DIFERENÇA</Text>
            <Text style={[styles.v, { color: diff < 0 ? '#FCA5A5' : '#6EE7B7' }]}>{diff > 0 ? '+' : ''}{brl(diff)}</Text>
          </View>
        ) : null}
        <View>
          <Text style={styles.k}>PAGO EM</Text>
          <Text style={styles.v}>{dateBR(p.paidAt)}</Text>
        </View>
      </View>
      <Text style={styles.meta}>
        Lançado por {p.createdBy?.name} em {dateTimeBR(p.createdAt)}
        {p.approvedBy ? ` · ${p.status === 'REJEITADO' ? 'rejeitado' : 'aprovado'} por ${p.approvedBy.name} em ${dateTimeBR(p.approvedAt)}` : ''}
      </Text>
      {p.notes ? <Text style={styles.meta}>Obs.: {p.notes}</Text> : null}
      {p.resultMessage ? <Text style={styles.result}>✅ {p.resultMessage}</Text> : null}
      {p.rejectionReason ? <Text style={styles.reject}>⛔ Motivo da rejeição: {p.rejectionReason}</Text> : null}
      {p.allocation ? (
        <Text style={styles.meta}>
          Alocação: principal {brl(p.allocation.principalCents)} · juros {brl(p.allocation.interestCents)} · multa {brl(p.allocation.fineCents)}
          {p.allocation.extraCents ? ` · extra ${brl(p.allocation.extraCents)}` : ''} · comissão {brl(p.allocation.commissionCents)}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {p.comprovanteFileId ? <Button size="sm" variant="secondary" icon="🧾" title="Ver comprovante" onPress={() => openFile(p.comprovanteFileId!).catch((e) => toast(e.message, 'error'))} /> : <Text style={styles.meta}>Sem comprovante anexado</Text>}
        {actions}
      </View>
    </View>
  );
}

export function PaymentList({ payments, showLoan, renderActions, emptyText = 'Nenhum pagamento lançado' }: { payments: PaymentDTO[]; showLoan?: boolean; renderActions?: (p: PaymentDTO) => React.ReactNode; emptyText?: string }) {
  if (!payments.length) return <Empty text={emptyText} icon="🧾" />;
  return (
    <View>
      {payments.map((p) => (
        <PaymentRow key={p.id} p={p} showLoan={showLoan} actions={renderActions?.(p)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.bg, borderRadius: 10, borderLeftWidth: 4, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  title: { color: colors.text, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  vals: { flexDirection: 'row', gap: 24, marginTop: 8, flexWrap: 'wrap' },
  k: { color: colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  v: { color: colors.text, fontSize: 17, fontWeight: '900' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 6, fontWeight: '600' },
  result: { color: '#6EE7B7', fontWeight: '700', marginTop: 6 },
  reject: { color: '#FCA5A5', fontWeight: '700', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' },
});
