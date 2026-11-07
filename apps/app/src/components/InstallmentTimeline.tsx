import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { InstallmentView } from '@lendcontrol/core';
import { colors } from '../theme';
import { brl, dateBR } from '../utils/format';
import { Badge } from './ui';

const STYLE: Record<string, { color: string; bg: string; label: string }> = {
  PAGA: { color: '#10B981', bg: 'rgba(16,185,129,0.12)', label: 'PAGA' },
  PENDENTE: { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', label: 'PENDENTE' },
  ATRASADA: { color: '#EF4444', bg: 'rgba(239,68,68,0.15)', label: 'ATRASADA' },
  PROJECAO: { color: '#94A3B8', bg: 'rgba(148,163,184,0.10)', label: 'PROJEÇÃO' },
  CANCELADA: { color: '#64748B', bg: 'rgba(100,116,139,0.08)', label: 'CANCELADA' },
};

const TYPE_LABEL: Record<string, string> = { QUITACAO_PREVISTA: 'Quitação prevista (principal + juros)', PROJECAO_JUROS: 'Só juros', PARCELA_FIXA: 'Parcela fixa' };

/** Timeline visual das parcelas: PAGA verde, PENDENTE azul, ATRASADA vermelha, PROJEÇÃO cinza, CANCELADA riscada. */
export function InstallmentTimeline({ items }: { items: InstallmentView[] }) {
  return (
    <View testID="installment-timeline">
      {items.map((i, idx) => {
        const s = STYLE[i.displayStatus] ?? STYLE.PENDENTE;
        const cancelled = i.displayStatus === 'CANCELADA';
        return (
          <View key={i.number} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: s.color, borderColor: s.color }, i.displayStatus === 'PROJECAO' && { backgroundColor: 'transparent', borderStyle: 'dashed' }]}>
                <Text style={styles.dotText}>{i.displayStatus === 'PAGA' ? '✓' : i.number}</Text>
              </View>
              {idx < items.length - 1 ? <View style={[styles.line, i.displayStatus === 'PROJECAO' && { borderStyle: 'dashed', borderLeftWidth: 2, backgroundColor: 'transparent', borderColor: '#475569' }]} /> : null}
            </View>
            <View style={[styles.card, { backgroundColor: s.bg, borderColor: s.color }]}>
              <View style={styles.cardHead}>
                <Text style={[styles.title, cancelled && styles.strike]}>
                  Parcela {i.number} · {dateBR(i.dueDate)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Badge size="sm" text={s.label} bg={s.color} color="#FFF" />
                  {i.isProjection ? <Badge size="sm" text="🔄 Projeção Automática" bg="#334155" color="#E2E8F0" /> : null}
                </View>
              </View>
              <Text style={[styles.sub, cancelled && styles.strike]}>{TYPE_LABEL[i.type] ?? i.type}</Text>
              <View style={styles.values}>
                <Text style={[styles.val, cancelled && styles.strike]}>{brl(i.originalCents)}</Text>
                {i.principalCents > 0 ? <Text style={styles.small}>principal {brl(i.principalCents)}</Text> : null}
                <Text style={styles.small}>juros {brl(i.interestCents)}</Text>
              </View>
              {i.displayStatus === 'ATRASADA' ? (
                <Text style={styles.late}>⏰ {i.diasAtraso} dias de atraso · valor atualizado {brl(i.updatedCents)} · só juros atualizado {brl(i.interestUpdatedCents)}</Text>
              ) : null}
              {i.displayStatus === 'PAGA' ? (
                <Text style={{ color: '#6EE7B7', fontWeight: '700', marginTop: 4 }}>
                  Pago {i.paidCents != null ? brl(i.paidCents) : ''} {i.paidAt ? `em ${dateBR(i.paidAt)}` : ''} {i.paidKind ? `(${i.paidKind})` : ''}
                </Text>
              ) : null}
              {cancelled ? <Text style={{ color: colors.textDim, fontWeight: '700', marginTop: 4 }}>Projeção removida na quitação</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 34, alignItems: 'center' },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  line: { flex: 1, width: 2, backgroundColor: '#334155', marginVertical: 2 },
  card: { flex: 1, borderWidth: 1, borderLeftWidth: 4, borderRadius: 10, padding: 12, marginBottom: 10, minWidth: 0 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  title: { color: colors.text, fontWeight: '800', fontSize: 15 },
  sub: { color: colors.textMuted, fontWeight: '600', marginTop: 2, fontSize: 13 },
  values: { flexDirection: 'row', gap: 12, alignItems: 'baseline', marginTop: 6, flexWrap: 'wrap' },
  val: { color: colors.text, fontWeight: '900', fontSize: 18 },
  small: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  late: { color: '#FCA5A5', fontWeight: '800', marginTop: 6 },
  strike: { textDecorationLine: 'line-through', color: colors.textDim },
});
