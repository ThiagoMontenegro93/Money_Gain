import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { brDateToISO, isoToBR, LoanMethod, LoanQuote, METHOD_LABEL, todayISO } from '@lendcontrol/core';
import { api } from '@/api';
import { errorMessage } from '@/api/http';
import type { LoanDetail, PaymentType } from '@/api/types';
import { FileSlot } from '@/components/FileSlot';
import { InstallmentTimeline } from '@/components/InstallmentTimeline';
import { PaymentList } from '@/components/PaymentList';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, ErrorState, InlineError, Input, KV, Loading, Modal, MoneyInput, Notice, ScoreBadge, Segmented, StatusChip, Stack } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { colors } from '@/theme';
import { brl, dateBR, LOAN_STATUS_LABEL, LOAN_TYPE_LABEL, PAYMENT_TYPE_LABEL } from '@/utils/format';

function suggested(q: LoanQuote | null, t: PaymentType): number | null {
  if (!q) return null;
  if (t === 'JUROS') return q.interestOnlyCents;
  if (t === 'PARCELA') return q.installmentCents;
  if (t === 'QUITACAO') return q.payoff?.amountCents ?? null;
  return null;
}

function QuoteBox({ q }: { q: LoanQuote }) {
  return (
    <View style={styles.kvRow}>
      {q.next ? <KV k="Próxima parcela" v={`#${q.next.number} · ${dateBR(q.next.dueDate)}`} /> : null}
      {q.interestOnlyCents != null ? <KV k="Pagar só juros" v={brl(q.interestOnlyCents)} /> : null}
      {q.installmentCents != null ? <KV k="Valor da parcela" v={brl(q.installmentCents)} /> : null}
      {q.payoff ? <KV k="Quitação total" v={<Text style={{ color: '#6EE7B7', fontWeight: '900', fontSize: 18 }}>{brl(q.payoff.amountCents)}</Text>} /> : null}
      {q.payoff ? <KV k="Composição" v={`principal ${brl(q.payoff.principalCents)} + juros ${brl(q.payoff.interestCents)} + multa ${brl(q.payoff.fineCents)}`} /> : null}
      <KV k="Parcelas atrasadas" v={String(q.overdueCount)} />
    </View>
  );
}

export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { isDesktop } = useLayout();
  const { data: loan, error, loading, reload } = useAsync<LoanDetail>(() => api.loans.get(String(id)), [id]);

  const [simOpen, setSimOpen] = useState(false);
  const [simDate, setSimDate] = useState(isoToBR(todayISO()));
  const [simQuote, setSimQuote] = useState<LoanQuote | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [payType, setPayType] = useState<PaymentType>('JUROS');
  const [payDate, setPayDate] = useState(isoToBR(todayISO()));
  const [payQuote, setPayQuote] = useState<LoanQuote | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [touchedAmount, setTouchedAmount] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [payErr, setPayErr] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const payTypes: { value: PaymentType; label: string }[] =
    loan?.type === 'FIXED_INSTALLMENT'
      ? [{ value: 'PARCELA', label: 'PARCELA' }, { value: 'QUITACAO', label: 'QUITAÇÃO' }, { value: 'AMORTIZACAO', label: 'AMORTIZAÇÃO' }]
      : [{ value: 'JUROS', label: 'JUROS' }, { value: 'QUITACAO', label: 'QUITAÇÃO' }, { value: 'AMORTIZACAO', label: 'AMORTIZAÇÃO' }];

  // atualiza a cotação para a data do pagamento (valor sugerido)
  useEffect(() => {
    if (!payOpen || !loan) return;
    const iso = brDateToISO(payDate);
    if (!iso) return;
    let alive = true;
    api.loans.quote(loan.id, iso).then((q) => alive && setPayQuote(q)).catch(() => alive && setPayQuote(loan.quote));
    return () => {
      alive = false;
    };
  }, [payOpen, payDate, loan]);

  useEffect(() => {
    if (!touchedAmount) setAmount(suggested(payQuote, payType));
  }, [payQuote, payType, touchedAmount]);

  if (loading && !loan) return <Loading />;
  if (error && !loan) return <ErrorState message={error} onRetry={reload} />;
  if (!loan) return null;

  const active = loan.status === 'ATIVO' || loan.status === 'PERDA';
  const pending = loan.payments.find((p) => p.status === 'AGUARDANDO_APROVACAO');
  const q = loan.quote;

  const openPay = () => {
    setPayType(loan.type === 'FIXED_INSTALLMENT' ? 'PARCELA' : 'JUROS');
    setPayDate(isoToBR(todayISO()));
    setPayQuote(loan.quote);
    setTouchedAmount(false);
    setFileId(null);
    setNotes('');
    setPayErr(null);
    setPayOpen(true);
  };

  const simulate = async () => {
    const iso = brDateToISO(simDate);
    if (!iso) return setSimErr('Data inválida (dd/mm/aaaa)');
    setSimBusy(true);
    setSimErr(null);
    try {
      setSimQuote(await api.loans.quote(loan.id, iso));
    } catch (e) {
      setSimErr(errorMessage(e));
    } finally {
      setSimBusy(false);
    }
  };

  const submitPayment = async () => {
    const iso = brDateToISO(payDate);
    if (!iso) return setPayErr('Data do pagamento inválida');
    if (!amount || amount <= 0) return setPayErr('Informe o valor recebido');
    setPayBusy(true);
    setPayErr(null);
    try {
      const num = payType === 'JUROS' || payType === 'PARCELA' ? payQuote?.next?.number : undefined;
      await api.payments.create({ loanId: loan.id, type: payType, amountCents: amount, paidAt: iso, ...(num ? { installmentNumber: num } : {}), ...(fileId ? { comprovanteFileId: fileId } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      setPayOpen(false);
      toast('Recibo lançado - aguardando aprovação do administrador');
      await reload();
    } catch (e) {
      setPayErr(errorMessage(e));
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <Screen
      title={`Empréstimo #${loan.code}`}
      subtitle={`${LOAN_TYPE_LABEL[loan.type] ?? loan.type} · ${loan.ratePercent}% ${METHOD_LABEL[loan.method as LoanMethod] ?? loan.method} · multa ${loan.multaDiaPercent}%/dia`}
      maxWidth={1400}
      onRefresh={reload}
      refreshing={loading}
      actions={
        <>
          <StatusChip size="md" status={loan.status} label={LOAN_STATUS_LABEL[loan.status]} />
          <Button testID="simulate" title="Simular Quitação" icon="🧮" variant="secondary" disabled={!active} onPress={() => { setSimQuote(null); setSimErr(null); setSimOpen(true); }} />
          <Button testID="launch-receipt" title="Lançar recibo" icon="🧾" variant="success" disabled={!active || !!pending} onPress={openPay} />
        </>
      }
    >
      {pending ? <Notice tone="warning" text={`⏳ Há um recibo de ${brl(pending.valueCents)} (${PAYMENT_TYPE_LABEL[pending.type] ?? pending.type}) aguardando aprovação. Novos lançamentos ficam bloqueados até a decisão.`} /> : null}
      {loan.status === 'PERDA' ? <Notice tone="danger" text={`💀 Dias sem pagar: ${loan.diasSemPagar} dias - PERDA`} /> : null}
      {loan.status === 'QUITADO' ? <Notice tone="success" text={`✅ Quitado em ${dateBR(loan.quitadoEm)}`} /> : null}

      <Stack row={isDesktop} style={styles.row}>
        <Card title="Resumo" style={{ flex: 1 }}>
          <View style={styles.kvRow}>
            <KV k="Cliente" v={<Text onPress={() => router.push(`/clients/${loan.clientId}`)} style={styles.link}>{loan.clientName} ›</Text>} />
            <KV k="Score" v={<ScoreBadge cls={loan.client.classificacao} score={loan.client.score} size="sm" />} />
            <KV k="Funcionário (empresta)" v={loan.lender?.name ?? '—'} />
            <KV k="Capital de (dono)" v={loan.funder?.name ?? '—'} />
            <KV k="Principal" v={brl(loan.principalCents)} />
            <KV k="Saldo devedor" v={brl(loan.saldoDevedorCents)} />
            <KV k="Liberação" v={dateBR(loan.releaseDate)} />
            <KV k="Vencimento" v={dateBR(loan.dueDate)} />
            {loan.installmentsCount ? <KV k="Parcelas" v={String(loan.installmentsCount)} /> : null}
            <KV k="Dias sem pagar" v={String(loan.diasSemPagar)} />
          </View>
          {loan.notes ? <KV k="Observações" v={loan.notes} /> : null}
        </Card>
        <Card title="Hoje" style={{ flex: 1 }}>
          <QuoteBox q={q} />
          {q.nextProjectionDate ? (
            <View testID="next-projection" style={styles.proj}>
              <Text style={{ color: '#E2E8F0', fontWeight: '800' }}>🔄 Próxima projeção: {dateBR(q.nextProjectionDate)} se pagar só juros</Text>
            </View>
          ) : null}
        </Card>
      </Stack>

      <Stack row={isDesktop} style={styles.row}>
        <Card title="Timeline das parcelas" style={{ flex: 1.2 }}>
          <View style={styles.legend}>
            <Badge size="sm" text="PAGA" bg="#10B981" color="#FFF" />
            <Badge size="sm" text="PENDENTE" bg="#3B82F6" color="#FFF" />
            <Badge size="sm" text="ATRASADA" bg="#EF4444" color="#FFF" />
            <Badge size="sm" text="PROJEÇÃO" bg="#94A3B8" color="#0F172A" />
            <Badge size="sm" text="CANCELADA" bg="#334155" color="#94A3B8" />
          </View>
          <InstallmentTimeline items={loan.installments} />
        </Card>
        <Card title={`Pagamentos (${loan.payments.length})`} style={{ flex: 1 }}>
          <PaymentList payments={loan.payments} />
        </Card>
      </Stack>

      <Modal testID="simulate-modal" visible={simOpen} title="🧮 Simular Quitação" onClose={() => setSimOpen(false)} width={640}
        footer={<><Button title="Fechar" variant="secondary" onPress={() => setSimOpen(false)} /><Button testID="simulate-run" title="Simular" loading={simBusy} onPress={() => void simulate()} /></>}>
        <Text style={{ color: colors.text, marginBottom: 10, fontWeight: '600' }}>Quanto o cliente pagaria para quitar na data escolhida (com multa diária, se houver atraso).</Text>
        <Input testID="simulate-date" label="Data da quitação" mask="date" value={simDate} onChangeText={setSimDate} placeholder="dd/mm/aaaa" onSubmitEditing={() => void simulate()} />
        <InlineError message={simErr} />
        {simQuote ? (
          <>
            {simQuote.payoff ? (
              <View style={styles.payoff}>
                <Text style={styles.payoffLabel}>QUITAÇÃO EM {dateBR(simQuote.asOf)}</Text>
                <Text style={styles.payoffVal}>{brl(simQuote.payoff.amountCents)}</Text>
                <Text style={{ color: '#D1FAE5', fontWeight: '700' }}>
                  principal {brl(simQuote.payoff.principalCents)} + juros {brl(simQuote.payoff.interestCents)} + multa {brl(simQuote.payoff.fineCents)}
                </Text>
                <Text style={{ color: '#D1FAE5', marginTop: 6 }}>
                  Parcelas pagas: {simQuote.payoff.coveredNumbers.join(', ') || '—'} · projeções removidas: {simQuote.payoff.cancelledNumbers.join(', ') || 'nenhuma'}
                </Text>
              </View>
            ) : <Notice tone="info" text="Nada a quitar nesta data." />}
            <QuoteBox q={simQuote} />
          </>
        ) : null}
      </Modal>

      <Modal testID="receipt-modal" visible={payOpen} title="🧾 Lançar recibo" onClose={() => setPayOpen(false)} width={680}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setPayOpen(false)} /><Button testID="receipt-submit" title="Enviar para aprovação" variant="success" loading={payBusy} onPress={() => void submitPayment()} /></>}>
        <Segmented testIDPrefix="ptype" label="Tipo" required value={payType} onChange={(t) => { setPayType(t); setTouchedAmount(false); }} options={payTypes} />
        <Text style={styles.help}>
          {payType === 'JUROS' ? 'Só juros: a parcela é marcada como paga, o principal continua e uma nova projeção é criada no final.' : payType === 'QUITACAO' ? 'Quitação total: paga principal + juros (+ multa) e cancela todas as projeções futuras.' : payType === 'PARCELA' ? 'Pagamento da próxima parcela fixa (com multa se atrasada).' : 'Amortização: abate parte do principal.'}
        </Text>
        <Stack row={isDesktop} style={styles.row}>
          <Input testID="receipt-date" label="Data do pagamento" required mask="date" value={payDate} onChangeText={setPayDate} placeholder="dd/mm/aaaa" style={{ flex: 1 }} />
          <MoneyInput testID="receipt-amount" label="Valor recebido" required big value={amount} onChange={(v) => { setTouchedAmount(true); setAmount(v); }} style={{ flex: 1 }}
            hint={suggested(payQuote, payType) != null ? `Valor sugerido: ${brl(suggested(payQuote, payType))}${payQuote?.next && (payType === 'JUROS' || payType === 'PARCELA') ? ` (parcela ${payQuote.next.number})` : ''}` : undefined} />
        </Stack>
        {touchedAmount && suggested(payQuote, payType) != null ? <Button size="sm" variant="ghost" title="Usar valor sugerido" onPress={() => setTouchedAmount(false)} style={{ alignSelf: 'flex-start', marginTop: -8, marginBottom: 6 }} /> : null}
        <FileSlot testID="receipt-file" label="Comprovante PIX" fileId={fileId} onChange={setFileId} kind="imageOrPdf" hint="Imagem ou PDF até 10 MB" />
        <Input label="Observações" value={notes} onChangeText={setNotes} multiline rows={2} placeholder="Opcional" />
        <Notice tone="info" text="🔒 O recibo fica AGUARDANDO APROVAÇÃO. A parcela só é baixada e a carteira atualizada após o administrador aprovar." />
        <InlineError message={payErr} />
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 },
  link: { color: '#93C5FD', fontWeight: '800', fontSize: 15 },
  proj: { marginTop: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#64748B', borderRadius: 10, padding: 12, backgroundColor: 'rgba(148,163,184,0.1)' },
  legend: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  payoff: { backgroundColor: '#065F46', borderRadius: 12, padding: 16, marginVertical: 12 },
  payoffLabel: { color: '#A7F3D0', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  payoffVal: { color: '#FFFFFF', fontWeight: '900', fontSize: 32 },
  help: { color: colors.textMuted, marginTop: -6, marginBottom: 12, fontWeight: '600' },
});
