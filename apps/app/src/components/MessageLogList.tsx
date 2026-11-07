import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { TEMPLATE_META, type TemplateKey } from '@lendcontrol/core';
import { api } from '../api';
import { errorMessage } from '../api/http';
import type { MessageLogDTO } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { colors } from '../theme';
import { dateTimeBR, MESSAGE_STATUS_COLOR, MESSAGE_STATUS_LABEL, TEMPLATE_LABEL_EXTRA } from '../utils/format';
import { useToast } from './Toast';
import { Badge, Button, Chip, Empty, ErrorState, Loading } from './ui';

const STATUSES = ['PENDENTE', 'ENVIADO', 'FALHOU', 'LINK_GERADO', 'BLOQUEADO', 'CANCELADO'] as const;

export const templateLabel = (k: string) => TEMPLATE_META[k as TemplateKey]?.label ?? TEMPLATE_LABEL_EXTRA[k] ?? k;

export function MessageStatusBadge({ status }: { status: string }) {
  const c = MESSAGE_STATUS_COLOR[status] ?? { bg: colors.surface2, color: colors.text };
  return <Badge size="sm" text={MESSAGE_STATUS_LABEL[status] ?? status} bg={c.bg} color={c.color} />;
}

function LogRow({ m, showClient, canRetry, onRetried }: { m: MessageLogDTO; showClient: boolean; canRetry: boolean; onRetried: (m: MessageLogDTO) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      const r = await api.messaging.retry(m.id);
      onRetried({ ...m, ...r });
      toast(r.status === 'ENVIADO' ? 'Mensagem reenviada' : `Reenvio: ${MESSAGE_STATUS_LABEL[r.status] ?? r.status}`, r.status === 'FALHOU' ? 'error' : 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID={`msg-${m.id}`} style={styles.row}>
      <View style={styles.head}>
        <MessageStatusBadge status={m.status} />
        <Text style={styles.tpl}>{templateLabel(m.template)}</Text>
        <Text style={styles.meta}>{dateTimeBR(m.sentAt ?? m.createdAt)} · {m.channel}{m.attempts ? ` · ${m.attempts} tentativa(s)` : ''}</Text>
      </View>
      <Text style={styles.to}>
        Para {m.toName ?? '—'} · {m.toPhone}
        {showClient && m.client ? <Text style={styles.meta}> · cliente {m.client.fullName}</Text> : null}
      </Text>
      <Text style={styles.body} numberOfLines={open ? undefined : 2} onPress={() => setOpen(!open)}>
        {m.body}
      </Text>
      {m.lastError ? <Text style={styles.err}>⚠ {m.lastError}</Text> : null}
      {m.waLink || (canRetry && m.status === 'FALHOU') ? (
        <View style={styles.actions}>
          {m.waLink ? <Button testID={`msg-wa-${m.id}`} size="sm" variant="success" icon="💬" title="Abrir wa.me" onPress={() => void Linking.openURL(m.waLink!)} /> : null}
          {canRetry && m.status === 'FALHOU' ? <Button testID={`msg-retry-${m.id}`} size="sm" variant="warning" icon="↻" title="Reenviar" loading={busy} onPress={() => void retry()} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Histórico de mensagens WhatsApp (geral ou de um cliente). */
export function MessageLogList({ clientId, showFilters = true, limit = 100, reloadKey }: { clientId?: string; showFilters?: boolean; limit?: number; reloadKey?: number }) {
  const { hasRole } = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const { data, error, loading, reload, setData } = useAsync(() => api.messaging.logs({ clientId, status: status ?? undefined, limit }), [clientId, status, limit, reloadKey]);
  const canRetry = hasRole('ADMIN', 'SUPER_ADMIN');
  return (
    <View testID="message-log">
      {showFilters ? (
        <View style={styles.filters}>
          <Chip testID="msg-filter-all" label="Todas" active={!status} onPress={() => setStatus(null)} />
          {STATUSES.map((s) => (
            <Chip key={s} testID={`msg-filter-${s}`} label={MESSAGE_STATUS_LABEL[s]} active={status === s} color={MESSAGE_STATUS_COLOR[s].bg} onPress={() => setStatus(s)} />
          ))}
          <Button size="sm" variant="ghost" icon="↻" title="Atualizar" onPress={() => void reload()} />
        </View>
      ) : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && data.length === 0 ? <Empty text={status ? 'Nenhuma mensagem com este status' : 'Nenhuma mensagem registrada'} icon="💬" /> : null}
      {(data ?? []).map((m) => (
        <LogRow key={m.id} m={m} showClient={!clientId} canRetry={canRetry} onRetried={(n) => setData((l) => (l ?? []).map((x) => (x.id === n.id ? { ...x, ...n } : x)))} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  tpl: { color: colors.text, fontWeight: '800', fontSize: 14 },
  meta: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  to: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  body: { color: colors.text, fontSize: 14 },
  err: { color: '#FCA5A5', fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
});
