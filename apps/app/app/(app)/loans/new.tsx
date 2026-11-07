import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { brDateToISO, isoToBR, LoanMethod, LoanType, METHOD_LABEL, todayISO } from '@lendcontrol/core';
import { api } from '@/api';
import { ApiError, errorMessage } from '@/api/http';
import type { ClientListItem, CreateLoanBody, CreditLock, LoanPreview } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { ClientPicker } from '@/components/ClientPicker';
import { InstallmentTimeline } from '@/components/InstallmentTimeline';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, InlineError, Input, KV, Loading, Modal, MoneyInput, Notice, ScoreBadge, Segmented, Select, Stack } from '@/components/ui';
import { useLayout } from '@/hooks/useLayout';
import { useUsers } from '@/hooks/useUsers';
import { colors } from '@/theme';
import { brl, dateBR, decimalText, parseDecimal } from '@/utils/format';

const METHODS: { value: LoanMethod; label: string }[] = (['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as LoanMethod[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }));
const TYPES: { value: LoanType; label: string }[] = [
  { value: 'INTEREST_ONLY', label: 'Juros com projeção automática' },
  { value: 'FIXED_INSTALLMENT', label: 'Parcela fixa (Price)' },
];

export default function NewLoan() {
  const params = useLocalSearchParams<{ clientId?: string; rate?: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user, hasRole } = useAuth();
  const { isDesktop } = useLayout();
  const users = useUsers();
  const [step, setStep] = useState(1);
  const [client, setClient] = useState<ClientListItem | null>(null);
  const [lock, setLock] = useState<CreditLock | null>(null);
  const [lenderId, setLenderId] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<number | null>(null);
  const [rate, setRate] = useState(params.rate ? decimalText(Number(params.rate)) : '10');
  const [fine, setFine] = useState('1');
  const [method, setMethod] = useState<LoanMethod>('MONTHLY');
  const [type, setType] = useState<LoanType>('INTEREST_ONLY');
  const [count, setCount] = useState('6');
  const [release, setRelease] = useState(isoToBR(todayISO()));
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<LoanPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<CreditLock | null>(null);

  // cliente pré-selecionado (?clientId=)
  useEffect(() => {
    if (!params.clientId) return;
    api.clients.get(String(params.clientId)).then((d) => pickClient(d)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.clientId]);

  const pickClient = (c: ClientListItem) => {
    setClient(c);
    setLock(null);
    api.loans.creditCheck(c.id).then(setLock).catch(() => setLock(null));
  };

  const lenderOptions = users.filter((u) => u.isActive !== false);
  const lender = lenderOptions.find((u) => u.id === (lenderId ?? user?.id)) ?? (user ?? null);
  const rateN = parseDecimal(rate);
  const fineN = parseDecimal(fine);
  const releaseISO = brDateToISO(release);
  const countN = Number(count) || 0;

  const body = useMemo<Omit<CreateLoanBody, 'clientId'>>(
    () => ({
      type,
      method,
      principalCents: principal ?? 0,
      ratePercent: rateN ?? 0,
      multaDiaPercent: fineN ?? 0,
      releaseDate: releaseISO ?? '',
      ...(type === 'FIXED_INSTALLMENT' ? { installmentsCount: countN } : {}),
      ...(lenderId && lenderId !== user?.id ? { lenderUserId: lenderId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }),
    [type, method, principal, rateN, fineN, releaseISO, countN, lenderId, user?.id, notes],
  );

  const termsError = (): string | null => {
    if (!principal || principal <= 0) return 'Informe o valor principal';
    if (rateN == null || rateN < 0) return 'Informe a taxa %';
    if (fineN == null || fineN < 0) return 'Informe a multa diária %';
    if (!releaseISO) return 'Data de liberação inválida (dd/mm/aaaa)';
    if (type === 'FIXED_INSTALLMENT' && (!Number.isInteger(countN) || countN < 1 || countN > 360)) return 'Número de parcelas entre 1 e 360';
    return null;
  };

  const goReview = async () => {
    const te = termsError();
    if (te) return setErr(te);
    setErr(null);
    setStep(3);
    setPreviewing(true);
    setPreviewErr(null);
    try {
      setPreview(await api.loans.preview(body));
    } catch (e) {
      setPreviewErr(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  };

  const doCreate = async (riskAcknowledged: boolean) => {
    if (!client) return;
    setCreating(true);
    setErr(null);
    try {
      const loan = await api.loans.create({ ...body, clientId: client.id, ...(riskAcknowledged ? { riskAcknowledged: true } : {}) });
      toast(`Empréstimo #${loan.code} criado`);
      router.replace(`/loans/${loan.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RISK_NOT_ACKNOWLEDGED') {
        setModal({ level: 'WARNING', title: '⚠️ Cliente de risco', message: e.message });
      } else if (e instanceof ApiError && e.code === 'CREDIT_BLOCKED') {
        setModal({ level: 'BLOCKED', title: '🚫 Cliente bloqueado', message: e.message });
      } else setErr(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const create = async () => {
    if (!client) return;
    setCreating(true);
    let check: CreditLock;
    try {
      check = await api.loans.creditCheck(client.id);
      setLock(check);
    } catch (e) {
      setCreating(false);
      return setErr(errorMessage(e));
    }
    setCreating(false);
    if (check.level === 'OK') return doCreate(false);
    setModal(check);
  };

  const blocked = lock?.level === 'BLOCKED' || client?.isBlocked;
  const quit = preview?.installments.find((i) => !i.isProjection) ?? null;
  const projections = preview?.installments.filter((i) => i.isProjection) ?? [];
  const totalInterest = preview ? preview.totalInterestCents ?? preview.installments.reduce((s, i) => s + i.interestCents, 0) : 0;

  const StepHead = () => (
    <View style={styles.steps}>
      {['Cliente', 'Condições', 'Revisão'].map((s, i) => {
        const n = i + 1;
        const on = n === step;
        const done = n < step;
        return (
          <View key={s} style={[styles.step, on && { borderColor: colors.primary, backgroundColor: 'rgba(59,130,246,0.15)' }, done && { borderColor: colors.success }]}>
            <Text style={[styles.stepN, { backgroundColor: done ? colors.success : on ? colors.primary : colors.surface2 }]}>{done ? '✓' : n}</Text>
            <Text style={styles.stepLabel}>{s}</Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <Screen title="Novo Empréstimo" subtitle={`Passo ${step} de 3`} maxWidth={1100}>
      <StepHead />
      <InlineError message={err} />

      {step === 1 && (
        <Card title="1. Cliente">
          {client ? (
            <View style={styles.selected}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{client.fullName}</Text>
                <Text style={{ color: colors.textMuted, fontWeight: '600' }}>{client.cpfMasked} · em aberto {brl(client.emAbertoCents)} · {client.activeLoans} ativo(s)</Text>
              </View>
              <ScoreBadge cls={client.classificacao} score={client.score} size="lg" />
            </View>
          ) : null}
          {lock && lock.level !== 'OK' ? <Notice tone={lock.level === 'BLOCKED' ? 'danger' : 'warning'} text={`${lock.title}${lock.message ? ` - ${lock.message}` : ''}`} /> : null}
          <ClientPicker selectedId={client?.id} onSelect={pickClient} />
          {hasRole('ADMIN', 'SUPER_ADMIN') ? (
            <Select
              testID="lender"
              label="Funcionário que empresta"
              value={lenderId ?? user?.id ?? null}
              onChange={setLenderId}
              options={lenderOptions.map((u) => ({ value: u.id, label: `${u.name} · disponível ${brl(u.wallet?.capitalDisponivelCents)}` }))}
              style={{ marginTop: 12 }}
            />
          ) : null}
          {lender?.wallet ? <Text style={styles.wallet}>💼 Capital disponível de {lender.name}: {brl(lender.wallet.capitalDisponivelCents)}</Text> : null}
          <View style={styles.nav}>
            <Button title="Cancelar" variant="secondary" onPress={() => router.back()} />
            <Button testID="step1-next" title="Próximo →" disabled={!client || !!blocked} onPress={() => setStep(2)} />
          </View>
          {blocked ? <Text style={{ color: '#FCA5A5', fontWeight: '700', textAlign: 'right' }}>Cliente bloqueado - não é possível emprestar.</Text> : null}
        </Card>
      )}

      {step === 2 && (
        <Card title="2. Condições">
          <Stack row={isDesktop} style={styles.row}>
            <MoneyInput testID="principal" label="Valor principal" required big value={principal} onChange={setPrincipal} style={{ flex: 1 }} />
            <Input testID="rate" label="Taxa % por período" required mask="decimal" value={rate} onChangeText={setRate} placeholder="10" style={{ flex: 1 }} hint={`${rate || '0'}% ${METHOD_LABEL[method].toLowerCase()}`} />
            <Input testID="fine" label="Multa diária %" required mask="decimal" value={fine} onChangeText={setFine} placeholder="1" style={{ flex: 1 }} hint="ValorAtual = Parcela × (1 + %multa × dias)" />
          </Stack>
          <Segmented testIDPrefix="method" label="Método" required value={method} onChange={setMethod} options={METHODS} />
          <Segmented testIDPrefix="type" label="Tipo" required value={type} onChange={setType} options={TYPES} />
          <Stack row={isDesktop} style={styles.row}>
            {type === 'FIXED_INSTALLMENT' ? <Input testID="count" label="Nº de parcelas" required mask="digits" value={count} onChangeText={setCount} style={{ flex: 1 }} /> : null}
            <Input testID="release" label="Data de liberação" required mask="date" value={release} onChangeText={setRelease} placeholder="dd/mm/aaaa" style={{ flex: 1 }} error={release.length === 10 && !releaseISO ? 'Data inválida' : null} />
            <Input label="Observações" value={notes} onChangeText={setNotes} placeholder="Opcional" style={{ flex: 2 }} />
          </Stack>
          {type === 'INTEREST_ONLY' ? (
            <Notice tone="info" text="Projeção automática: a parcela 1 vence com principal + juros (quitação prevista) e o sistema cria 3 parcelas futuras só de juros. Se o cliente pagar só os juros, uma nova projeção é criada no final, sempre mantendo 3 à frente." />
          ) : (
            <Notice tone="info" text="Tabela Price: parcelas fixas com juros sobre o saldo devedor." />
          )}
          <View style={styles.nav}>
            <Button title="← Voltar" variant="secondary" onPress={() => setStep(1)} />
            <Button testID="step2-next" title="Revisar →" onPress={() => void goReview()} />
          </View>
        </Card>
      )}

      {step === 3 && (
        <>
          <Card title="3. Revisão" style={{ marginBottom: 12 }}>
            <View style={styles.kvRow}>
              <KV k="Cliente" v={client?.fullName ?? '—'} />
              <KV k="Funcionário" v={lender?.name ?? '—'} />
              <KV k="Principal" v={brl(principal)} />
              <KV k="Taxa" v={`${rate}% ${METHOD_LABEL[method]}`} />
              <KV k="Multa diária" v={`${fine}%`} />
              <KV k="Tipo" v={TYPES.find((t) => t.value === type)!.label} />
              {type === 'FIXED_INSTALLMENT' ? <KV k="Parcelas" v={count} /> : null}
              <KV k="Liberação" v={release} />
              {preview ? <KV k="Vencimento final" v={dateBR(preview.dueDate)} /> : null}
              {preview ? <KV k="Juros previstos" v={brl(totalInterest)} /> : null}
            </View>
            {lock && lock.level !== 'OK' ? <Notice tone={lock.level === 'BLOCKED' ? 'danger' : 'warning'} text={`${lock.title}${lock.message ? ` - ${lock.message}` : ''}`} /> : null}
          </Card>
          {previewing ? <Loading text="Calculando parcelas..." /> : null}
          <InlineError message={previewErr} />
          {preview ? (
            <Stack row={isDesktop} style={styles.row}>
              <Card title="Resumo" style={{ flex: 1 }}>
                {type === 'INTEREST_ONLY' && quit ? (
                  <>
                    <View style={styles.quit}>
                      <Text style={styles.quitLabel}>PARCELA DE QUITAÇÃO</Text>
                      <Text style={styles.quitVal}>{brl(quit.originalCents)}</Text>
                      <Text style={{ color: '#BFDBFE', fontWeight: '700' }}>vence {dateBR(quit.dueDate)} · {brl(quit.principalCents)} principal + {brl(quit.interestCents)} juros</Text>
                    </View>
                    <Text style={[styles.quitLabel, { marginTop: 12 }]}>3 PROJEÇÕES AUTOMÁTICAS (SÓ JUROS)</Text>
                    {projections.map((p) => (
                      <View key={p.number} style={styles.proj}>
                        <Text style={{ color: colors.text, fontWeight: '800' }}>Parcela {p.number}</Text>
                        <Text style={{ color: colors.textMuted, fontWeight: '700' }}>{dateBR(p.dueDate)}</Text>
                        <Text style={{ color: colors.text, fontWeight: '800' }}>{brl(p.originalCents)}</Text>
                        <Badge size="sm" text="🔄 Projeção Automática" bg="#334155" color="#E2E8F0" />
                      </View>
                    ))}
                  </>
                ) : (
                  <>
                    <View style={styles.quit}>
                      <Text style={styles.quitLabel}>{preview.installments.length} PARCELAS FIXAS DE</Text>
                      <Text style={styles.quitVal}>{brl(preview.installments[0]?.originalCents ?? 0)}</Text>
                      <Text style={{ color: '#BFDBFE', fontWeight: '700' }}>total {brl(preview.installments.reduce((s, i) => s + i.originalCents, 0))} · juros {brl(totalInterest)}</Text>
                    </View>
                  </>
                )}
              </Card>
              <Card title="Parcelas" style={{ flex: 1.3 }}>
                <InstallmentTimeline items={preview.installments} />
              </Card>
            </Stack>
          ) : null}
          <View style={styles.nav}>
            <Button title="← Voltar" variant="secondary" onPress={() => setStep(2)} />
            <Button testID="create-loan" title={blocked ? '🚫 Cliente bloqueado' : 'Criar Empréstimo'} variant={blocked ? 'dark' : 'success'} size="lg" disabled={!!blocked || !preview} loading={creating} onPress={() => void create()} />
          </View>
        </>
      )}

      <Modal
        testID="credit-modal"
        visible={!!modal}
        tone={modal?.level === 'BLOCKED' ? 'danger' : 'warning'}
        title={modal?.title ?? ''}
        onClose={() => setModal(null)}
        width={560}
        footer={
          modal?.level === 'BLOCKED' ? (
            <>
              <Button title="Fechar" variant="secondary" onPress={() => setModal(null)} />
              <Button title="🚫 Emprestar bloqueado" variant="dark" disabled />
            </>
          ) : (
            <>
              <Button title="Cancelar" variant="secondary" onPress={() => setModal(null)} />
              <Button testID="risk-confirm" title="Sim, emprestar mesmo assim" variant="warning" loading={creating} onPress={() => { setModal(null); void doCreate(true); }} />
            </>
          )
        }
      >
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{modal?.message}</Text>
        {modal?.level === 'BLOCKED' ? <Text style={{ color: '#FCA5A5', marginTop: 10, fontWeight: '700' }}>Só o Super Admin pode desbloquear o cliente (com senha e motivo) na ficha do cliente.</Text> : null}
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  stepN: { color: '#FFF', width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, fontWeight: '900', overflow: 'hidden' },
  stepLabel: { color: colors.text, fontWeight: '700' },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 2, borderColor: colors.primary, flexWrap: 'wrap' },
  wallet: { color: colors.textMuted, fontWeight: '700', marginTop: 4 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 14 },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 28 },
  quit: { backgroundColor: '#1E3A8A', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.primary },
  quitLabel: { color: colors.label, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  quitVal: { color: '#FFFFFF', fontWeight: '900', fontSize: 30, marginVertical: 4 },
  proj: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#475569', marginTop: 8, flexWrap: 'wrap' },
});
