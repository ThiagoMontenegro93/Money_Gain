import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatPhone, TEMPLATE_VARS } from '@lendcontrol/core';
import { api } from '@/api';
import { errorMessage, http } from '@/api/http';
import type { MessageTemplateDTO, WaProvider, WhatsAppConfigBody, WhatsAppConfigDTO } from '@/api/types';
import { ROLE_LABEL, useAuth } from '@/auth/AuthContext';
import { BackupPanel } from '@/components/BackupPanel';
import { MessageLogList, MessageStatusBadge } from '@/components/MessageLogList';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Checkbox, Empty, ErrorState, InlineError, Input, KV, Loading, Notice, Select, Stack, Tabs } from '@/components/ui';
import { API_URL } from '@/config';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { colors } from '@/theme';
import { MESSAGE_STATUS_LABEL, WA_PROVIDER_LABEL } from '@/utils/format';

type TabKey = 'perfil' | 'whatsapp' | 'templates' | 'mensagens' | 'backup';

// ---------------------------------------------------------------------------
// Meu perfil
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { user, logout, hasRole, refreshMe } = useAuth();
  const toast = useToast();
  const { isDesktop } = useLayout();
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [pix, setPix] = useState(user?.pixKey ?? '');
  const [pBusy, setPBusy] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    setPhone(user?.phone ? formatPhone(user.phone) : '');
    setPix(user?.pixKey ?? '');
  }, [user?.phone, user?.pixKey]);

  const saveProfile = async () => {
    setPBusy(true);
    try {
      await api.users.updateMe({ phone: phone.trim() || null, pixKey: pix.trim() || null });
      await refreshMe();
      toast('Perfil atualizado');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setPBusy(false);
    }
  };

  const savePassword = async () => {
    if (!cur) return setPwErr('Informe a senha atual');
    if (nw.length < 8) return setPwErr('A nova senha deve ter ao menos 8 caracteres');
    if (nw !== nw2) return setPwErr('A confirmação não confere com a nova senha');
    setPwBusy(true);
    setPwErr(null);
    try {
      await api.users.updateMe({ currentPassword: cur, newPassword: nw });
      setCur(''); setNw(''); setNw2('');
      toast('Senha alterada');
    } catch (e) {
      setPwErr(errorMessage(e));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <Card title="Minha conta" style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 28 }}>
          <KV k="Nome" v={user?.name ?? ''} />
          <KV k="E-mail" v={user?.email ?? ''} />
          <KV k="Papel" v={user ? ROLE_LABEL[user.role] : ''} />
          <KV k="API" v={API_URL} />
        </View>
        <Button title="Sair" icon="🚪" variant="secondary" onPress={() => void logout()} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Stack row={isDesktop} style={{ marginBottom: 12 }}>
        <Card title="📇 Meus dados" style={{ flex: 1 }}>
          <Input testID="me-phone" label="Telefone / WhatsApp" mask="phone" value={phone} onChangeText={setPhone} placeholder="(21) 99999-9999" />
          <Input testID="me-pix" label="Chave PIX" value={pix} onChangeText={setPix} placeholder="CPF, celular, e-mail ou aleatória" autoCapitalize="none" hint="Usada como {pix_chave} nas mensagens dos seus clientes" />
          <Button testID="me-save" title="Salvar perfil" icon="💾" loading={pBusy} onPress={() => void saveProfile()} style={{ alignSelf: 'flex-start' }} />
        </Card>
        <Card title="🔑 Alterar senha" style={{ flex: 1 }}>
          <Input testID="pw-current" label="Senha atual" secure value={cur} onChangeText={setCur} autoCapitalize="none" />
          <Input testID="pw-new" label="Nova senha" secure value={nw} onChangeText={setNw} placeholder="Mínimo 8 caracteres" autoCapitalize="none" />
          <Input testID="pw-new2" label="Confirmar nova senha" secure value={nw2} onChangeText={setNw2} autoCapitalize="none" onSubmitEditing={() => void savePassword()} />
          <InlineError message={pwErr} />
          <Button testID="pw-save" title="Alterar senha" icon="🔑" variant="secondary" loading={pwBusy} onPress={() => void savePassword()} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </Stack>

      {hasRole('SUPER_ADMIN') ? (
        <Card title="Rotina diária" style={{ marginBottom: 12 }}>
          <Text style={{ color: colors.textMuted, marginBottom: 10 }}>Recalcula multas, scores e classificação PERDA (normalmente roda automaticamente às 00:00).</Text>
          <Button title="Rodar rotina agora" icon="⚙️" variant="secondary" onPress={() => http.post('/jobs/daily/run').then(() => toast('Rotina executada')).catch((e) => toast(e.message, 'error'))} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp: configuração, status, teste, varredura
// ---------------------------------------------------------------------------

function StatusCard({ reloadKey }: { reloadKey: number }) {
  const { data, error, loading, reload } = useAsync(() => api.messaging.status(), [reloadKey]);
  return (
    <Card title="📡 Status do envio" style={{ marginBottom: 12 }} right={<Button size="sm" variant="ghost" icon="↻" title="Atualizar" onPress={() => void reload()} />} testID="wa-status">
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          <View style={styles.badges}>
            <Badge text={data.queue === 'BULLMQ' ? '🟢 Fila BullMQ (Redis) ativa' : '🟡 Sem Redis: processamento em memória'} bg={data.queue === 'BULLMQ' ? '#064E3B' : '#713F12'} color="#FFF" />
            {data.jobs ? Object.entries(data.jobs).map(([k, v]) => <Badge key={k} text={`${k}: ${v}`} bg={colors.surface2} />) : null}
          </View>
          <View style={styles.badges}>
            {Object.keys(MESSAGE_STATUS_LABEL).map((s) => (
              <View key={s} style={styles.count}>
                <MessageStatusBadge status={s} />
                <Text style={styles.countN}>{data.byStatus[s as keyof typeof data.byStatus] ?? 0}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
}

function ReadOnlyConfig({ cfg }: { cfg: WhatsAppConfigDTO }) {
  return (
    <Card title="💬 Configuração do WhatsApp" style={{ marginBottom: 12 }} testID="wa-config-readonly">
      <Notice tone="info" text="Somente o dono altera a configuração do WhatsApp. Você está vendo em modo leitura." />
      <View style={styles.kvRow}>
        <KV k="Envio automático" v={cfg.enabled ? 'Ativado' : 'Desativado'} />
        <KV k="Provedor" v={WA_PROVIDER_LABEL[cfg.provider] ?? cfg.provider} />
        {cfg.provider === 'EVOLUTION' ? <KV k="URL / instância" v={`${cfg.baseUrl || '—'} · ${cfg.instance || '—'}`} /> : null}
        {cfg.provider === 'EVOLUTION' ? <KV k="API key" v={cfg.hasApiKey ? 'configurada' : 'não configurada'} /> : null}
        {cfg.provider === 'META' ? <KV k="Phone number ID" v={cfg.metaPhoneNumberId || '—'} /> : null}
        {cfg.provider === 'META' ? <KV k="Token" v={cfg.hasMetaToken ? 'configurado' : 'não configurado'} /> : null}
        <KV k="Janela de envio" v={`${cfg.windowStart} às ${cfg.windowEnd}`} />
        <KV k="Horário da varredura" v={cfg.sendTime} />
        <KV k="Aviso de pagamento" v={cfg.autoPaymentOk ? 'Sim' : 'Não'} />
        <KV k="Fiador no D+7" v={cfg.notifyGuarantorD7 ? 'Sim' : 'Não'} />
        <KV k="Blacklist" v={cfg.blacklist.length ? cfg.blacklist.map((p) => formatPhone(p)).join(', ') : 'vazia'} />
      </View>
    </Card>
  );
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const maskTime = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
};

function ConfigForm({ cfg, onSaved }: { cfg: WhatsAppConfigDTO; onSaved: (c: WhatsAppConfigDTO) => void }) {
  const toast = useToast();
  const { isDesktop } = useLayout();
  const [f, setF] = useState(cfg);
  const [apiKey, setApiKey] = useState('');
  const [metaToken, setMetaToken] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [clearToken, setClearToken] = useState(false);
  const [bl, setBl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setF(cfg), [cfg]);
  const set = <K extends keyof WhatsAppConfigDTO>(k: K, v: WhatsAppConfigDTO[K]) => setF((x) => ({ ...x, [k]: v }));

  const addBl = () => {
    const d = bl.replace(/\D/g, '');
    if (d.length < 10) return setErr('Telefone da blacklist inválido');
    setErr(null);
    if (!f.blacklist.includes(d)) set('blacklist', [...f.blacklist, d]);
    setBl('');
  };

  const save = async () => {
    for (const [k, label] of [['windowStart', 'Início da janela'], ['windowEnd', 'Fim da janela'], ['sendTime', 'Horário de envio']] as const) {
      if (!HHMM.test(f[k])) return setErr(`${label}: use HH:MM`);
    }
    if (f.baseUrl && !/^https?:\/\/.+/i.test(f.baseUrl)) return setErr('URL da Evolution API inválida (http://... ou https://...)');
    const body: WhatsAppConfigBody = {
      enabled: f.enabled, provider: f.provider, baseUrl: f.baseUrl.trim(), instance: f.instance.trim(), metaPhoneNumberId: f.metaPhoneNumberId.trim(),
      windowStart: f.windowStart, windowEnd: f.windowEnd, sendTime: f.sendTime, autoPaymentOk: f.autoPaymentOk, notifyGuarantorD7: f.notifyGuarantorD7, blacklist: f.blacklist,
    };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    else if (clearKey) body.apiKey = null;
    if (metaToken.trim()) body.metaToken = metaToken.trim();
    else if (clearToken) body.metaToken = null;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.messaging.saveConfig(body);
      setApiKey(''); setMetaToken(''); setClearKey(false); setClearToken(false);
      onSaved(r);
      toast('Configuração do WhatsApp salva');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const secretHint = (has: boolean, clear: boolean, onClear: () => void, label: string) =>
    has ? (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <Text style={{ color: clear ? '#FCA5A5' : colors.success, fontSize: 12, fontWeight: '700' }}>{clear ? `${label} será removida ao salvar` : `✓ ${label} configurada - deixe vazio para manter`}</Text>
        <Pressable onPress={onClear}><Text style={{ color: colors.info, fontSize: 12, fontWeight: '700' }}>{clear ? 'desfazer' : 'remover'}</Text></Pressable>
      </View>
    ) : (
      `${label} não configurada`
    );

  return (
    <Card title="💬 Configuração do WhatsApp" style={{ marginBottom: 12 }} testID="wa-config">
      <Checkbox testID="wa-enabled" checked={f.enabled} onChange={(v) => set('enabled', v)} label="Envio automático ativado (lembretes D-2, D0, D+1, D+3, D+7 e confirmação de pagamento)" />
      <Select<WaProvider> testID="wa-provider" label="Provedor" value={f.provider} onChange={(v) => v && set('provider', v)} options={(['EVOLUTION', 'META', 'LINK'] as const).map((p) => ({ value: p, label: WA_PROVIDER_LABEL[p] }))} style={{ marginTop: 8 }} />
      {f.provider === 'LINK' ? <Notice tone="info" text="Modo manual: nenhuma mensagem é enviada sozinha. O sistema gera links wa.me para você enviar com 1 clique pelo histórico de mensagens." /> : null}
      {f.provider === 'EVOLUTION' ? (
        <Stack row={isDesktop} style={styles.row}>
          <Input testID="wa-baseurl" label="URL da Evolution API" value={f.baseUrl} onChangeText={(v) => set('baseUrl', v)} placeholder="https://evolution.seudominio.com" autoCapitalize="none" style={{ flex: 2 }} />
          <Input testID="wa-instance" label="Instância" value={f.instance} onChangeText={(v) => set('instance', v)} placeholder="lendcontrol" autoCapitalize="none" style={{ flex: 1 }} />
          <Input testID="wa-apikey" label="API key" secure value={apiKey} onChangeText={(v) => { setApiKey(v); setClearKey(false); }} placeholder={cfg.hasApiKey ? '•••••••• (configurada)' : 'Cole a API key'} autoCapitalize="none" style={{ flex: 1.5 }} hint={secretHint(cfg.hasApiKey, clearKey, () => setClearKey(!clearKey), 'API key')} />
        </Stack>
      ) : null}
      {f.provider === 'META' ? (
        <Stack row={isDesktop} style={styles.row}>
          <Input testID="wa-meta-id" label="Phone number ID (Meta)" value={f.metaPhoneNumberId} onChangeText={(v) => set('metaPhoneNumberId', v.replace(/\D/g, ''))} placeholder="123456789012345" style={{ flex: 1 }} />
          <Input testID="wa-meta-token" label="Token de acesso (Meta)" secure value={metaToken} onChangeText={(v) => { setMetaToken(v); setClearToken(false); }} placeholder={cfg.hasMetaToken ? '•••••••• (configurado)' : 'Cole o token permanente'} autoCapitalize="none" style={{ flex: 2 }} hint={secretHint(cfg.hasMetaToken, clearToken, () => setClearToken(!clearToken), 'Token')} />
        </Stack>
      ) : null}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Input testID="wa-window-start" label="Janela início" value={f.windowStart} onChangeText={(v) => set('windowStart', maskTime(v))} placeholder="08:00" keyboardType="number-pad" style={styles.time} />
        <Input testID="wa-window-end" label="Janela fim" value={f.windowEnd} onChangeText={(v) => set('windowEnd', maskTime(v))} placeholder="20:00" keyboardType="number-pad" style={styles.time} />
        <Input testID="wa-send-time" label="Horário de envio" value={f.sendTime} onChangeText={(v) => set('sendTime', maskTime(v))} placeholder="09:00" keyboardType="number-pad" style={styles.time} />
      </View>
      <Checkbox testID="wa-auto-payment" checked={f.autoPaymentOk} onChange={(v) => set('autoPaymentOk', v)} label="Enviar 'Pagamento confirmado' quando um pagamento é aprovado" />
      <Checkbox testID="wa-guarantor-d7" checked={f.notifyGuarantorD7} onChange={(v) => set('notifyGuarantorD7', v)} label="Avisar o fiador no 7º dia de atraso" />

      <Text style={[styles.sub, { marginTop: 14 }]}>BLACKLIST (nunca recebem mensagens automáticas)</Text>
      <View style={[styles.row, { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <Input testID="wa-bl-input" mask="phone" value={bl} onChangeText={setBl} placeholder="(21) 99999-9999" onSubmitEditing={addBl} style={{ flex: 1 }} />
        <Button testID="wa-bl-add" title="Adicionar" icon="➕" variant="secondary" onPress={addBl} style={{ minHeight: 46 }} />
      </View>
      <View style={styles.badges}>
        {f.blacklist.length === 0 ? <Text style={{ color: colors.textDim, fontWeight: '600' }}>Nenhum telefone bloqueado</Text> : null}
        {f.blacklist.map((p) => (
          <View key={p} style={styles.blItem}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{formatPhone(p)}</Text>
            <Pressable testID={`wa-bl-remove-${p}`} accessibilityLabel={`Remover ${p}`} hitSlop={8} onPress={() => set('blacklist', f.blacklist.filter((x) => x !== p))}>
              <Text style={{ color: '#FCA5A5', fontWeight: '900' }}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
      <InlineError message={err} />
      <Button testID="wa-save" title="Salvar configuração" icon="💾" variant="success" loading={busy} onPress={() => void save()} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
    </Card>
  );
}

function TestAndScan({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const { isDesktop } = useLayout();
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('Teste de mensagem do LendControl Pro ✅');
  const [busy, setBusy] = useState<'test' | 'scan' | null>(null);
  const [last, setLast] = useState<{ status: string; waLink: string | null; lastError: string | null } | null>(null);

  const test = async () => {
    if (phone.replace(/\D/g, '').length < 10) return toast('Informe um telefone válido', 'error');
    setBusy('test');
    try {
      const r = await api.messaging.test(phone, text);
      setLast(r);
      toast(r.status === 'ENVIADO' ? 'Mensagem de teste enviada' : `Teste: ${MESSAGE_STATUS_LABEL[r.status] ?? r.status}${r.lastError ? ` - ${r.lastError}` : ''}`, r.status === 'ENVIADO' ? 'success' : 'info');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const scan = async () => {
    setBusy('scan');
    try {
      const r = await api.messaging.scan();
      toast(`Varredura de ${r.asOf}: ${r.created} mensagem(ns) gerada(s)`);
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Stack row={isDesktop} style={{ marginBottom: 12 }}>
      <Card title="🧪 Enviar teste" style={{ flex: 1 }}>
        <Input testID="wa-test-phone" label="Telefone" mask="phone" value={phone} onChangeText={setPhone} placeholder="(21) 99999-9999" />
        <Input testID="wa-test-text" label="Mensagem" value={text} onChangeText={setText} multiline rows={2} maxLength={1000} />
        <View style={styles.badges}>
          <Button testID="wa-test-send" title="Enviar teste" icon="📤" loading={busy === 'test'} onPress={() => void test()} />
          {last?.waLink ? <Button size="sm" variant="success" icon="💬" title="Abrir wa.me" onPress={() => void Linking.openURL(last.waLink!)} /> : null}
          {last ? <MessageStatusBadge status={last.status} /> : null}
        </View>
        {last?.lastError ? <Text style={{ color: '#FCA5A5', fontSize: 12, fontWeight: '700' }}>⚠ {last.lastError}</Text> : null}
      </Card>
      <Card title="🔎 Varredura de vencimentos" style={{ flex: 1 }}>
        <Text style={{ color: colors.textMuted, marginBottom: 10, fontWeight: '600' }}>Gera os avisos do dia (D-2, D0, D+1, D+3, D+7 e fiador). Roda sozinha todo dia no horário de envio; mensagens repetidas no mesmo dia não são geradas de novo.</Text>
        <Button testID="wa-scan" title="Rodar varredura agora" icon="🔎" variant="secondary" loading={busy === 'scan'} onPress={() => void scan()} style={{ alignSelf: 'flex-start' }} />
      </Card>
    </Stack>
  );
}

function WhatsAppTab() {
  const { hasRole } = useAuth();
  const owner = hasRole('SUPER_ADMIN');
  const { data, error, loading, reload, setData } = useAsync(() => api.messaging.config(), []);
  const [k, setK] = useState(0);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <>
      <StatusCard reloadKey={k} />
      {owner ? <ConfigForm cfg={data} onSaved={(c) => { setData(c); setK((x) => x + 1); }} /> : <ReadOnlyConfig cfg={data} />}
      {owner ? <TestAndScan onDone={() => setK((x) => x + 1)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplateEditor({ t, editable, onSaved }: { t: MessageTemplateDTO; editable: boolean; onSaved: (list: MessageTemplateDTO[]) => void }) {
  const toast = useToast();
  const [text, setText] = useState(t.text);
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  useEffect(() => setText(t.text), [t.text]);
  const used = new Set(Array.from(text.matchAll(/\{(\w+)\}/g)).map((m) => m[1]));
  const unknown = [...used].filter((v) => !(TEMPLATE_VARS as readonly string[]).includes(v));
  const save = async (value: string | null) => {
    setBusy(value === null ? 'reset' : 'save');
    try {
      onSaved(await api.messaging.saveTemplate(t.key, value));
      toast(value === null ? `"${t.label}" restaurado para o padrão` : `Template "${t.label}" salvo`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card testID={`tpl-card-${t.key}`} title={t.label} style={{ marginBottom: 12 }} right={<Badge size="sm" text={t.isDefault ? 'Padrão' : 'Personalizado'} bg={t.isDefault ? colors.surface2 : '#1E3A8A'} color={t.isDefault ? colors.text : '#BFDBFE'} />}>
      <Text style={styles.when}>Enviado {t.when}</Text>
      {editable ? (
        <Input testID={`tpl-${t.key}`} value={text} onChangeText={setText} multiline rows={5} maxLength={1000} hint={unknown.length ? `⚠ Variável desconhecida: ${unknown.map((u) => `{${u}}`).join(' ')}` : `${text.length}/1000 caracteres`} />
      ) : (
        <Text style={styles.tplText}>{t.text}</Text>
      )}
      <View style={styles.vars}>
        <Text style={styles.varsLabel}>Variáveis:</Text>
        {TEMPLATE_VARS.map((v) => (
          <Pressable key={v} disabled={!editable} onPress={() => setText((x) => `${x}${x.endsWith(' ') || !x ? '' : ' '}{${v}}`)}>
            <Text style={[styles.var, used.has(v) && styles.varOn]}>{`{${v}}`}</Text>
          </Pressable>
        ))}
      </View>
      {editable ? (
        <View style={styles.badges}>
          <Button testID={`tpl-save-${t.key}`} size="sm" title="Salvar" icon="💾" variant="success" disabled={text.trim() === t.text || !text.trim()} loading={busy === 'save'} onPress={() => void save(text)} />
          <Button testID={`tpl-reset-${t.key}`} size="sm" title="Restaurar padrão" icon="↺" variant="secondary" disabled={t.isDefault} loading={busy === 'reset'} onPress={() => void save(null)} />
        </View>
      ) : null}
    </Card>
  );
}

function TemplatesTab() {
  const { hasRole } = useAuth();
  const editable = hasRole('SUPER_ADMIN');
  const { data, error, loading, reload, setData } = useAsync(() => api.messaging.templates(), []);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data?.length) return <Empty text="Nenhum template" icon="📝" />;
  return (
    <>
      <Notice tone="info" text={editable ? 'Toque numa variável para inseri-la no fim do texto. "Restaurar padrão" volta ao texto original do sistema.' : 'Somente o dono edita os templates. Você está vendo em modo leitura.'} />
      <View style={{ height: 8 }} />
      {data.map((t) => (
        <TemplateEditor key={t.key} t={t} editable={editable} onSaved={setData} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function Settings() {
  const { hasRole } = useAuth();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const isAdmin = hasRole('ADMIN', 'SUPER_ADMIN');
  const isOwner = hasRole('SUPER_ADMIN');
  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'perfil', label: 'Meu perfil', icon: '👤' },
    ...(isAdmin ? [{ key: 'whatsapp' as const, label: 'WhatsApp', icon: '💬' }, { key: 'templates' as const, label: 'Templates', icon: '📝' }] : []),
    { key: 'mensagens', label: 'Mensagens', icon: '📨' },
    ...(isOwner ? [{ key: 'backup' as const, label: 'Backup', icon: '🗂️' }] : []),
  ];
  const initial = tabs.find((t) => t.key === tabParam)?.key ?? 'perfil';
  const [tab, setTab] = useState<TabKey>(initial);
  useEffect(() => {
    if (tabParam && tabs.some((t) => t.key === tabParam)) setTab(tabParam as TabKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  return (
    <Screen title="Configurações" maxWidth={1100}>
      <View style={{ marginBottom: 14 }}>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </View>
      {tab === 'perfil' ? <ProfileTab /> : null}
      {tab === 'whatsapp' && isAdmin ? <WhatsAppTab /> : null}
      {tab === 'templates' && isAdmin ? <TemplatesTab /> : null}
      {tab === 'mensagens' ? (
        <Card title="📨 Histórico de mensagens WhatsApp" testID="messages-card">
          <MessageLogList />
        </Card>
      ) : null}
      {tab === 'backup' && isOwner ? <BackupPanel /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  time: { flexGrow: 1, flexBasis: 120, minWidth: 100 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  countN: { color: colors.text, fontWeight: '900', fontSize: 16 },
  kvRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 22 },
  sub: { color: colors.label, fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  blItem: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.borderStrong },
  when: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  tplText: { color: colors.text, fontSize: 14, backgroundColor: colors.bg, borderRadius: 8, padding: 10, marginBottom: 8 },
  vars: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10 },
  varsLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800' },
  var: { color: colors.textMuted, fontSize: 12, fontWeight: '700', fontFamily: 'monospace', backgroundColor: colors.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  varOn: { color: '#BFDBFE', backgroundColor: '#1E3A8A' },
});
