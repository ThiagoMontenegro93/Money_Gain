import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { discard, onItemSent, retry, syncNow, useOutbox, type OutboxItem } from '../offline/outbox';
import { useNetState } from '../offline/state';
import { colors } from '../theme';
import { dateTimeBR } from '../utils/format';
import { useToast } from './Toast';
import { Badge, Button, Empty, Modal } from './ui';

const KIND_ICON: Record<OutboxItem['kind'], string> = { payment: '🧾', client: '👤', attempt: '📋', receipt: '📎' };
const p2 = (n: number) => String(n).padStart(2, '0');
/** dd/mm hh:mm */
const shortStamp = (t: number) => {
  const d = new Date(t);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/**
 * Faixa global da Fase 4 (abaixo do cabeçalho do AppShell): aviso de offline com a data dos dados
 * em cache e o indicador "⏳ N pendentes de envio", que abre a lista da fila do aparelho.
 */
export function OfflineBar() {
  const net = useNetState();
  const box = useOutbox();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  useEffect(
    () =>
      onItemSent((item) => {
        toast(`Enviado: ${item.label}${item.kind === 'payment' ? ' - aguardando aprovação' : ''}`);
      }),
    [toast],
  );

  const total = box.items.length;
  if (!net.offline && total === 0) return null;

  return (
    <>
      <View style={[styles.bar, net.offline && styles.barOffline]} testID="offline-bar">
        {net.offline ? (
          <Text testID="offline-banner" style={styles.offText} numberOfLines={2}>
            {net.cachedAt ? `📴 Offline — dados de ${shortStamp(net.cachedAt)}` : '📴 Sem conexão — ações ficam salvas no aparelho'}
          </Text>
        ) : (
          <Text style={styles.onText}>{box.syncing ? '🔄 Enviando...' : '🌐 Online'}</Text>
        )}
        {total > 0 ? (
          <Pressable testID="outbox-pill" onPress={() => setOpen(true)} style={[styles.pill, box.failed > 0 && { borderColor: colors.danger }]}>
            <Text style={styles.pillText}>
              {box.pending > 0 ? `⏳ ${box.pending} ${box.pending === 1 ? 'pendente' : 'pendentes'} de envio` : ''}
              {box.pending > 0 && box.failed > 0 ? ' · ' : ''}
              {box.failed > 0 ? `⚠️ ${box.failed} com erro` : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Modal
        testID="outbox-modal"
        visible={open}
        title="Envios pendentes"
        onClose={() => setOpen(false)}
        width={620}
        footer={
          <>
            <Button title="Fechar" variant="secondary" onPress={() => setOpen(false)} />
            <Button
              testID="outbox-sync"
              title="Sincronizar agora"
              icon="🔄"
              loading={box.syncing}
              disabled={box.pending === 0}
              onPress={async () => {
                const r = await syncNow(true);
                if (r.sent === 0 && r.failed === 0 && box.pending > 0) toast('Ainda sem conexão com o servidor. Tentaremos de novo automaticamente.', 'info');
              }}
            />
          </>
        }
      >
        <Text style={styles.help}>
          Ações feitas sem internet ficam salvas neste aparelho e são enviadas na ordem assim que a conexão volta. Recibos continuam indo para aprovação do administrador.
        </Text>
        {total === 0 ? <Empty text="Nada pendente de envio" icon="✅" /> : null}
        {box.items.map((i, idx) => (
          <View key={i.id} testID={`outbox-item-${idx}`} style={[styles.item, i.status === 'failed' && { borderLeftColor: colors.danger }]}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Text style={{ fontSize: 18 }}>{KIND_ICON[i.kind]}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.itemTitle}>{i.label}</Text>
                <Text style={styles.itemSub}>
                  Salvo em {dateTimeBR(new Date(i.createdAt).toISOString())}
                  {i.files.length ? ` · ${i.files.length} arquivo(s)` : ''}
                  {i.attempts ? ` · ${i.attempts} tentativa(s)` : ''}
                </Text>
                {i.status === 'failed' ? (
                  <Text testID={`outbox-error-${idx}`} style={styles.err}>⛔ Não enviado: {i.error}</Text>
                ) : i.error ? (
                  <Text style={styles.warn}>Última tentativa: {i.error}</Text>
                ) : null}
              </View>
              <Badge size="sm" text={i.status === 'failed' ? 'ERRO' : 'PENDENTE'} bg={i.status === 'failed' ? colors.danger : colors.warning} color="#0F172A" />
            </View>
            <View style={styles.itemBtns}>
              {i.status === 'failed' ? <Button size="sm" variant="secondary" title="Tentar de novo" onPress={() => void retry(i.id)} /> : null}
              <Button testID={`outbox-discard-${idx}`} size="sm" variant="ghost" title="Descartar" onPress={() => void discard(i.id)} />
            </View>
          </View>
        ))}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#0B1220', borderBottomWidth: 1, borderBottomColor: colors.border },
  barOffline: { backgroundColor: '#451A03', borderBottomColor: colors.warning },
  offText: { color: '#FEF3C7', fontWeight: '800', fontSize: 13, flexShrink: 1 },
  onText: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
  pill: { borderWidth: 1, borderColor: colors.warning, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(245,158,11,0.15)' },
  pillText: { color: '#FDE68A', fontWeight: '800', fontSize: 12 },
  help: { color: colors.textMuted, marginBottom: 12, fontWeight: '600' },
  item: { borderLeftWidth: 3, borderLeftColor: colors.warning, backgroundColor: colors.bg, padding: 12, borderRadius: 8, marginBottom: 8, gap: 8 },
  itemTitle: { color: colors.text, fontWeight: '800' },
  itemSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  err: { color: '#FCA5A5', fontWeight: '700', marginTop: 4 },
  warn: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  itemBtns: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
});
