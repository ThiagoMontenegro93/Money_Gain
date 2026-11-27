import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SimulationResult } from '@lendcontrol/core';
import { api } from '../api';
import { errorMessage } from '../api/http';
import type { LoanDetail, SimulateBody } from '../api/types';
import { colors } from '../theme';
import { brl, dateBR, decimalText, parseDecimal } from '../utils/format';
import { draftFromLongLate, LongLateEditor, longLateFromDraft } from './LongLateEditor';
import { Button, Checkbox, InlineError, Input, Modal, Notice } from './ui';

/**
 * Simulação "e se?": muda taxa, multa e atraso longo só no teste, mostra o antes e o depois
 * e só grava se o gestor clicar em "Aplicar de verdade".
 */
export function SimulationModal({ loan, visible, onClose, onApplied }: { loan: LoanDetail; visible: boolean; onClose: () => void; onApplied: () => void }) {
  const [rate, setRate] = useState('');
  const [fee, setFee] = useState(true);
  const [fine, setFine] = useState('');
  const [ll, setLl] = useState(draftFromLongLate(loan));
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setRate(decimalText(loan.ratePercent));
    setFee(loan.allowLateFee);
    setFine(decimalText(loan.multaDiaPercent));
    setLl(draftFromLongLate(loan));
    setResult(null);
    setErr(null);
  }, [visible, loan]);
  useEffect(() => setResult(null), [rate, fee, fine, ll]);

  const rateN = parseDecimal(rate);
  const rateChanged = rateN != null && rateN !== loan.ratePercent;

  const body = (): SimulateBody | string => {
    if (rateN == null || rateN < 0 || rateN > 1000) return 'Taxa entre 0% e 1000%';
    const f = parseDecimal(fine);
    if (fee && (f == null || f < 0 || f > 100)) return 'Multa diária entre 0% e 100%';
    const l = longLateFromDraft(ll);
    if ('error' in l) return l.error;
    return { ratePercent: rateN, allowLateFee: fee, ...(fee ? { multaDiaPercent: f ?? 0 } : {}), ...l.value };
  };

  const run = async () => {
    const b = body();
    if (typeof b === 'string') return setErr(b);
    setErr(null);
    setBusy(true);
    try {
      setResult(await api.loans.simulate(loan.id, b));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const b = body();
    if (typeof b === 'string') return setErr(b);
    const { ratePercent: _rate, asOf: _asOf, ...options } = b;
    setApplying(true);
    try {
      await api.loans.options(loan.id, options);
      onApplied();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setApplying(false);
    }
  };

  const row = (label: string, a: number | null, b: number | null, testID?: string) => {
    const diff = a != null && b != null ? b - a : null;
    return (
      <View style={styles.tr} key={label}>
        <Text style={[styles.td, styles.tdLabel]}>{label}</Text>
        <Text style={styles.td}>{a == null ? '—' : brl(a)}</Text>
        <Text testID={testID} style={[styles.td, { fontWeight: '900' }]}>{b == null ? '—' : brl(b)}</Text>
        <Text style={[styles.td, { color: !diff ? colors.textMuted : diff > 0 ? '#6EE7B7' : '#FCA5A5', fontWeight: '800' }]}>
          {diff == null || diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${brl(Math.abs(diff))}`}
        </Text>
      </View>
    );
  };

  return (
    <Modal
      testID="sim-modal"
      visible={visible}
      title="🧪 Simular mudanças"
      width={760}
      onClose={onClose}
      footer={
        <>
          <Button title="Fechar" variant="secondary" onPress={onClose} />
          <Button testID="sim-run" title="Simular" icon="🧪" loading={busy} onPress={() => void run()} />
          <Button testID="sim-apply" title="Aplicar de verdade" icon="✅" variant="success" disabled={!result} loading={applying} onPress={() => void apply()} />
        </>
      }
    >
      <Text style={styles.lead}>Mude os valores só para teste e veja como ficaria. Nada é gravado até você clicar em "Aplicar de verdade".</Text>
      <View style={styles.grid}>
        <Input testID="sim-rate" label="Taxa % por período" mask="decimal" value={rate} onChangeText={setRate} style={styles.cell} />
        {fee ? <Input testID="sim-fine" label="Multa diária %" mask="decimal" value={fine} onChangeText={setFine} style={styles.cell} /> : null}
      </View>
      <View style={{ gap: 10, marginBottom: 8 }}>
        <Checkbox testID="sim-fee" checked={fee} onChange={setFee} label="Cobrar multa diária por atraso" />
        <LongLateEditor prefix="sim-ll" value={ll} onChange={setLl} />
      </View>
      <InlineError message={err} />
      {result ? (
        <View testID="sim-result" style={styles.result}>
          <Text style={styles.resultTitle}>🧪 Resultado do teste em {dateBR(result.asOf)} (nada foi gravado)</Text>
          <View style={styles.tr}>
            <Text style={[styles.th, styles.tdLabel]} />
            <Text style={styles.th}>Hoje</Text>
            <Text style={styles.th}>Simulado</Text>
            <Text style={styles.th}>Diferença</Text>
          </View>
          {row('Quitação hoje', result.before.payoffCents, result.after.payoffCents, 'sim-after-payoff')}
          {row('Multas', result.before.fineCents, result.after.fineCents)}
          {row('Atraso longo', result.before.longLateCents, result.after.longLateCents)}
          {row('Próxima parcela', result.before.nextValueCents, result.after.nextValueCents)}
          {result.before.interestOnlyCents != null ? row('Pagar só juros', result.before.interestOnlyCents, result.after.interestOnlyCents) : null}
          {rateChanged ? (
            <Notice tone="warning" text="A taxa aparece só na simulação: num empréstimo já liberado ela não é trocada ao aplicar. Para mudar as condições, use a Negociação emergencial ou um novo empréstimo." />
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  lead: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: 180, minWidth: 0, maxWidth: 280 },
  result: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A78BFA', backgroundColor: 'rgba(124,58,237,0.08)', gap: 6 },
  resultTitle: { color: '#C4B5FD', fontWeight: '900', fontSize: 14, marginBottom: 4 },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(148,163,184,0.15)' },
  th: { flex: 1, color: colors.label, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  td: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600', minWidth: 0 },
  tdLabel: { flex: 1.2, color: colors.textMuted, fontWeight: '800' },
});
