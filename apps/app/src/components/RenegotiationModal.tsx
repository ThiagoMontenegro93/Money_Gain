import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addDays, brDateToISO, isoToBR, LoanMethod, METHOD_LABEL, todayISO } from '@lendcontrol/core';
import { api } from '../api';
import { errorMessage } from '../api/http';
import type { LoanDetail, RenegotiationBody, RenegotiationPreview } from '../api/types';
import { colors } from '../theme';
import { brl, dateBR, parseDecimal } from '../utils/format';
import { PromptModal } from './PromptModal';
import { Button, Checkbox, InlineError, Input, KV, Modal, MoneyInput, Notice, Segmented } from './ui';

const METHODS: { value: LoanMethod; label: string }[] = (['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as LoanMethod[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }));

/**
 * Negociação emergencial: o cliente virou risco e propõe pagar um valor menor (ou parcelado).
 * Primeiro simula (nada é gravado); depois fecha o acordo com senha.
 */
export function RenegotiationModal({ loan, visible, onClose, onDone }: { loan: LoanDetail; visible: boolean; onClose: () => void; onDone: (novo: LoanDetail) => void }) {
  const [agreed, setAgreed] = useState<number | null>(null);
  const [count, setCount] = useState('5');
  const [method, setMethod] = useState<LoanMethod>('MONTHLY');
  const [first, setFirst] = useState(isoToBR(addDays(todayISO(), 30)));
  const [fee, setFee] = useState(false);
  const [fine, setFine] = useState('1');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<RenegotiationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAgreed(null);
    setCount('5');
    setMethod('MONTHLY');
    setFirst(isoToBR(addDays(todayISO(), 30)));
    setFee(false);
    setReason('');
    setPreview(null);
    setErr(null);
  }, [visible]);
  // qualquer mudança invalida a simulação anterior
  useEffect(() => setPreview(null), [agreed, count, method, first, fee, fine]);

  const body = (): RenegotiationBody | string => {
    if (!agreed || agreed <= 0) return 'Informe quanto o cliente vai pagar no acordo';
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 360) return 'Número de parcelas entre 1 e 360';
    const firstISO = brDateToISO(first);
    if (!firstISO) return 'Data da 1ª parcela inválida (dd/mm/aaaa)';
    const f = parseDecimal(fine);
    if (fee && (f == null || f < 0 || f > 100)) return 'Multa diária entre 0% e 100%';
    return { agreedCents: agreed, installmentsCount: n, method, firstDueDate: firstISO, allowLateFee: fee, multaDiaPercent: fee ? (f ?? 0) : 0 };
  };

  const simulate = async () => {
    const b = body();
    if (typeof b === 'string') return setErr(b);
    setErr(null);
    setBusy(true);
    try {
      setPreview(await api.loans.renegotiatePreview(loan.id, b));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const askConfirm = () => {
    if (!preview) return setErr('Simule o acordo antes de fechar');
    if (reason.trim().length < 3) return setErr('Explique o motivo do acordo');
    setErr(null);
    setConfirm(true);
  };

  const shown = preview ? (preview.installments.length > 6 ? preview.installments.slice(0, 5) : preview.installments) : [];

  return (
    <>
      <Modal
        testID="reneg-modal"
        visible={visible && !confirm}
        title="🤝 Negociação emergencial"
        tone="warning"
        width={720}
        onClose={onClose}
        footer={
          <>
            <Button title="Cancelar" variant="secondary" onPress={onClose} />
            <Button testID="reneg-preview" title="Simular acordo" icon="🧪" variant="secondary" loading={busy} onPress={() => void simulate()} />
            <Button testID="reneg-confirm" title="Fechar acordo" icon="🤝" variant="warning" disabled={!preview} onPress={askConfirm} />
          </>
        }
      >
        <Text style={styles.lead}>
          Para quando o cliente virou risco e propõe pagar o que consegue. A dívida atual é encerrada e vira um acordo em parcelas, sem juros novos. Simule à vontade: só grava quando você fechar o acordo com a sua senha.
        </Text>
        <View style={styles.kvRow}>
          <KV k="Cliente" v={loan.clientName} />
          <KV k="Saldo devedor (capital)" v={brl(loan.saldoDevedorCents)} />
          <KV k="Dívida hoje (com juros e multas)" v={<Text style={{ color: '#FCA5A5', fontWeight: '900' }}>{brl(loan.quote.payoff?.amountCents ?? loan.saldoDevedorCents)}</Text>} />
        </View>
        <View style={styles.grid}>
          <MoneyInput testID="reneg-agreed" label="Quanto o cliente vai pagar no total" required value={agreed} onChange={setAgreed} style={styles.cell} />
          <Input testID="reneg-count" label="Em quantas parcelas" required mask="digits" value={count} onChangeText={setCount} style={styles.cell} />
          <Input testID="reneg-first" label="1ª parcela em" required mask="date" value={first} onChangeText={setFirst} placeholder="dd/mm/aaaa" style={styles.cell} />
        </View>
        <Segmented testIDPrefix="reneg-method" label="Frequência" value={method} onChange={setMethod} options={METHODS} />
        <View style={{ gap: 8, marginBottom: 8 }}>
          <Checkbox testID="reneg-fee" checked={fee} onChange={setFee} label="Cobrar multa diária se atrasar uma parcela do acordo" />
          {fee ? <Input testID="reneg-fine" label="Multa diária %" mask="decimal" value={fine} onChangeText={setFine} style={{ maxWidth: 220 }} /> : null}
        </View>
        <Input testID="reneg-reason" label="Motivo do acordo" required multiline rows={2} value={reason} onChangeText={setReason} placeholder="Ex.: perdeu o emprego, propôs pagar 5 mil em 10x" />
        <InlineError message={err} />

        {preview ? (
          <View testID="reneg-result" style={styles.result}>
            <Text style={styles.resultTitle}>🧪 Simulação (nada foi gravado)</Text>
            <View style={styles.kvRow}>
              <KV k="Acordo" v={`${preview.installments.length}x de ${brl(preview.installments[0].valueCents)}`} />
              <KV k="Total do acordo" v={brl(preview.agreedCents)} />
              <KV k="Recupera da dívida" v={`${String(preview.recoveryPercent).replace('.', ',')}%`} />
              <KV k="Desconto concedido" v={brl(preview.discountCents)} />
              <KV k="Prejuízo de capital" v={<Text testID="reneg-writeoff" style={{ color: preview.writeOffCents ? '#FCA5A5' : '#6EE7B7', fontWeight: '900' }}>{brl(preview.writeOffCents)}</Text>} />
              {preview.revenueCents ? <KV k="Lucro acima do capital" v={<Text style={{ color: '#6EE7B7', fontWeight: '900' }}>{brl(preview.revenueCents)}</Text>} /> : null}
              <KV k="Última parcela" v={dateBR(preview.dueDate)} />
            </View>
            <View style={{ marginTop: 6 }}>
              {shown.map((i) => (
                <Text key={i.number} style={styles.inst}>
                  #{i.number} · {dateBR(i.dueDate)} · {brl(i.valueCents)}
                </Text>
              ))}
              {preview.installments.length > shown.length ? (
                <Text style={styles.inst}>… e mais {preview.installments.length - shown.length} parcela(s), a última em {dateBR(preview.dueDate)}</Text>
              ) : null}
            </View>
            {preview.writeOffCents > 0 ? (
              <Notice tone="warning" text={`Ao fechar, ${brl(preview.writeOffCents)} de capital saem como prejuízo no caixa. O acordo devolve primeiro o capital; o que passar do saldo devedor vira lucro.`} />
            ) : (
              <Notice tone="success" text="O acordo devolve todo o capital emprestado." />
            )}
          </View>
        ) : null}
      </Modal>
      <PromptModal
        visible={confirm}
        title="🤝 Confirmar acordo"
        tone="warning"
        description={preview ? `Encerrar a dívida de ${brl(preview.debtCents)} e criar acordo de ${brl(preview.agreedCents)} em ${preview.installments.length}x. Isso não pode ser desfeito.` : ''}
        askPassword
        biometric
        confirmLabel="Fechar acordo"
        confirmVariant="warning"
        onClose={() => setConfirm(false)}
        onConfirm={async ({ password }) => {
          const b = body();
          if (typeof b === 'string') throw new Error(b);
          const novo = await api.loans.renegotiate(loan.id, { ...b, reason: reason.trim(), password });
          setConfirm(false);
          onDone(novo);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  lead: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: 180, minWidth: 0 },
  result: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A78BFA', backgroundColor: 'rgba(124,58,237,0.08)', gap: 8 },
  resultTitle: { color: '#C4B5FD', fontWeight: '900', fontSize: 14 },
  inst: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
