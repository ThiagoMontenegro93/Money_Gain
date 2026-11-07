import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '@/api';
import type { PaymentDTO, TransferDTO } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { PaymentList } from '@/components/PaymentList';
import { PromptModal } from '@/components/PromptModal';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { TransferList } from '@/components/TransferList';
import { Button, Card, Chip, ErrorState, Loading, Notice, Tabs } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { colors } from '@/theme';
import { brl, PAYMENT_TYPE_LABEL, TRANSFER_LABEL } from '@/utils/format';

type Target = { kind: 'payment'; item: PaymentDTO } | { kind: 'transfer'; item: TransferDTO };

const STATUS = [
  { key: 'AGUARDANDO_APROVACAO', label: '⏳ Aguardando' },
  { key: 'APROVADO', label: '✅ Aprovados' },
  { key: 'REJEITADO', label: '⛔ Rejeitados' },
  { key: '', label: 'Todos' },
];

export default function Approvals() {
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const isAdmin = hasRole('ADMIN', 'SUPER_ADMIN');
  const [tab, setTab] = useState<'payments' | 'transfers'>('payments');
  const [status, setStatus] = useState(isAdmin ? 'AGUARDANDO_APROVACAO' : '');
  const [approve, setApprove] = useState<Target | null>(null);
  const [reject, setReject] = useState<Target | null>(null);
  const { data, error, loading, reload } = useAsync(
    async () => {
      const [payments, transfers] = await Promise.all([api.payments.list({ status: status || undefined }), api.transfers.list(status || undefined)]);
      return { payments, transfers };
    },
    [status],
  );

  const canDecide = (createdById: string) => isAdmin && (user?.role === 'SUPER_ADMIN' || createdById !== user?.id);
  const pendingP = data?.payments.filter((p) => p.status === 'AGUARDANDO_APROVACAO').length ?? 0;
  const pendingT = data?.transfers.filter((t) => t.status === 'AGUARDANDO_APROVACAO').length ?? 0;

  const describe = (t: Target) =>
    t.kind === 'payment'
      ? `${PAYMENT_TYPE_LABEL[t.item.type] ?? t.item.type} de ${brl(t.item.valueCents)} - ${t.item.clientName} (empréstimo #${t.item.loanCode})${t.item.expectedValueCents != null ? ` · esperado ${brl(t.item.expectedValueCents)}` : ''} · lançado por ${t.item.createdBy?.name}`
      : `${TRANSFER_LABEL[t.item.type] ?? t.item.type} de ${brl(t.item.valueCents)} · ${t.item.from?.name} → ${t.item.to?.name}`;

  return (
    <Screen
      title={isAdmin ? 'Aprovações' : 'Meus Lançamentos'}
      subtitle={isAdmin ? 'Recibos e repasses só valem depois de aprovados (trava de aprovação).' : 'Acompanhe o status dos recibos e repasses que você lançou.'}
      onRefresh={reload}
      refreshing={loading && !!data}
      maxWidth={1200}
    >
      <Tabs
        tabs={[
          { key: 'payments', label: 'Pagamentos', icon: '🧾', badge: status === 'AGUARDANDO_APROVACAO' || !status ? pendingP || undefined : undefined },
          { key: 'transfers', label: 'Repasses', icon: '↔️', badge: status === 'AGUARDANDO_APROVACAO' || !status ? pendingT || undefined : undefined },
        ]}
        active={tab}
        onChange={setTab}
      />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginVertical: 12 }}>
        {STATUS.map((s) => (
          <Chip key={s.key} testID={`appr-status-${s.key || 'ALL'}`} label={s.label} active={status === s.key} onPress={() => setStatus(s.key)} color={colors.primary} />
        ))}
      </View>
      {isAdmin && Platform.OS !== 'web' ? <Notice tone="info" text="🔒 Ao aprovar, a biometria do aparelho é solicitada antes da senha." /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <Card>
          {tab === 'payments' ? (
            <PaymentList
              payments={data.payments}
              showLoan
              emptyText={status === 'AGUARDANDO_APROVACAO' ? 'Nenhum pagamento aguardando aprovação 🎉' : 'Nenhum pagamento'}
              renderActions={(p) =>
                p.status === 'AGUARDANDO_APROVACAO' && canDecide(p.createdBy?.id) ? (
                  <>
                    <Button testID={`approve-${p.id}`} size="sm" variant="success" icon="✅" title="Aprovar" onPress={() => setApprove({ kind: 'payment', item: p })} />
                    <Button testID={`reject-${p.id}`} size="sm" variant="danger" icon="⛔" title="Rejeitar" onPress={() => setReject({ kind: 'payment', item: p })} />
                  </>
                ) : p.status === 'AGUARDANDO_APROVACAO' && isAdmin ? (
                  <Notice tone="warning" text="Você lançou este recibo - outro administrador deve aprovar." />
                ) : null
              }
            />
          ) : (
            <TransferList
              transfers={data.transfers}
              emptyText={status === 'AGUARDANDO_APROVACAO' ? 'Nenhum repasse aguardando aprovação 🎉' : 'Nenhum repasse'}
              renderActions={(t) =>
                t.status === 'AGUARDANDO_APROVACAO' && isAdmin ? (
                  <>
                    <Button testID={`approve-t-${t.id}`} size="sm" variant="success" icon="✅" title="Aprovar" onPress={() => setApprove({ kind: 'transfer', item: t })} />
                    <Button size="sm" variant="danger" icon="⛔" title="Rejeitar" onPress={() => setReject({ kind: 'transfer', item: t })} />
                  </>
                ) : null
              }
            />
          )}
        </Card>
      ) : null}

      <PromptModal
        visible={!!approve}
        title="✅ Aprovar lançamento"
        tone="success"
        description={approve ? describe(approve) : ''}
        askPassword
        biometric
        confirmLabel="Aprovar"
        confirmVariant="success"
        onClose={() => setApprove(null)}
        onConfirm={async ({ password }) => {
          if (!approve) return;
          if (approve.kind === 'payment') {
            const r = await api.payments.approve(approve.item.id, password);
            toast(r.resultMessage ?? 'Pagamento aprovado');
          } else {
            await api.transfers.approve(approve.item.id, password);
            toast('Repasse aprovado');
          }
          setApprove(null);
          await reload();
        }}
      />
      <PromptModal
        visible={!!reject}
        title="⛔ Rejeitar lançamento"
        tone="danger"
        description={reject ? describe(reject) : ''}
        askReason
        reasonLabel="Motivo da rejeição"
        confirmLabel="Rejeitar"
        confirmVariant="danger"
        onClose={() => setReject(null)}
        onConfirm={async ({ reason }) => {
          if (!reject) return;
          if (reject.kind === 'payment') await api.payments.reject(reject.item.id, reason);
          else await api.transfers.reject(reject.item.id, reason);
          toast('Lançamento rejeitado', 'info');
          setReject(null);
          await reload();
        }}
      />
    </Screen>
  );
}
