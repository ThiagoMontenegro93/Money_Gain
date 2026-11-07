import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import { errorMessage } from '@/api/http';
import type { BackupDTO, RestorePreview, RestoreResult } from '@/api/types';
import { PromptModal } from '@/components/PromptModal';
import { useToast } from '@/components/Toast';
import { Badge, Button, Card, Checkbox, Empty, ErrorState, InlineError, Input, Loading, Modal, Notice, Stack } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { colors } from '@/theme';
import { brl, dateBR, dateTimeBR, PAYMENT_TYPE_LABEL } from '@/utils/format';
import { downloadBlob, pickWeb, type PickedFile } from '@/utils/files';

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// ----------------------------------------------------------------- e-mail
function EmailSettings({ smtpConfigured }: { smtpConfigured: boolean }) {
  const toast = useToast();
  const { isDesktop } = useLayout();
  const { data, error, loading, reload } = useAsync(() => api.backups.settings(), []);
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [extra, setExtra] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setEmail(data.email);
    setExtra(data.extraEmails.join(', '));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const extras = extra.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
  const validate = () => {
    if (enabled && !email.trim()) return 'Informe o e-mail que vai receber o backup';
    if (email.trim() && !isEmail(email)) return 'E-mail inválido';
    const bad = extras.find((e) => !isEmail(e));
    if (bad) return `E-mail adicional inválido: ${bad}`;
    return null;
  };
  const save = async () => {
    const v = validate();
    setErr(v);
    setSaved(false);
    if (v) return;
    setBusy('save');
    try {
      await api.backups.saveSettings({ enabled, email: email.trim(), extraEmails: extras });
      setSaved(true);
      toast('E-mail de backup salvo');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy('test');
    try {
      const b = await api.backups.testEmail();
      toast(`Backup enviado para ${b.emailSentTo}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="📧 Backup Automático por e-mail" testID="backup-email-card">
      <Text style={styles.dim}>Toda segunda-feira às 08:00 o sistema gera a planilha e envia para os e-mails abaixo.</Text>
      {!smtpConfigured ? <Notice tone="warning" text="O servidor de e-mail (SMTP) ainda não foi configurado no servidor. O backup continua sendo gerado e fica disponível para baixar." /> : null}
      <View style={{ height: 10 }} />
      <Checkbox testID="backup-email-enabled" checked={enabled} onChange={setEnabled} label="Ativar envio automático toda segunda 08:00" />
      <Stack row={isDesktop} gap={12} style={{ marginTop: 10 }}>
        <Input testID="backup-email" label="E-mail para receber o backup" value={email} onChangeText={setEmail} placeholder="seuemail@exemplo.com" keyboardType="email-address" autoCapitalize="none" style={{ flex: 1 }} />
        <Input testID="backup-extra" label="E-mails adicionais (separados por vírgula)" value={extra} onChangeText={setExtra} placeholder="contador@exemplo.com, socio@exemplo.com" autoCapitalize="none" style={{ flex: 1 }} />
      </Stack>
      <InlineError message={err} />
      {saved ? <Text testID="backup-email-saved" style={{ color: colors.success, fontWeight: '800', marginBottom: 8 }}>✅ E-mail de backup salvo</Text> : null}
      <View style={styles.btns}>
        <Button testID="backup-email-save" title="Salvar Configurações" icon="💾" loading={busy === 'save'} onPress={save} />
        <Button testID="backup-email-test" title="Testar envio agora" icon="📤" variant="secondary" loading={busy === 'test'} disabled={!data?.email && !email} onPress={test} />
      </View>
    </Card>
  );
}

// --------------------------------------------------------------- histórico
function History({ items, onChanged }: { items: BackupDTO[]; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [encFor, setEncFor] = useState<BackupDTO | null>(null);
  const [encPass, setEncPass] = useState('');
  const [encPass2, setEncPass2] = useState('');
  const [encErr, setEncErr] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const create = () =>
    run('create', async () => {
      await api.backups.create();
      toast('Backup gerado');
      onChanged();
    });
  const exportEnc = async () => {
    if (!encFor) return;
    if (encPass.length < 8) return setEncErr('A senha do arquivo precisa de ao menos 8 caracteres');
    if (encPass !== encPass2) return setEncErr('As senhas não conferem');
    setEncErr(null);
    await run('enc', async () => {
      downloadBlob(await api.backups.encrypted(encFor.id, encPass), encFor.fileName.replace(/\.xlsx$/, '.lcbak'));
      setEncFor(null);
      setEncPass('');
      setEncPass2('');
      toast('Backup criptografado baixado. Guarde a senha: sem ela o arquivo não abre.');
    });
  };

  return (
    <Card title="🗂️ Últimos 10 backups" testID="backup-history" right={<Button testID="backup-create" size="sm" icon="➕" title="Gerar backup agora" loading={busy === 'create'} onPress={create} />}>
      {!items.length ? (
        <Empty icon="🗂️" text="Nenhum backup ainda. O primeiro sai na próxima segunda 08:00, ou gere agora." />
      ) : (
        items.map((b) => (
          <View key={b.id} style={styles.item} testID={`backup-row-${b.id}`}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Text style={styles.name} numberOfLines={1}>{dateTimeBR(b.createdAt)} · {size(b.sizeBytes)}</Text>
              <Text style={styles.dim} numberOfLines={2}>
                {b.totalClientes} clientes · {b.totalEmprestimos} empréstimos · {b.totalParcelas} parcelas
                {b.emailSentTo ? ` · enviado para ${b.emailSentTo}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <Badge size="sm" text={b.isAutomatic ? 'Automático' : 'Manual'} bg={b.isAutomatic ? '#1E3A8A' : colors.surface2} />
                {b.fileName.includes('antes-da-restauracao') ? <Badge size="sm" text="Antes da restauração" bg="#78350F" color="#FDE68A" /> : null}
                {!b.available ? <Badge size="sm" text="Arquivo indisponível" bg="#7F1D1D" /> : null}
              </View>
            </View>
            <View style={styles.btns}>
              <Button testID={`backup-download-${b.id}`} size="sm" icon="⬇️" title="Baixar" disabled={!b.available} loading={busy === `dl-${b.id}`} onPress={() => run(`dl-${b.id}`, async () => downloadBlob(await api.backups.download(b.id), b.fileName))} />
              <Button testID={`backup-enc-${b.id}`} size="sm" variant="secondary" icon="🔒" title="Criptografado" disabled={!b.available} onPress={() => setEncFor(b)} />
              <Button testID={`backup-send-${b.id}`} size="sm" variant="secondary" icon="📧" title="Enviar" disabled={!b.available} loading={busy === `em-${b.id}`} onPress={() => run(`em-${b.id}`, async () => { const r = await api.backups.email(b.id); toast(`Enviado para ${r.emailSentTo}`); onChanged(); })} />
            </View>
          </View>
        ))
      )}
      <Modal visible={!!encFor} title="🔒 Exportar Backup Criptografado" onClose={() => setEncFor(null)} width={480} testID="backup-enc-modal"
        footer={<View style={styles.btns}><Button title="Cancelar" variant="secondary" onPress={() => setEncFor(null)} /><Button testID="backup-enc-confirm" title="Baixar criptografado" icon="🔒" loading={busy === 'enc'} onPress={exportEnc} /></View>}>
        <Text style={styles.dim}>O arquivo .lcbak só abre com esta senha (AES-256). Use para guardar o backup fora do sistema com segurança.</Text>
        <Input testID="backup-enc-pass" label="Senha do arquivo" value={encPass} onChangeText={setEncPass} secure />
        <Input testID="backup-enc-pass2" label="Repita a senha" value={encPass2} onChangeText={setEncPass2} secure />
        <InlineError message={encErr} />
      </Modal>
    </Card>
  );
}

// -------------------------------------------------------------- restauração
function DropZone({ onFile, file }: { onFile: (f: PickedFile) => void; file: PickedFile | null }) {
  const ref = useRef<View>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const prevent = (e: Event) => {
      e.preventDefault();
      setOver(e.type === 'dragover' || e.type === 'dragenter');
    };
    const drop = (e: Event) => {
      e.preventDefault();
      setOver(false);
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) onFile({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, file: f });
    };
    ['dragenter', 'dragover', 'dragleave'].forEach((t) => el.addEventListener(t, prevent));
    el.addEventListener('drop', drop);
    return () => {
      ['dragenter', 'dragover', 'dragleave'].forEach((t) => el.removeEventListener(t, prevent));
      el.removeEventListener('drop', drop);
    };
  }, [onFile]);
  const pick = async () => {
    const f = await pickWeb('.xlsx,.lcbak,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (f) onFile(f);
  };
  return (
    <Pressable ref={ref} testID="restore-drop" onPress={pick} style={[styles.drop, over && styles.dropOver]}>
      <Text style={{ fontSize: 30 }}>📥</Text>
      <Text style={styles.dropText}>{file ? file.name : 'Arraste Excel de backup aqui ou clique para selecionar'}</Text>
      <Text style={styles.dim}>{file ? size(file.size ?? 0) : '.xlsx gerado pelo LendControl ou .lcbak criptografado'}</Text>
    </Pressable>
  );
}

function Restore({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [filePass, setFilePass] = useState('');
  const [prev, setPrev] = useState<RestorePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const encrypted = !!file?.name.toLowerCase().endsWith('.lcbak');

  const choose = (f: PickedFile) => {
    setFile(f);
    setPrev(null);
    setErr(null);
    setResult(null);
  };
  const validate = async () => {
    if (!file?.file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file.file, file.name);
      if (filePass) form.append('filePassword', filePass);
      setPrev(await api.backups.preview(form));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async ({ password }: { password: string }) => {
    const r = await api.backups.restore(prev!.token!, password);
    setResult(r);
    setPrev(null);
    setFile(null);
    setConfirm(false);
    toast(r.message.replace(/^✅ /, ''));
    onDone();
  };

  return (
    <Card title="♻️ Restaurar backup" testID="restore-card">
      {Platform.OS !== 'web' ? <Notice tone="info" text="A restauração é feita pelo computador (versão web)." /> : null}
      <DropZone file={file} onFile={choose} />
      {encrypted ? <Input testID="restore-file-pass" label="Senha do backup criptografado" value={filePass} onChangeText={setFilePass} secure /> : null}
      <InlineError message={err} />
      {prev?.summary ? (
        <Text testID="restore-summary" style={[styles.name, { marginTop: 10 }]}>{prev.summary}</Text>
      ) : null}
      {prev && !prev.valid ? (
        <View testID="restore-errors" style={{ marginTop: 10 }}>
          <Notice tone="danger" text={<View>{prev.errors.map((e) => <Text key={e} style={{ color: '#FEE2E2', fontWeight: '600' }}>❌ {e}</Text>)}</View>} />
        </View>
      ) : null}
      {prev?.valid ? (
        <View testID="restore-distribution" style={{ marginTop: 10, gap: 4 }}>
          <Text style={styles.sub}>DISTRIBUINDO (SEM PREJUÍZO)</Text>
          {prev.distribution.map((d) => <Text key={d} style={styles.line}>✅ {d}</Text>)}
          {prev.offlinePayments.length ? (
            <>
              <Text style={[styles.sub, { marginTop: 8 }]}>PAGAMENTOS LANÇADOS NA PLANILHA</Text>
              {prev.offlinePayments.map((p) => (
                <Text key={p.row} style={styles.line}>🧾 Empréstimo {p.loanCode}: {PAYMENT_TYPE_LABEL[p.type] ?? p.type} {brl(p.amountCents)} em {dateBR(p.paidAt)} → entra como recibo aguardando aprovação</Text>
              ))}
            </>
          ) : null}
          {prev.warnings.map((w) => <Text key={w} style={[styles.line, { color: colors.warning }]}>⚠️ {w}</Text>)}
        </View>
      ) : null}
      {result ? (
        <View testID="restore-result" style={{ marginTop: 10, gap: 4 }}>
          <Notice tone="success" text={result.message} />
          {result.offlinePaymentsCreated.map((t) => <Text key={t} style={styles.line}>🧾 {t}</Text>)}
          {result.offlinePaymentsSkipped.map((t) => <Text key={t} style={[styles.line, { color: colors.warning }]}>⚠️ {t}</Text>)}
        </View>
      ) : null}
      <View style={[styles.btns, { marginTop: 12 }]}>
        <Button testID="restore-validate" title="Validar Planilha" icon="🔍" variant="secondary" disabled={!file} loading={busy} onPress={validate} />
        <Button testID="restore-now" title="Restaurar Agora" icon="♻️" variant="danger" disabled={!prev?.valid} onPress={() => setConfirm(true)} />
      </View>
      <PromptModal
        visible={confirm}
        title="Isso vai sobrescrever dados atuais?"
        tone="danger"
        description="Todos os dados atuais serão substituídos pelos da planilha. Por segurança, o sistema gera um backup do estado atual antes de restaurar (recomendado). Confirme com a senha do Super Admin."
        askPassword
        confirmLabel="Restaurar agora"
        confirmVariant="danger"
        onClose={() => setConfirm(false)}
        onConfirm={restore}
      />
    </Card>
  );
}

export function BackupPanel() {
  const { data, error, loading, reload } = useAsync(() => api.backups.list(), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <View style={{ gap: 14 }}>
      <EmailSettings smtpConfigured={!!data?.smtpConfigured} />
      <History items={data?.backups ?? []} onChanged={reload} />
      <Restore onDone={reload} />
      <Card title="📜 Log de restaurações" testID="restore-log">
        {!data?.restores.length ? (
          <Empty icon="📜" text="Nenhuma restauração feita" />
        ) : (
          data.restores.map((r) => (
            <View key={r.id} style={styles.item}>
              <Text style={[styles.name, { flex: 1 }]}>{dateTimeBR(r.createdAt)} · {r.fileName}</Text>
              <Text style={styles.dim}>{r.createdBy ?? '—'} · {r.totalClientes} clientes · {r.totalEmprestimos} empréstimos</Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { color: colors.textMuted, fontSize: 13 },
  name: { color: colors.text, fontWeight: '800', fontSize: 14 },
  sub: { color: colors.label, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  line: { color: colors.text, fontSize: 13 },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  item: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: 14, padding: 22, alignItems: 'center', gap: 6, backgroundColor: colors.bg },
  dropOver: { borderColor: colors.primary, backgroundColor: '#172554' },
  dropText: { color: colors.text, fontWeight: '800', fontSize: 15, textAlign: 'center' },
});
