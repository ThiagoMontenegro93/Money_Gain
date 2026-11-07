import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TransferDTO } from '../api/types';
import { colors } from '../theme';
import { APPROVAL_LABEL, brl, dateTimeBR, TRANSFER_LABEL } from '../utils/format';
import { Empty, StatusChip } from './ui';

export function TransferList({ transfers, renderActions, emptyText = 'Nenhum repasse' }: { transfers: TransferDTO[]; renderActions?: (t: TransferDTO) => React.ReactNode; emptyText?: string }) {
  if (!transfers.length) return <Empty text={emptyText} icon="↔️" />;
  return (
    <View>
      {transfers.map((t) => (
        <View key={t.id} testID={`transfer-${t.id}`} style={[styles.row, { borderLeftColor: t.status === 'APROVADO' ? colors.success : t.status === 'REJEITADO' ? colors.danger : colors.warning }]}>
          <View style={styles.head}>
            <Text style={styles.title}>{TRANSFER_LABEL[t.type] ?? t.type}</Text>
            <StatusChip size="md" status={t.status} label={APPROVAL_LABEL[t.status] ?? t.status} />
          </View>
          <Text style={styles.val}>{brl(t.valueCents)}</Text>
          <Text style={styles.meta}>
            {t.from?.name} → {t.to?.name} · {dateTimeBR(t.createdAt)}
            {t.approvedBy ? ` · decidido por ${t.approvedBy.name} em ${dateTimeBR(t.approvedAt)}` : ''}
          </Text>
          {t.notes ? <Text style={styles.meta}>Obs.: {t.notes}</Text> : null}
          {t.rejectionReason ? <Text style={{ color: '#FCA5A5', fontWeight: '700', marginTop: 4 }}>⛔ {t.rejectionReason}</Text> : null}
          {renderActions ? <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>{renderActions(t)}</View> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.bg, borderRadius: 10, borderLeftWidth: 4, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  title: { color: colors.text, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  val: { color: colors.text, fontWeight: '900', fontSize: 20, marginTop: 6 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4, fontWeight: '600' },
});
