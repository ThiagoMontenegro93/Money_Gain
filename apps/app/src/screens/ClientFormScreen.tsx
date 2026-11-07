import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ageFrom,
  brDateToISO,
  ClientForm,
  ClientFormKey,
  formProgress,
  GUARANTOR_RELATIONS,
  ImportResult,
  isoToBR,
  isValidCEP,
  PIX_TYPES,
  PixType,
  RELATIONS,
  RESIDENCE_TIMES,
  RG_ISSUERS,
  todayISO,
  UFS,
  validateClientForm,
} from '@lendcontrol/core';
import { api } from '@/api';
import { errorMessage } from '@/api/http';
import type { ClientDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { ClientLookupField } from '@/components/ClientLookupField';
import { FileSlot } from '@/components/FileSlot';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Badge, Button, Checkbox, ErrorState, InlineError, Input, Loading, MoneyInput, Notice, ProgressBar, ScoreSelector, Section, Segmented, Select, Tabs, Stack } from '@/components/ui';
import { WhatsAppImporter } from '@/components/WhatsAppImporter';
import { useLayout } from '@/hooks/useLayout';
import { useUsers } from '@/hooks/useUsers';
import { colors } from '@/theme';
import { dateTimeBR } from '@/utils/format';

type Form = Partial<ClientForm>;
type Errors = Partial<Record<ClientFormKey | 'lgpdConsent', string>>;

const TABS = [
  { key: 1, label: 'Dados Pessoais', icon: '👤' },
  { key: 2, label: 'Contato e Endereço', icon: '🗺️' },
  { key: 3, label: 'Financeiro', icon: '💵' },
  { key: 4, label: 'Vínculos', icon: '🔗' },
  { key: 5, label: 'Documentos', icon: '📁' },
] as const;

const PIX_LABEL: Record<PixType, string> = { CPF: 'CPF', CELULAR: 'Celular', EMAIL: 'E-mail', ALEATORIA: 'Aleatória', CNPJ: 'CNPJ' };
const isMasked = (v: string | null | undefined) => !!v && v.includes('*');

const EMPTY: Form = { hasGuarantor: false, source: 'MANUAL', lgpdConsent: false };

function RowF({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useLayout();
  return <Stack row={isDesktop} gap={14} colGap={0}>{children}</Stack>;
}

export function ClientFormScreen({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { hasRole, user } = useAuth();
  const users = useUsers();
  const { isDesktop } = useLayout();
  const [form, setForm] = useState<Form>(EMPTY);
  const [birthText, setBirthText] = useState('');
  const [tab, setTab] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<'draft' | 'full' | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!clientId);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [cepBusy, setCepBusy] = useState(false);
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  const [guarantorBadge, setGuarantorBadge] = useState<string | null>(null);
  const [referrerBadge, setReferrerBadge] = useState<string | null>(null);

  const load = async () => {
    if (!clientId) return;
    setLoading(true);
    setLoadErr(null);
    try {
      const d = await api.clients.get(clientId);
      setDetail(d);
      setForm({ ...EMPTY, ...d.form, lgpdConsent: d.form.lgpdConsent ?? !!d.lgpdConsentAt });
      setBirthText(d.form.birthDate ? isoToBR(d.form.birthDate) : '');
      if (d.guarantorClient) setGuarantorBadge(d.guarantorClient.fullName);
      if (d.referrerClient) setReferrerBadge(`${d.referrerClient.fullName} (cliente desde ${String(d.referrerClient.since).slice(0, 4)})`);
    } catch (e) {
      setLoadErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const set = <K extends keyof ClientForm>(k: K, v: ClientForm[K] | null | undefined) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const progress = useMemo(() => formProgress(form), [form]);
  const age = form.birthDate ? ageFrom(form.birthDate, todayISO()) : null;
  const importedAt = form.whatsappImportedAt ?? detail?.whatsappImportedAt ?? null;
  const tabErrors = useMemo(() => {
    const s = new Set<number>();
    const tabOf: Record<string, number> = { pixType: 3, emergencyRelation: 4, internalScore: 3, lgpdConsent: 5 };
    for (const k of Object.keys(errors) as (keyof Errors)[]) {
      if (!errors[k]) continue;
      s.add(tabOf[k] ?? ({ fullName: 1, cpf: 1, rg: 1, rgIssuer: 1, birthDate: 1 } as Record<string, number>)[k] ?? (k.startsWith('emergency') || k.startsWith('guarantor') || k.startsWith('referrer') ? 4 : ['pixKey', 'profession', 'incomeCents'].includes(k) ? 3 : 2));
    }
    return s;
  }, [errors]);

  const applyImport = (r: ImportResult) => {
    const now = new Date().toISOString();
    setForm((f) => ({ ...f, ...r.data, source: 'WHATSAPP', whatsappImportedAt: now }));
    if (r.data.birthDate) setBirthText(isoToBR(r.data.birthDate));
    setErrors({});
    toast(`Ficha preenchida via WhatsApp: ${r.found.length} campos`, 'success');
  };

  const buscarCep = async () => {
    setCepMsg(null);
    if (!form.cep || !isValidCEP(form.cep)) return setErrors((e) => ({ ...e, cep: 'Informe um CEP válido (8 dígitos)' }));
    setCepBusy(true);
    try {
      const r = await api.cep(form.cep);
      setForm((f) => ({ ...f, street: r.street || f.street, district: r.district || f.district, city: r.city || f.city, state: r.state || f.state }));
      setCepMsg(r.found === false ? 'CEP não encontrado - preencha o endereço manualmente' : `Endereço encontrado: ${[r.street, r.district, r.city, r.state].filter(Boolean).join(', ')}${r.source && r.source !== 'viacep' ? ` (${r.source})` : ''}`);
    } catch (e) {
      setCepMsg(errorMessage(e));
    } finally {
      setCepBusy(false);
    }
  };

  const save = async (draft: boolean) => {
    setSaveErr(null);
    const issues = validateClientForm(form, { draft }).filter((i) => !((i.key === 'cpf' && isMasked(form.cpf)) || (i.key === 'guarantorCpf' && isMasked(form.guarantorCpf))));
    if (form.birthDate == null && birthText && !brDateToISO(birthText)) issues.push({ key: 'birthDate', tab: 1, message: 'Data inválida (use dd/mm/aaaa)' });
    const errs: Errors = {};
    for (const i of issues) errs[i.key] ??= i.message;
    if (!draft && !form.lgpdConsent) errs.lgpdConsent = 'O consentimento LGPD é obrigatório para salvar o cliente completo';
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = issues[0]?.tab ?? 5;
      setTab(first as 1 | 2 | 3 | 4 | 5);
      setSaveErr(`Corrija ${Object.keys(errs).length} campo(s) antes de salvar. ${issues[0]?.message ?? errs.lgpdConsent ?? ''}`);
      return;
    }
    const payload: Form = { ...form };
    if (isMasked(payload.cpf)) delete payload.cpf;
    if (isMasked(payload.guarantorCpf)) delete payload.guarantorCpf;
    if (!payload.hasGuarantor) {
      payload.guarantorName = null;
      payload.guarantorCpf = null;
      payload.guarantorPhone = null;
      payload.guarantorRelation = null;
      payload.guarantorClientId = null;
      payload.guarantorDocFileId = null;
    }
    setSaving(draft ? 'draft' : 'full');
    try {
      const d = clientId ? await api.clients.update(clientId, payload, draft) : await api.clients.create(payload, draft);
      toast(draft ? 'Rascunho salvo' : 'Cliente salvo com sucesso', 'success');
      router.replace(`/clients/${d.id}`);
    } catch (e) {
      setSaveErr(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Loading text="Carregando ficha..." />;
  if (loadErr) return <ErrorState message={loadErr} onRetry={load} />;

  const e = errors;
  const progressColor = progress.percent >= 90 ? colors.success : progress.percent >= 60 ? colors.warning : colors.danger;

  return (
    <Screen
      title={clientId ? `Editar ficha - ${detail?.fullName ?? ''}` : 'Novo Cliente'}
      maxWidth={1280}
      footer={
        <View style={styles.footer}>
          <View style={{ flex: 1, minWidth: 260 }}>
            <Checkbox
              testID="lgpd"
              checked={!!form.lgpdConsent}
              onChange={(v) => {
                set('lgpdConsent', v);
                setErrors((x) => ({ ...x, lgpdConsent: undefined }));
              }}
              label={
                <Text style={{ color: e.lgpdConsent ? '#FCA5A5' : colors.text, fontWeight: '600', fontSize: 13 }}>
                  Cliente autorizou o tratamento dos seus dados pessoais conforme a LGPD (Lei 13.709/2018) para análise de crédito e cobrança.<Text style={{ color: colors.required }}> *</Text>
                </Text>
              }
            />
          </View>
          <View style={[styles.footerBtns, !isDesktop && { width: '100%' }]}>
            <Button title="Cancelar" variant="secondary" style={!isDesktop ? { flexGrow: 1 } : undefined} onPress={() => (router.canGoBack() ? router.back() : router.replace('/clients'))} />
            <Button testID="save-draft" title="Salvar Rascunho" variant="secondary" icon="📝" style={!isDesktop ? { flexGrow: 1 } : undefined} loading={saving === 'draft'} disabled={!!saving} onPress={() => void save(true)} />
            <Button testID="save-full" title="Salvar Cliente Completo" variant="success" icon="💾" style={!isDesktop ? { flexGrow: 1, width: '100%' } : undefined} loading={saving === 'full'} disabled={!!saving} onPress={() => void save(false)} />
          </View>
        </View>
      }
    >
      <View style={styles.topRow}>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Text style={styles.progressText}>Ficha {progress.percent}% completa · {progress.filled} de {progress.total} campos</Text>
          <ProgressBar percent={progress.percent} color={progressColor} height={12} />
        </View>
        {importedAt ? <Badge size="lg" text={`📲 Preenchido via WhatsApp - ${dateTimeBR(importedAt)}`} bg="#14532D" color="#BBF7D0" border="#22C55E" /> : null}
        {detail?.status === 'RASCUNHO' ? <Badge size="lg" text="📝 Rascunho" bg="#334155" /> : null}
      </View>

      <WhatsAppImporter onApply={applyImport} />

      <Tabs tabs={TABS.map((t) => ({ ...t, error: tabErrors.has(t.key) }))} active={tab} onChange={(k) => setTab(k as 1 | 2 | 3 | 4 | 5)} />
      <View style={{ height: 14 }} />
      {saveErr ? <InlineError message={saveErr} /> : null}

      {tab === 1 && (
        <>
          <Section title="Dados Pessoais">
            <Input testID="f-fullName" label="Nome Completo" required big value={form.fullName} onChangeText={(v) => set('fullName', v)} error={e.fullName} placeholder="Ex.: João Silva Santos" autoCapitalize="words" />
            <RowF>
              <Input testID="f-cpf" label="CPF" required mask="cpf" value={form.cpf} onChangeText={(v) => set('cpf', v)} error={e.cpf} placeholder="000.000.000-00" style={{ flex: 1 }}
                hint={isMasked(form.cpf) ? 'CPF protegido (LGPD). Digite um novo para alterar.' : undefined}
                right={clientId && isMasked(form.cpf) ? <Button size="sm" variant="secondary" title="Revelar" onPress={async () => { try { const r = await api.clients.revealCpf(clientId); setForm((f) => ({ ...f, cpf: r.cpf, guarantorCpf: r.guarantorCpf ?? f.guarantorCpf })); } catch (er) { toast(errorMessage(er), 'error'); } }} /> : undefined}
              />
              <Input testID="f-rg" label="RG" value={form.rg} onChangeText={(v) => set('rg', v)} placeholder="Número do RG" style={{ flex: 1 }} />
              <Select label="Órgão Emissor" value={form.rgIssuer ?? null} onChange={(v) => set('rgIssuer', v)} allowEmpty placeholder="Selecione" options={RG_ISSUERS.map((i) => ({ value: i, label: i }))} style={{ flex: 1 }} />
            </RowF>
            <RowF>
              <Input
                testID="f-birthDate"
                label="Data Nascimento"
                required
                mask="date"
                value={birthText}
                onChangeText={(v) => {
                  setBirthText(v);
                  set('birthDate', brDateToISO(v) ?? undefined);
                }}
                error={e.birthDate}
                placeholder="dd/mm/aaaa"
                style={{ flex: 1 }}
                hint={age != null ? <Text style={styles.age}>🎂 Idade: {age} anos</Text> : birthText.length === 10 ? 'Data inválida' : undefined}
              />
              {hasRole('ADMIN', 'SUPER_ADMIN') ? (
                <Select label="Responsável (funcionário)" value={form.responsibleUserId ?? null} onChange={(v) => set('responsibleUserId', v)} allowEmpty placeholder={`Eu (${user?.name ?? ''})`} options={users.map((u) => ({ value: u.id, label: u.name }))} style={{ flex: 2 }} />
              ) : <View style={{ flex: 2 }} />}
            </RowF>
          </Section>
          <Section title="Foto e Observações">
            <FileSlot testID="f-selfie" label="Foto Rosto (Selfie)" fileId={form.selfieFileId} onChange={(id) => set('selfieFileId', id)} kind="image" />
            <Input label="Observações Gerais" multiline rows={4} value={form.notes} onChangeText={(v) => set('notes', v)} placeholder="Informações adicionais sobre o cliente" />
          </Section>
        </>
      )}

      {tab === 2 && (
        <>
          <Section title="Contato">
            <RowF>
              <Input testID="f-whatsapp" label="WhatsApp Principal" required mask="phone" value={form.whatsapp} onChangeText={(v) => set('whatsapp', v)} error={e.whatsapp} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
              <Input label="WhatsApp Secundário" mask="phone" value={form.whatsapp2} onChangeText={(v) => set('whatsapp2', v)} error={e.whatsapp2} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
            </RowF>
          </Section>
          <Section title="Endereço">
            <RowF>
              <Input testID="f-cep" label="CEP" required mask="cep" value={form.cep} onChangeText={(v) => set('cep', v)} error={e.cep} placeholder="00000-000" style={{ flex: 1 }} hint={cepMsg ?? undefined}
                right={<Button testID="cep-search" title="Buscar" icon="🔎" loading={cepBusy} onPress={() => void buscarCep()} />} />
              <Input testID="f-street" label="Rua/Avenida" required value={form.street} onChangeText={(v) => set('street', v)} error={e.street} placeholder="Preenchido pelo CEP" style={{ flex: 2 }} />
            </RowF>
            <RowF>
              <Input testID="f-number" label="Número" required value={form.number} onChangeText={(v) => set('number', v)} error={e.number} placeholder="123" style={{ flex: 1 }} />
              <Input label="Complemento" value={form.complement} onChangeText={(v) => set('complement', v)} placeholder="Apto, Bloco" style={{ flex: 1 }} />
              <Input testID="f-district" label="Bairro" required value={form.district} onChangeText={(v) => set('district', v)} error={e.district} placeholder="Bairro" style={{ flex: 1 }} />
            </RowF>
            <RowF>
              <Input testID="f-city" label="Cidade" required value={form.city} onChangeText={(v) => set('city', v)} error={e.city} placeholder="Cidade" style={{ flex: 2 }} />
              <Select testID="f-state" label="Estado" required value={form.state ?? null} onChange={(v) => set('state', v ?? '')} error={e.state} placeholder="UF" options={UFS.map((u) => ({ value: u, label: u }))} style={{ flex: 1 }} />
              <Select label="Tempo Residência" value={form.residenceTime ?? null} onChange={(v) => set('residenceTime', v)} allowEmpty placeholder="Selecione" options={RESIDENCE_TIMES} style={{ flex: 1 }} />
            </RowF>
            <Input label="Ponto Referência" multiline rows={2} value={form.reference} onChangeText={(v) => set('reference', v)} placeholder="Em frente mercado, portão azul" />
          </Section>
        </>
      )}

      {tab === 3 && (
        <>
          <Section title="PIX">
            <RowF>
              <Input testID="f-pixKey" label="Chave PIX" required value={form.pixKey} onChangeText={(v) => set('pixKey', v)} error={e.pixKey} placeholder="CPF, celular, e-mail ou chave aleatória" style={{ flex: 2 }} autoCapitalize="none" />
              <Select testID="f-pixType" label="Tipo PIX" required value={form.pixType ?? null} onChange={(v) => set('pixType', v ?? undefined)} error={e.pixType} placeholder="Selecione" options={PIX_TYPES.map((p) => ({ value: p, label: PIX_LABEL[p] }))} style={{ flex: 1 }} />
            </RowF>
          </Section>
          <Section title="Trabalho e Renda">
            <RowF>
              <Input label="Profissão" value={form.profession} onChangeText={(v) => set('profession', v)} placeholder="Ex.: Motorista" style={{ flex: 1 }} />
              <MoneyInput label="Renda Estimada" value={form.incomeCents} onChange={(v) => set('incomeCents', v)} style={{ flex: 1 }} />
              <Input label="Local Trabalho" value={form.workplace} onChangeText={(v) => set('workplace', v)} placeholder="Empresa / local" style={{ flex: 1 }} />
            </RowF>
          </Section>
          <Section title="Análise Interna">
            <ScoreSelector label="Score Interno (0-10)" value={form.internalScore} onChange={(v) => set('internalScore', v)} error={e.internalScore} />
            <MoneyInput label="Limite de crédito" value={form.creditLimitCents} onChange={(v) => set('creditLimitCents', v)} style={{ maxWidth: 360 }} />
          </Section>
        </>
      )}

      {tab === 4 && (
        <>
          <Section title="Contato de Emergência">
            <RowF>
              <Input testID="f-emergencyName" label="Nome" required value={form.emergencyName} onChangeText={(v) => set('emergencyName', v)} error={e.emergencyName} placeholder="Ex.: Maria Silva" style={{ flex: 2 }} />
              <Select testID="f-emergencyRelation" label="Parentesco" required value={form.emergencyRelation ?? null} onChange={(v) => set('emergencyRelation', v ?? undefined)} error={e.emergencyRelation} options={RELATIONS} style={{ flex: 1 }} />
            </RowF>
            <RowF>
              <Input testID="f-emergencyPhone1" label="Telefone 1" required mask="phone" value={form.emergencyPhone1} onChangeText={(v) => set('emergencyPhone1', v)} error={e.emergencyPhone1} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
              <Input label="Telefone 2" mask="phone" value={form.emergencyPhone2} onChangeText={(v) => set('emergencyPhone2', v)} error={e.emergencyPhone2} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
            </RowF>
          </Section>
          <Section title="Fiador da Dívida">
            <Segmented testIDPrefix="hasGuarantor" label="Tem Fiador?" value={form.hasGuarantor ? 'SIM' : 'NAO'} onChange={(v) => set('hasGuarantor', v === 'SIM')} options={[{ value: 'SIM', label: 'SIM' }, { value: 'NAO', label: 'NÃO' }]} />
            {form.hasGuarantor ? (
              <>
                {form.guarantorClientId && guarantorBadge ? <Badge size="lg" text={`✅ Fiador já é cliente - ${guarantorBadge}`} bg="#064E3B" color="#A7F3D0" border="#10B981" style={{ marginBottom: 12 }} /> : null}
                <RowF>
                  <View style={{ flex: 2 }}>
                    <ClientLookupField
                      testID="f-guarantorName"
                      label="Nome Fiador"
                      required
                      value={form.guarantorName}
                      error={e.guarantorName}
                      excludeId={clientId}
                      onChangeText={(v) => {
                        set('guarantorName', v);
                        if (form.guarantorClientId) {
                          set('guarantorClientId', null);
                          setGuarantorBadge(null);
                        }
                      }}
                      onSelect={(c) => {
                        setForm((f) => ({ ...f, guarantorName: c.fullName, guarantorPhone: c.whatsapp ?? f.guarantorPhone, guarantorClientId: c.id }));
                        setGuarantorBadge(c.fullName);
                      }}
                    />
                  </View>
                  <Input testID="f-guarantorCpf" label="CPF Fiador" required mask="cpf" value={form.guarantorCpf} onChangeText={(v) => set('guarantorCpf', v)} error={e.guarantorCpf} placeholder="000.000.000-00" style={{ flex: 1 }} />
                </RowF>
                <RowF>
                  <Input testID="f-guarantorPhone" label="Telefone Fiador" required mask="phone" value={form.guarantorPhone} onChangeText={(v) => set('guarantorPhone', v)} error={e.guarantorPhone} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
                  <Select label="Vínculo" value={form.guarantorRelation ?? null} onChange={(v) => set('guarantorRelation', v)} allowEmpty placeholder="Selecione" options={GUARANTOR_RELATIONS} style={{ flex: 1 }} />
                </RowF>
                <FileSlot label="Foto Documento Fiador" fileId={form.guarantorDocFileId} onChange={(id) => set('guarantorDocFileId', id)} kind="imageOrPdf" />
              </>
            ) : (
              <Text style={{ color: colors.textMuted }}>Sem fiador para este cliente.</Text>
            )}
          </Section>
          <Section title="Indicação">
            {form.referrerClientId && referrerBadge ? <Badge size="lg" text={`🤝 Indicado por ${referrerBadge}`} bg="#1E3A8A" color="#BFDBFE" border="#3B82F6" style={{ marginBottom: 12 }} /> : null}
            <RowF>
              <View style={{ flex: 2 }}>
                <ClientLookupField
                  testID="f-referrerName"
                  label="Quem Indicou?"
                  value={form.referrerName}
                  excludeId={clientId}
                  onChangeText={(v) => {
                    set('referrerName', v);
                    if (form.referrerClientId) {
                      set('referrerClientId', null);
                      setReferrerBadge(null);
                    }
                  }}
                  onSelect={(c) => {
                    setForm((f) => ({ ...f, referrerName: c.fullName, referrerPhone: c.whatsapp ?? f.referrerPhone, referrerClientId: c.id }));
                    setReferrerBadge(`${c.fullName} (cliente desde ${String(c.since).slice(0, 4)})`);
                  }}
                />
              </View>
              <Input label="Telefone de quem indicou" mask="phone" value={form.referrerPhone} onChangeText={(v) => set('referrerPhone', v)} error={e.referrerPhone} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
            </RowF>
          </Section>
        </>
      )}

      {tab === 5 && (
        <>
          <Notice tone="info" text="📁 Nesta fase você pode anexar a selfie do cliente e a foto do documento do fiador (armazenamento privado com URL assinada de 5 minutos). A galeria completa de documentos (RG, CPF, comprovantes de residência/renda, contrato, comprovantes enviados pelo cliente, verificação e validade) chega na Fase 2." />
          <Section title="Documentos Oficiais">
            <RowF>
              <View style={{ flex: 1 }}>
                <FileSlot label="Selfie do cliente" fileId={form.selfieFileId} onChange={(id) => set('selfieFileId', id)} kind="image" />
              </View>
              <View style={{ flex: 1 }}>
                <FileSlot label="Foto documento do fiador" fileId={form.guarantorDocFileId} onChange={(id) => set('guarantorDocFileId', id)} kind="imageOrPdf" hint={form.hasGuarantor ? undefined : 'Ative "Tem Fiador" na aba Vínculos'} />
              </View>
            </RowF>
          </Section>
          {e.lgpdConsent ? <InlineError message={e.lgpdConsent} /> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 16 },
  progressText: { color: colors.label, fontWeight: '800', marginBottom: 6, fontSize: 14 },
  age: { color: '#93C5FD', fontWeight: '800', fontSize: 13, marginTop: 4 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
});
