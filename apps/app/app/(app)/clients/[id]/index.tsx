import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CLASS_META, GUARANTOR_RELATIONS, isoToBR, RELATIONS, RESIDENCE_TIMES } from '@lendcontrol/core';
import { api } from '@/api';
import { errorMessage } from '@/api/http';
import type { ClientDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { ClientDocuments } from '@/components/ClientDocuments';
import { LoanTable } from '@/components/LoanTable';
import { MessageLogList } from '@/components/MessageLogList';
import { PromptModal } from '@/components/PromptModal';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Checkbox, Empty, ErrorState, Input, KV, Loading, Modal, MoneyInput, Notice, ProgressBar, ScoreBadge, Select, StatusChip, Stack, Tabs } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { QUEUED_MESSAGE, submitOrQueue, useOutbox } from '@/offline/outbox';
import { classBand, classColor, colors, scoreColor } from '@/theme';
import { brl, CLIENT_STATUS_LABEL, dateBR, dateTimeBR, decimalText, parseDecimal, pctText } from '@/utils/format';
import { openBlob, openFile } from '@/utils/files';

const ATTEMPT_TYPES = [
  { value: 'LIGACAO', label: '📞 Ligação' },
  { value: 'WHATSAPP', label: '💬 WhatsApp' },
  { value: 'VISITA', label: '🏠 Visita' },
  { value: 'FIADOR', label: '🤝 Contato com fiador' },
  { value: 'EMERGENCIA', label: '🚨 Contato de emergência' },
  { value: 'CARTA', label: '✉️ Carta de cobrança' },
  { value: 'ACORDO', label: '📝 Proposta de acordo' },
  { value: 'OUTRO', label: 'Outro' },
];
const labelOf = (list: { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? v ?? '—';

const TABS = [
  { key: 1, label: 'Resumo', icon: '📊' },
  { key: 2, label: 'Cobrança', icon: '📣' },
  { key: 3, label: 'Ficha', icon: '📄' },
  { key: 4, label: 'Histórico', icon: '🕑' },
  { key: 5, label: 'Documentos', icon: '📁' },
] as const;
type TabKey = 1 | 2 | 3 | 4 | 5;

export default function ClientDetailScreen() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const toast = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN', 'SUPER_ADMIN');
  const { isDesktop } = useLayout();
  const { data: c, error, loading, reload, setData } = useAsync(() => api.clients.get(String(id)), [id]);
  const outbox = useOutbox();
  const [cpf, setCpf] = useState<{ cpf: string; guarantorCpf: string | null } | null>(null);
  const [unblockOpen, setUnblockOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [newLimit, setNewLimit] = useState<number | null>(null);
  const [newRate, setNewRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [waOpen, setWaOpen] = useState<{ title: string; url: string; text: string } | null>(null);
  const [attType, setAttType] = useState<string | null>('LIGACAO');
  const [attResult, setAttResult] = useState('');
  const [attBusy, setAttBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>(() => { const n = Number(tabParam); return (n >= 1 && n <= 5 ? n : 1) as TabKey; });
  const [msgBusy, setMsgBusy] = useState<'CLIENTE' | 'FIADOR' | 'CARTA' | 'DOSSIE' | 'OPTOUT' | null>(null);
  const [negOpen, setNegOpen] = useState(false);
  const [logKey, setLogKey] = useState(0);

  if (loading && !c) return <Loading />;
  if (error && !c) return <ErrorState message={error} onRetry={reload} />;
  if (!c) return null;

  const cls = c.classificacao;
  const meta = CLASS_META[cls];
  const band = classBand[cls];
  const blocked = c.isBlocked || c.creditLock.level === 'BLOCKED';
  const f = c.form;
  const pont = c.pontualidade != null ? `${Math.round(c.pontualidade * 100)}% pontualidade` : 'sem histórico de pagamentos';
  const clsName = { BOM: 'BOM', REGULAR: 'REGULAR', RUIM: 'RUIM', PERDA: 'PERDA' }[cls];
  const address = [f.street && `${f.street} ${f.number ?? ''}`.trim(), f.complement, f.district, f.city && `${f.city}${f.state ? ` - ${f.state}` : ''}`].filter(Boolean).join(', ');

  const applyFidelity = async (body: Parameters<typeof api.clients.fidelity>[1], msg: string) => {
    setBusy(true);
    try {
      const d = await api.clients.fidelity(c.id, body);
      setData(d);
      toast(msg);
      setLimitOpen(false);
      setDiscOpen(false);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addAttempt = async () => {
    if (!attType || attResult.trim().length < 2) return toast('Informe o tipo e o resultado da tentativa', 'error');
    setAttBusy(true);
    try {
      const typeLabel = labelOf(ATTEMPT_TYPES, attType);
      const r = await submitOrQueue({
        kind: 'attempt',
        label: `Tentativa de cobrança (${typeLabel}) · ${c.fullName}`,
        path: `/clients/${encodeURIComponent(c.id)}/collection-attempts`,
        body: { type: attType, result: attResult.trim() },
        meta: { clientId: c.id },
      });
      setAttResult('');
      if (r.queued) toast(QUEUED_MESSAGE, 'info');
      else {
        toast('Tentativa de cobrança registrada');
        await reload();
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setAttBusy(false);
    }
  };

  const sendCollection = async (target: 'CLIENTE' | 'FIADOR') => {
    setMsgBusy(target);
    try {
      const r = await api.clients.collectionMessage(c.id, target);
      setWaOpen({ title: target === 'FIADOR' ? '🤝 Aviso ao fiador' : '💬 Mensagem firme de cobrança', url: r.waLink ?? '', text: r.text });
      if (r.waLink) void Linking.openURL(r.waLink).catch(() => {});
      setLogKey((k) => k + 1);
      void reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setMsgBusy(null);
    }
  };

  const downloadPdf = async (kind: 'CARTA' | 'DOSSIE') => {
    setMsgBusy(kind);
    try {
      const blob = kind === 'CARTA' ? await api.clients.letterPdf(c.id) : await api.clients.dossierPdf(c.id);
      const slug = c.fullName.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-');
      openBlob(blob, `${kind === 'CARTA' ? 'carta-cobranca' : 'dossie'}-${slug}.pdf`);
      toast(kind === 'CARTA' ? 'Carta de cobrança gerada (registrada nas tentativas)' : 'Dossiê jurídico gerado');
      void reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setMsgBusy(null);
    }
  };

  const toggleOptOut = async (v: boolean) => {
    setMsgBusy('OPTOUT');
    try {
      const r = await api.clients.optOut(c.id, v);
      setData({ ...c, whatsappOptOut: r.whatsappOptOut });
      toast(v ? 'Mensagens automáticas desativadas para este cliente' : 'Mensagens automáticas reativadas');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setMsgBusy(null);
    }
  };

  const half = { flex: 1, minWidth: isDesktop ? 0 : undefined };

  return (
    <Screen maxWidth={1400} onRefresh={reload} refreshing={loading}>
      {/* Faixa colorida */}
      <View testID="client-band" style={[styles.band, { backgroundColor: band.bg, borderColor: band.border }, cls === 'PERDA' && { borderWidth: 3 }]}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Text style={styles.bandName}>{cls === 'PERDA' ? '💀 ' : ''}{c.fullName}</Text>
          <Text style={styles.bandSub}>{meta.icon} {meta.label} · {meta.description}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <StatusChip size="md" status={c.isBlocked ? 'BLOQUEADO' : c.status} label={c.isBlocked ? '🚫 Bloqueado' : CLIENT_STATUS_LABEL[c.status]} />
            {c.responsible ? <Badge text={`Responsável: ${c.responsible.name}`} bg="rgba(0,0,0,0.25)" color="#FFF" /> : null}
            {c.negativadoEm ? <Badge testID="negativado-badge" text={`⛔ Negativado em ${dateBR(c.negativadoEm)}`} bg="#7F1D1D" color="#FFF" /> : null}
            {c.whatsappOptOut ? <Badge text="🔕 Sem WhatsApp automático" bg="rgba(0,0,0,0.25)" color="#FFF" /> : null}
            {c.whatsappImportedAt ? <Badge text={`📲 Via WhatsApp - ${dateTimeBR(c.whatsappImportedAt)}`} bg="rgba(0,0,0,0.25)" color="#FFF" /> : null}
            <Badge text={`Ficha ${c.progress.percent}% completa`} bg="rgba(0,0,0,0.25)" color="#FFF" />
          </View>
        </View>
        <View style={styles.bandActions}>
          <Button title="Editar Ficha" icon="✏️" variant="secondary" onPress={() => router.push(`/clients/${c.id}/edit`)} />
          <Button testID="new-loan-btn" title="Novo Empréstimo" icon="💸" variant={blocked ? 'dark' : 'primary'} disabled={blocked} onPress={() => router.push(`/loans/new?clientId=${c.id}`)} />
          {hasRole('SUPER_ADMIN') && blocked ? <Button testID="unblock-btn" title="Desbloquear" icon="🔓" variant="warning" onPress={() => setUnblockOpen(true)} /> : null}
        </View>
      </View>

      {blocked ? (
        <View testID="perda-badge" style={styles.perda}>
          <Text style={styles.perdaText}>💀 PERDA - {c.diasSemPagar} dias sem pagamento - NÃO EMPRESTAR</Text>
          <Text style={{ color: '#FECACA', fontWeight: '600', marginTop: 4 }}>{c.creditLock.message || 'Bloqueado para novos empréstimos.'}</Text>
        </View>
      ) : c.creditLock.level === 'WARNING' ? (
        <Notice tone="warning" text={`${c.creditLock.title} - ${c.creditLock.message}`} />
      ) : null}

      <View style={{ marginBottom: 12 }}>
        <Tabs tabs={TABS.map((t) => ({ ...t }))} active={tab} onChange={(k) => setTab(k as TabKey)} />
      </View>

      {tab === 1 && (
      <>
      <Stack row={isDesktop} style={styles.row}>
        {/* Score */}
        <Card title="Score do cliente" style={half}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <Text testID="score-number" style={[styles.scoreBig, { color: classColor[cls] === '#6B7280' ? '#D1D5DB' : classColor[cls] }]}>{c.score}</Text>
            <Text style={styles.scoreOf}>/10</Text>
            <View style={{ marginLeft: 'auto' }}><ScoreBadge cls={cls} size="lg" /></View>
          </View>
          <View style={{ marginVertical: 10 }}>
            <ProgressBar percent={c.score * 10} color={scoreColor(c.score)} height={14} />
          </View>
          <Text style={styles.scoreText}>Cliente {clsName} - {meta.description} - {pont}</Text>
          <View style={styles.kvRow}>
            <KV k="Em dia" v={String(c.scoreDetail.onTime)} />
            <KV k="Atraso 1-7d" v={String(c.scoreDetail.late1to7)} />
            <KV k="Atraso 8-30d" v={String(c.scoreDetail.late8to30)} />
            <KV k="Atraso >30d" v={String(c.scoreDetail.lateOver30)} />
            <KV k="Vencidas em aberto" v={String(c.scoreDetail.overdueOpen)} />
            <KV k="Dias sem pagar" v={String(c.diasSemPagar)} />
          </View>
        </Card>
        {/* Resumo financeiro */}
        <Card title="Resumo financeiro" style={half}>
          <View style={styles.kvRow}>
            <KV k="Empréstimos ativos" v={String(c.activeLoans)} />
            <KV k="Total emprestado" v={brl(c.totalEmprestadoCents)} />
            <KV k="Em aberto" v={brl(c.emAbertoCents)} />
            <KV k="Parcelas atrasadas" v={String(c.overdueCount)} />
            <KV k="Limite de crédito" v={brl(f.creditLimitCents)} />
            <KV k="Score interno" v={f.internalScore != null ? `${f.internalScore}/10` : '—'} />
            <KV k="Pontualidade" v={pctText(c.pontualidade)} />
            <KV k="Cliente desde" v={dateBR(c.createdAt)} />
          </View>
        </Card>
      </Stack>

      {/* Fidelidade */}
      {cls === 'BOM' && c.fidelity ? (
        <View testID="fidelity-card" style={styles.fid}>
          <Text style={styles.fidTitle}>⭐ CLIENTE FIDELIDADE - Sugestões do Sistema</Text>
          <Text style={styles.fidSummary}>{c.fidelity.summary}</Text>
          <Stack row={isDesktop} style={[styles.row, { marginTop: 10 }]}>
            <View style={styles.fidBox}>
              <Text style={styles.fidBoxText}>
                Aumentar limite de {brl(c.fidelity.limit.fromCents)} para {brl(c.fidelity.limit.toCents)} (+{c.fidelity.limit.percent}%)
              </Text>
              <Button testID="fid-limit" title="Aumentar Margem" icon="📈" variant="success" onPress={() => { setNewLimit(c.fidelity!.limit.toCents); setLimitOpen(true); }} />
            </View>
            <View style={styles.fidBox}>
              <Text style={styles.fidBoxText}>
                {c.fidelity.discount
                  ? `Reduzir taxa de ${decimalText(c.fidelity.discount.fromRate)}% para ${decimalText(c.fidelity.discount.toRate)}% para fidelizar - Economia ${brl(c.fidelity.discount.monthlySavingsCents)}/período para o cliente`
                  : 'Sem empréstimo ativo para aplicar desconto na taxa.'}
              </Text>
              <Button testID="fid-discount" title="Dar Desconto na Taxa" icon="🏷️" variant="success" disabled={!c.fidelity.discount} onPress={() => { setNewRate(decimalText(c.fidelity!.discount!.toRate)); setDiscOpen(true); }} />
            </View>
            <View style={styles.fidBox}>
              <Text style={styles.fidBoxText}>Novo empréstimo com taxa especial de fidelidade{c.fidelity.discount ? ` (${decimalText(c.fidelity.discount.toRate)}%)` : ''}.</Text>
              <Button title="Oferecer Novo Empréstimo com Condição Especial" icon="🎁" variant="primary" onPress={() => router.push(`/loans/new?clientId=${c.id}${c.fidelity?.discount ? `&rate=${c.fidelity.discount.toRate}` : ''}`)} />
            </View>
          </Stack>
        </View>
      ) : null}

      {/* Empréstimos */}
      <Card title={`💰 Empréstimos (${c.loans.length})`} style={{ marginBottom: 12, padding: isDesktop ? 0 : 16 }} right={<View style={{ paddingRight: isDesktop ? 16 : 0, paddingTop: isDesktop ? 12 : 0 }}><Button size="sm" title="Novo" icon="➕" disabled={blocked} onPress={() => router.push(`/loans/new?clientId=${c.id}`)} /></View>}>
        <LoanTable loans={c.loans} showClient={false} emptyText="Cliente ainda não tem empréstimos" />
      </Card>
      </>
      )}

      {tab === 2 && (
      <>
      {/* Ações de cobrança */}
      <Card title="📣 Cobrança" accent={cls === 'PERDA' || cls === 'RUIM' ? colors.danger : colors.orange} style={{ marginBottom: 12 }} testID="collection-card">
        {c.negativadoEm ? <Notice tone="danger" text={`⛔ Cliente marcado para negativação em ${dateTimeBR(c.negativadoEm)}.`} /> : null}
        <View style={styles.actionsRow}>
          <Button testID="wa-firm" title="Mensagem firme (WhatsApp)" icon="💬" variant="success" disabled={!f.whatsapp} loading={msgBusy === 'CLIENTE'} onPress={() => void sendCollection('CLIENTE')} />
          <Button testID="wa-guarantor" title="Avisar fiador" icon="🤝" variant="warning" disabled={!f.hasGuarantor || !f.guarantorPhone} loading={msgBusy === 'FIADOR'} onPress={() => void sendCollection('FIADOR')} />
          <Button title="Ligar Emergência" icon="📞" variant="danger" disabled={!f.emergencyPhone1} onPress={() => Linking.openURL(`tel:${(f.emergencyPhone1 ?? '').replace(/\D/g, '')}`)} />
          <Button testID="letter-pdf" title="Carta de cobrança (PDF)" icon="✉️" variant="secondary" loading={msgBusy === 'CARTA'} onPress={() => void downloadPdf('CARTA')} />
          {isAdmin ? <Button testID="dossier-pdf" title="Dossiê jurídico (PDF)" icon="⚖️" variant="secondary" loading={msgBusy === 'DOSSIE'} onPress={() => void downloadPdf('DOSSIE')} /> : null}
          {isAdmin ? <Button testID="negativate-btn" title={c.negativadoEm ? 'Remover negativação' : 'Negativar'} icon="⛔" variant={c.negativadoEm ? 'secondary' : 'danger'} onPress={() => setNegOpen(true)} /> : null}
        </View>
        <Checkbox testID="wa-optout" checked={!!c.whatsappOptOut} onChange={(v) => { if (msgBusy !== 'OPTOUT') void toggleOptOut(v); }} label="Não enviar WhatsApp automático para este cliente (lembretes e avisos de atraso)" />
        <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 4 }}>As mensagens de cobrança usam os templates configurados e ficam registradas no histórico de WhatsApp e nas tentativas de cobrança.</Text>
      </Card>

      {/* Estratégias de cobrança */}
      {c.strategies.length > 0 ? (
        <Card title="🎯 Estratégias de Cobrança" accent={cls === 'PERDA' ? colors.danger : colors.orange} style={{ marginBottom: 12 }} testID="strategies">
          {cls === 'PERDA' ? (
            <View style={styles.perdaBanner}>
              <Text style={styles.perdaText}>💀 PERDA - {brl(c.scoreDetail?.openDebtCents || c.emAbertoCents)} há {c.diasSemPagar} dias - Ações de cobrança intensiva</Text>
            </View>
          ) : null}
          {c.strategies.map((s, i) => (
            <View key={s.key} style={styles.strategy}>
              <Text style={styles.stratNum}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stratTitle}>{s.title}</Text>
                <Text style={styles.stratDetail}>{s.detail}</Text>
              </View>
              {s.amountCents != null ? <Badge text={brl(s.amountCents)} bg={colors.surface2} /> : null}
            </View>
          ))}
        </Card>
      ) : null}

      {/* Tentativas de cobrança */}
        <Card title="📋 Tentativas de cobrança" style={{ marginBottom: 12 }}>
          <Stack row={isDesktop} style={[styles.row, { alignItems: 'flex-end' }]}>
            <Select label="Tipo" value={attType} onChange={setAttType} options={ATTEMPT_TYPES} style={{ flex: 1 }} />
            <Input testID="attempt-result" label="Resultado" value={attResult} onChangeText={setAttResult} placeholder="Ex.: Prometeu pagar sexta-feira" style={{ flex: 2 }} />
            <Button testID="attempt-save" title="Registrar tentativa" icon="➕" loading={attBusy} onPress={() => void addAttempt()} style={{ marginBottom: 14 }} />
          </Stack>
          {outbox.items.filter((i) => i.kind === 'attempt' && i.meta?.clientId === c.id).map((i) => (
            <View key={i.id} testID="queued-attempt" style={styles.tl}>
              <View style={[styles.tlDot, { backgroundColor: colors.warning }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{labelOf(ATTEMPT_TYPES, String(i.body.type))} <Text style={{ color: i.status === 'failed' ? colors.danger : colors.warning, fontWeight: '700' }}>· {i.status === 'failed' ? `não enviada: ${i.error ?? ''}` : '📴 salva no aparelho, aguardando envio'}</Text></Text>
                <Text style={{ color: colors.textMuted, marginTop: 2 }}>{String(i.body.result)}</Text>
              </View>
            </View>
          ))}
          {c.collectionAttempts.length === 0 && !outbox.items.some((i) => i.kind === 'attempt' && i.meta?.clientId === c.id) ? <Empty text="Nenhuma tentativa registrada" icon="📋" /> : null}
          {c.collectionAttempts.map((a) => (
            <View key={a.id} style={styles.tl}>
              <View style={styles.tlDot} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{labelOf(ATTEMPT_TYPES, a.type)} <Text style={{ color: colors.textMuted, fontWeight: '600' }}>· {dateTimeBR(a.date)} · {a.userName}</Text></Text>
                <Text style={{ color: colors.textMuted, marginTop: 2 }}>{a.result}</Text>
              </View>
            </View>
          ))}
        </Card>

      {/* Histórico WhatsApp */}
      <Card title="💬 Histórico de WhatsApp" style={{ marginBottom: 12 }} testID="client-wa-history">
        <MessageLogList clientId={c.id} showFilters={false} limit={50} reloadKey={logKey} />
      </Card>
      </>
      )}

      {/* Ficha */}
      {tab === 3 && (
      <Card
        title="📄 Ficha do cliente"
        style={{ marginBottom: 12 }}
        right={
          <Button
            testID="reveal-cpf"
            size="sm"
            variant="secondary"
            icon={cpf ? '🙈' : '👁'}
            title={cpf ? 'Ocultar CPF' : 'Revelar CPF (LGPD)'}
            onPress={async () => {
              if (cpf) return setCpf(null);
              try {
                setCpf(await api.clients.revealCpf(c.id));
                toast('CPF revelado - acesso registrado na auditoria LGPD', 'info');
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          />
        }
      >
        <Text style={styles.sec}>DADOS PESSOAIS</Text>
        <View style={styles.kvRow}>
          <KV k="Nome" v={f.fullName} />
          <KV k="CPF" v={cpf?.cpf ?? f.cpf ?? c.cpfMasked} mono />
          <KV k="RG" v={[f.rg, f.rgIssuer].filter(Boolean).join(' ') || '—'} />
          <KV k="Nascimento" v={f.birthDate ? `${isoToBR(f.birthDate)}` : '—'} />
          <KV k="Selfie" v={f.selfieFileId ? <Button size="sm" variant="secondary" title="Ver selfie" onPress={() => openFile(f.selfieFileId!).catch((e) => toast(errorMessage(e), 'error'))} /> : '—'} />
        </View>
        {f.notes ? <KV k="Observações" v={f.notes} /> : null}
        <Text style={styles.sec}>CONTATO E ENDEREÇO</Text>
        <View style={styles.kvRow}>
          <KV k="WhatsApp" v={f.whatsapp || '—'} />
          <KV k="WhatsApp 2" v={f.whatsapp2 || '—'} />
          <KV k="CEP" v={f.cep || '—'} />
          <KV k="Endereço" v={address || '—'} />
          <KV k="Referência" v={f.reference || '—'} />
          <KV k="Tempo residência" v={labelOf(RESIDENCE_TIMES, f.residenceTime)} />
        </View>
        <Text style={styles.sec}>FINANCEIRO</Text>
        <View style={styles.kvRow}>
          <KV k="Chave PIX" v={f.pixKey ? `${f.pixKey} (${f.pixType})` : '—'} />
          <KV k="Profissão" v={f.profession || '—'} />
          <KV k="Renda" v={brl(f.incomeCents)} />
          <KV k="Local trabalho" v={f.workplace || '—'} />
        </View>
        <Text style={styles.sec}>VÍNCULOS</Text>
        <View style={styles.kvRow}>
          <KV k="Emergência" v={f.emergencyName ? `${f.emergencyName} (${labelOf(RELATIONS, f.emergencyRelation)})` : '—'} />
          <KV k="Telefones emergência" v={[f.emergencyPhone1, f.emergencyPhone2].filter(Boolean).join(' / ') || '—'} />
          <KV k="Fiador" v={f.hasGuarantor ? `${f.guarantorName ?? ''} · ${f.guarantorPhone ?? ''} · ${labelOf(GUARANTOR_RELATIONS, f.guarantorRelation)}` : 'Sem fiador'} />
          {f.hasGuarantor ? <KV k="CPF fiador" v={cpf?.guarantorCpf ?? f.guarantorCpf ?? '—'} mono /> : null}
          <KV k="Indicação" v={f.referrerName ? `${f.referrerName}${f.referrerPhone ? ` · ${f.referrerPhone}` : ''}` : '—'} />
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {c.guarantorClient ? <Badge text={`✅ Fiador já é cliente - ${c.guarantorClient.fullName}`} bg="#064E3B" color="#A7F3D0" /> : null}
          {c.referrerClient ? <Badge text={`🤝 Indicado por ${c.referrerClient.fullName} (cliente desde ${String(c.referrerClient.since).slice(0, 4)})`} bg="#1E3A8A" color="#BFDBFE" /> : null}
          {c.lgpdConsentAt ? <Badge text={`🔒 Consentimento LGPD em ${dateTimeBR(c.lgpdConsentAt)}`} bg={colors.surface2} /> : <Badge text="⚠️ Sem consentimento LGPD" bg="#7C2D12" color="#FFF" />}
          {f.hasGuarantor && f.guarantorDocFileId ? <Button size="sm" variant="secondary" title="Ver documento do fiador" onPress={() => openFile(f.guarantorDocFileId!).catch((e) => toast(errorMessage(e), 'error'))} /> : null}
        </View>
      </Card>
      )}

      {/* Histórico */}
      {tab === 4 && (
      <Card title="🕑 Histórico">
        {c.history.length === 0 ? <Empty text="Sem histórico" icon="🕑" /> : null}
        {c.history.map((h) => (
          <View key={h.id} style={styles.tl}>
            <View style={[styles.tlDot, { backgroundColor: colors.textDim }]} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{h.message}</Text>
              <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 2 }}>{dateTimeBR(h.createdAt)}{h.userName ? ` · ${h.userName}` : ''} · {h.type}</Text>
            </View>
          </View>
        ))}
      </Card>
      )}

      {tab === 5 && <ClientDocuments clientId={c.id} />}

      <PromptModal
        visible={negOpen}
        title={c.negativadoEm ? 'Remover negativação' : '⛔ Negativar cliente'}
        tone={c.negativadoEm ? 'default' : 'danger'}
        description={c.negativadoEm ? `Remover a marcação de negativação de ${c.fullName}? A ação fica registrada no histórico.` : `Marcar ${c.fullName} para negativação (cadastro de inadimplentes)? A ação fica registrada no histórico e nas tentativas de cobrança.`}
        confirmLabel={c.negativadoEm ? 'Remover negativação' : 'Negativar'}
        confirmVariant={c.negativadoEm ? 'primary' : 'danger'}
        onClose={() => setNegOpen(false)}
        onConfirm={async () => {
          const r = await api.clients.negativate(c.id, !c.negativadoEm);
          setData({ ...c, negativadoEm: r.negativadoEm });
          setNegOpen(false);
          toast(r.negativadoEm ? 'Cliente marcado para negativação' : 'Negativação removida');
          void reload();
        }}
      />

      <PromptModal
        visible={unblockOpen}
        title="🔓 Desbloquear cliente"
        tone="danger"
        description={`Desbloquear ${c.fullName} para novos empréstimos. Esta ação fica registrada no histórico.`}
        askPassword
        askReason
        confirmLabel="Desbloquear"
        confirmVariant="warning"
        onClose={() => setUnblockOpen(false)}
        onConfirm={async ({ password, reason }) => {
          const d = await api.clients.unblock(c.id, password, reason);
          setData(d);
          setUnblockOpen(false);
          toast('Cliente desbloqueado');
        }}
      />

      <Modal visible={limitOpen} title="📈 Aumentar margem (limite de crédito)" tone="success" onClose={() => setLimitOpen(false)} width={520}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setLimitOpen(false)} /><Button testID="fid-limit-confirm" title="Aplicar novo limite" variant="success" loading={busy} onPress={() => newLimit && void applyFidelity({ kind: 'LIMIT', newLimitCents: newLimit }, 'Limite atualizado')} /></>}>
        {c.fidelity ? <Text style={styles.modalText}>Sugestão: aumentar limite de {brl(c.fidelity.limit.fromCents)} para {brl(c.fidelity.limit.toCents)} (+{c.fidelity.limit.percent}%). {c.fidelity.summary}</Text> : null}
        <MoneyInput label="Novo limite" value={newLimit} onChange={setNewLimit} />
      </Modal>

      <Modal visible={discOpen} title="🏷️ Desconto de fidelidade na taxa" tone="success" onClose={() => setDiscOpen(false)} width={520}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setDiscOpen(false)} /><Button testID="fid-discount-confirm" title="Aplicar desconto" variant="success" loading={busy} onPress={() => { const r = parseDecimal(newRate); if (r == null || !c.fidelity?.discount) return; void applyFidelity({ kind: 'DISCOUNT', loanId: c.fidelity.discount.loanId, newRatePercent: r }, 'Desconto de fidelidade aplicado'); }} /></>}>
        {c.fidelity?.discount ? <Text style={styles.modalText}>Reduzir taxa de {decimalText(c.fidelity.discount.fromRate)}% para {decimalText(c.fidelity.discount.toRate)}% (economia de {brl(c.fidelity.discount.monthlySavingsCents)}/período para o cliente). O desconto fica registrado no histórico.</Text> : null}
        <Input label="Nova taxa (%)" mask="decimal" value={newRate} onChangeText={setNewRate} placeholder="8" />
      </Modal>

      <Modal testID="wa-modal" visible={!!waOpen} title={waOpen?.title ?? ''} onClose={() => setWaOpen(null)} width={620}
        footer={<><Button title="Fechar" variant="secondary" onPress={() => setWaOpen(null)} /><Button testID="wa-open" title="Abrir no WhatsApp" icon="💬" variant="success" disabled={!waOpen?.url} onPress={() => waOpen?.url && Linking.openURL(waOpen.url)} /></>}>
        <Text style={styles.modalText}>{waOpen?.text}</Text>
        <Input testID="wa-link" label="Link wa.me" value={waOpen?.url ?? ''} editable={false} multiline rows={3} />
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  band: { borderRadius: 16, padding: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 12, borderWidth: 1 },
  bandName: { color: '#FFFFFF', fontSize: 26, fontWeight: '900' },
  bandSub: { color: 'rgba(255,255,255,0.92)', fontSize: 15, fontWeight: '700', marginTop: 4 },
  bandActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  perda: { backgroundColor: '#030712', borderWidth: 2, borderColor: colors.danger, borderRadius: 12, padding: 16, marginBottom: 12 },
  perdaBanner: { backgroundColor: '#7F1D1D', borderRadius: 10, padding: 12, marginBottom: 12 },
  perdaText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  col: { flexDirection: 'column' },
  scoreBig: { fontSize: 64, fontWeight: '900', lineHeight: 70 },
  scoreOf: { color: colors.textMuted, fontSize: 22, fontWeight: '800', marginBottom: 10 },
  scoreText: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 },
  fid: { backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 2, borderRadius: 14, padding: 16, marginBottom: 12 },
  fidTitle: { color: '#065F46', fontSize: 18, fontWeight: '900' },
  fidSummary: { color: '#047857', fontWeight: '700', marginTop: 4 },
  fidBox: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12, gap: 10, borderWidth: 1, borderColor: '#A7F3D0', justifyContent: 'space-between' },
  fidBoxText: { color: '#064E3B', fontWeight: '700' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  strategy: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: colors.bg, marginBottom: 8 },
  stratNum: { color: '#FFFFFF', backgroundColor: colors.orange, width: 28, height: 28, borderRadius: 14, textAlign: 'center', lineHeight: 28, fontWeight: '900' },
  stratTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  stratDetail: { color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  tl: { flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange, marginTop: 5 },
  sec: { color: colors.label, fontSize: 12, fontWeight: '900', letterSpacing: 1, marginTop: 10, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 4 },
  modalText: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 14 },
});
