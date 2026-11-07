import React, { useState } from 'react';
import { Image, Linking, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { brDateToISO, isoToBR, todayISO } from '@lendcontrol/core';
import { api } from '../api';
import { errorMessage } from '../api/http';
import type { ClientDocumentDTO, ClientReceiptDTO, DocumentType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { colors, radius } from '../theme';
import { absoluteUrl, openFile, pickFile, uploadFile, type PickedFile } from '../utils/files';
import { brl, dateBR, dateTimeBR, DOC_STATUS_COLOR, DOCUMENT_TYPES, PAYMENT_TYPE_LABEL, APPROVAL_LABEL } from '../utils/format';
import { PromptModal } from './PromptModal';
import { useToast } from './Toast';
import { Badge, Button, Card, Empty, ErrorState, Field, Grid, InlineError, Input, Loading, Modal, MoneyInput, Notice, Select } from './ui';

const docIcon = (t: string) => DOCUMENT_TYPES.find((d) => d.value === t)?.icon ?? '📄';
const isImage = (mime: string | null | undefined) => !!mime && mime.startsWith('image/') && mime !== 'image/heic';

function useCols() {
  const { width } = useWindowDimensions();
  return width < 640 ? 1 : width < 1024 ? 2 : width < 1360 ? 3 : 4;
}

/** Botão de anexar: abre o seletor, faz upload privado e devolve o id do arquivo. */
function FilePickButton({ testID, picked, onPicked, onError }: { testID: string; picked: { id: string; file: PickedFile } | null; onPicked: (v: { id: string; file: PickedFile } | null) => void; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const pick = async (camera = false) => {
    onError(null);
    try {
      const f = await pickFile('imageOrPdf', camera);
      if (!f) return;
      setBusy(true);
      const up = await uploadFile(f);
      onPicked({ id: up.id, file: f });
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.pick} testID={testID}>
      {picked?.file.previewUri ? <Image source={{ uri: picked.file.previewUri }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.thumbPh]}><Text style={{ fontSize: 24 }}>{picked ? '📄' : '📎'}</Text></View>}
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
        <Text style={{ color: picked ? colors.success : colors.textMuted, fontWeight: '700' }} numberOfLines={2}>{picked ? `✓ ${picked.file.name}` : 'Nenhum arquivo selecionado (imagem ou PDF, até 10 MB)'}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" icon="📎" title={picked ? 'Trocar arquivo' : 'Escolher arquivo'} loading={busy} onPress={() => void pick(false)} />
          {Platform.OS !== 'web' ? <Button size="sm" variant="secondary" icon="📸" title="Câmera" onPress={() => void pick(true)} /> : null}
        </View>
      </View>
    </View>
  );
}

function DocCard({ d, isAdmin, onView, onVerify, onDelete, busy }: { d: ClientDocumentDTO; isAdmin: boolean; onView: () => void; onVerify: (v: boolean) => void; onDelete: () => void; busy: boolean }) {
  const st = DOC_STATUS_COLOR[d.status] ?? DOC_STATUS_COLOR.PENDENTE;
  return (
    <View testID={`doc-${d.id}`} style={[styles.tile, { borderTopColor: st.bg }]}>
      <View style={styles.tileHead}>
        <Text style={{ fontSize: 26 }}>{docIcon(d.type)}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.tileTitle} numberOfLines={2}>{d.label}</Text>
          <Text style={styles.tileSub} numberOfLines={1}>{d.originalName ?? d.mimeType ?? ''}</Text>
        </View>
      </View>
      <View style={styles.badges}>
        <Badge testID={`doc-status-${d.id}`} size="sm" text={st.label} bg={st.bg} color={st.color} />
        <Badge size="sm" text={`👁 ${d.views} visualizaç${d.views === 1 ? 'ão' : 'ões'}`} bg={colors.surface2} />
      </View>
      <Text style={styles.tileSub}>Enviado em {dateTimeBR(d.createdAt)}</Text>
      {d.expiryDate ? <Text style={[styles.tileSub, d.status === 'VENCIDO' && { color: '#FCA5A5' }]}>Validade: {dateBR(d.expiryDate)}</Text> : null}
      {d.verifiedAt ? <Text style={styles.tileSub}>Verificado em {dateTimeBR(d.verifiedAt)}</Text> : null}
      {d.notes ? <Text style={styles.notes} numberOfLines={3}>{d.notes}</Text> : null}
      <View style={styles.tileActions}>
        <Button testID={`doc-view-${d.id}`} size="sm" variant="secondary" icon="👁" title="Ver" onPress={onView} />
        {isAdmin && !d.isVerified ? <Button testID={`doc-verify-${d.id}`} size="sm" variant="success" icon="✓" title="Verificar" loading={busy} onPress={() => onVerify(true)} /> : null}
        {isAdmin && d.isVerified ? <Button size="sm" variant="ghost" title="Desfazer verificação" loading={busy} onPress={() => onVerify(false)} /> : null}
        {isAdmin ? <Button testID={`doc-delete-${d.id}`} size="sm" variant="ghost" icon="🗑" title="Excluir" onPress={onDelete} /> : null}
      </View>
    </View>
  );
}

function ReceiptCard({ r, isAdmin, onView, onCheck, busy }: { r: ClientReceiptDTO; isAdmin: boolean; onView: () => void; onCheck: () => void; busy: boolean }) {
  const ok = r.status === 'CONFERIDO';
  return (
    <View testID={`receipt-${r.id}`} style={[styles.tile, { borderTopColor: ok ? colors.successDark : '#D97706' }]}>
      <View style={styles.tileHead}>
        <Text style={{ fontSize: 26 }}>🧾</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.tileTitle}>{r.informedValueCents != null ? brl(r.informedValueCents) : 'Valor não informado'}</Text>
          <Text style={styles.tileSub}>Enviado pelo cliente em {dateBR(r.sentAt)}</Text>
        </View>
      </View>
      <View style={styles.badges}>
        <Badge size="sm" text={ok ? '✓ Conferido' : '⏳ Aguardando conferência'} bg={ok ? '#059669' : '#D97706'} color="#FFFFFF" />
      </View>
      {r.payment ? (
        <Text testID={`receipt-linked-${r.id}`} style={styles.linked}>
          🔗 Vinculado ao pagamento do empréstimo #{r.payment.loanCode} · {PAYMENT_TYPE_LABEL[r.payment.type] ?? r.payment.type} {brl(r.payment.valueCents)} · {APPROVAL_LABEL[r.payment.status] ?? r.payment.status}
        </Text>
      ) : (
        <Text style={styles.tileSub}>Sem pagamento vinculado</Text>
      )}
      {r.checkedAt ? <Text style={styles.tileSub}>Conferido em {dateTimeBR(r.checkedAt)}</Text> : null}
      {r.notes ? <Text style={styles.notes} numberOfLines={3}>{r.notes}</Text> : null}
      <View style={styles.tileActions}>
        <Button size="sm" variant="secondary" icon="👁" title="Ver" onPress={onView} />
        {isAdmin && !ok ? <Button testID={`receipt-check-${r.id}`} size="sm" variant="success" icon="✓" title="Conferir" loading={busy} onPress={onCheck} /> : null}
      </View>
    </View>
  );
}

/** Galeria de documentos do cliente + comprovantes enviados pelo cliente (Fase 2). */
export function ClientDocuments({ clientId }: { clientId: string }) {
  const toast = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN', 'SUPER_ADMIN');
  const cols = useCols();
  const { height } = useWindowDimensions();
  const docs = useAsync(() => api.documents.list(clientId), [clientId]);
  const recs = useAsync(() => api.receipts.list(clientId), [clientId]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Upload de documento
  const [docOpen, setDocOpen] = useState(false);
  const [dType, setDType] = useState<DocumentType | null>(null);
  const [dFile, setDFile] = useState<{ id: string; file: PickedFile } | null>(null);
  const [dExpiry, setDExpiry] = useState('');
  const [dNotes, setDNotes] = useState('');
  const [dErr, setDErr] = useState<string | null>(null);
  const [dBusy, setDBusy] = useState(false);

  // Comprovante do cliente
  const [recOpen, setRecOpen] = useState(false);
  const [rFile, setRFile] = useState<{ id: string; file: PickedFile } | null>(null);
  const [rDate, setRDate] = useState('');
  const [rValue, setRValue] = useState<number | null>(null);
  const [rNotes, setRNotes] = useState('');
  const [rErr, setRErr] = useState<string | null>(null);
  const [rBusy, setRBusy] = useState(false);

  const [viewer, setViewer] = useState<{ title: string; url: string; image: boolean; expiresAt: string } | null>(null);
  const [toDelete, setToDelete] = useState<ClientDocumentDTO | null>(null);

  const openDocModal = () => {
    setDType(null); setDFile(null); setDExpiry(''); setDNotes(''); setDErr(null);
    setDocOpen(true);
  };
  const openRecModal = () => {
    setRFile(null); setRDate(isoToBR(todayISO())); setRValue(null); setRNotes(''); setRErr(null);
    setRecOpen(true);
  };

  const submitDoc = async () => {
    if (!dType) return setDErr('Escolha o tipo de documento');
    if (!dFile) return setDErr('Anexe o arquivo do documento');
    let expiry: string | null = null;
    if (dExpiry.trim()) {
      expiry = brDateToISO(dExpiry.trim());
      if (!expiry) return setDErr('Validade inválida (use dd/mm/aaaa)');
    }
    setDBusy(true);
    setDErr(null);
    try {
      await api.documents.create(clientId, { type: dType, fileId: dFile.id, expiryDate: expiry, notes: dNotes.trim() || null });
      toast('Documento enviado - aguardando verificação');
      setDocOpen(false);
      await docs.reload();
    } catch (e) {
      setDErr(errorMessage(e));
    } finally {
      setDBusy(false);
    }
  };

  const submitReceipt = async () => {
    if (!rFile) return setRErr('Anexe o comprovante que o cliente enviou');
    const sent = brDateToISO(rDate.trim());
    if (!sent) return setRErr('Data de envio inválida (use dd/mm/aaaa)');
    setRBusy(true);
    setRErr(null);
    try {
      const r = await api.receipts.create(clientId, { fileId: rFile.id, sentAt: sent, informedValueCents: rValue, notes: rNotes.trim() || null });
      toast(r.autoLinked && r.payment ? `Comprovante anexado e vinculado ao pagamento pendente do empréstimo #${r.payment.loanCode}` : 'Comprovante anexado - aguardando conferência');
      setRecOpen(false);
      await recs.reload();
    } catch (e) {
      setRErr(errorMessage(e));
    } finally {
      setRBusy(false);
    }
  };

  const viewDoc = async (d: ClientDocumentDTO) => {
    try {
      const s = await api.documents.url(d.id);
      const url = absoluteUrl(s.url);
      if (isImage(d.mimeType)) setViewer({ title: `${docIcon(d.type)} ${d.label}`, url, image: true, expiresAt: s.expiresAt });
      else if (Platform.OS === 'web') (globalThis as any).open?.(url, '_blank', 'noopener');
      else await Linking.openURL(url);
      // contador de visualizações
      docs.setData((l) => (l ?? []).map((x) => (x.id === d.id ? { ...x, views: x.views + 1 } : x)));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const verify = async (d: ClientDocumentDTO, v: boolean) => {
    setBusyId(d.id);
    try {
      const n = await api.documents.update(d.id, { isVerified: v });
      docs.setData((l) => (l ?? []).map((x) => (x.id === d.id ? n : x)));
      toast(v ? 'Documento verificado' : 'Verificação removida');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const check = async (r: ClientReceiptDTO) => {
    setBusyId(r.id);
    try {
      const n = await api.receipts.check(r.id, r.payment?.id ?? null);
      recs.setData((l) => (l ?? []).map((x) => (x.id === r.id ? n : x)));
      toast('Comprovante conferido');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const docList = docs.data ?? [];
  const counts = { v: docList.filter((d) => d.status === 'VERIFICADO').length, p: docList.filter((d) => d.status === 'PENDENTE').length, x: docList.filter((d) => d.status === 'VENCIDO').length };

  return (
    <View testID="client-documents">
      <Card
        title={`📁 Documentos (${docList.length})`}
        style={{ marginBottom: 12 }}
        right={<Button testID="doc-add" title="Enviar documento" icon="➕" onPress={openDocModal} />}
      >
        {docList.length ? (
          <View style={styles.badges}>
            <Badge size="sm" text={`${counts.v} verificado(s)`} bg="#059669" color="#FFF" />
            <Badge size="sm" text={`${counts.p} pendente(s)`} bg="#D97706" color="#FFF" />
            {counts.x ? <Badge size="sm" text={`${counts.x} vencido(s)`} bg="#B91C1C" color="#FFF" /> : null}
          </View>
        ) : null}
        {docs.error ? <ErrorState message={docs.error} onRetry={docs.reload} /> : null}
        {docs.loading && !docs.data ? <Loading /> : null}
        {docs.data && docList.length === 0 ? <Empty text="Nenhum documento anexado (RG, CPF, comprovantes, contrato...)" icon="📁" /> : null}
        {docList.length ? (
          <Grid cols={cols}>
            {docList.map((d) => (
              <DocCard key={d.id} d={d} isAdmin={isAdmin} busy={busyId === d.id} onView={() => void viewDoc(d)} onVerify={(v) => void verify(d, v)} onDelete={() => setToDelete(d)} />
            ))}
          </Grid>
        ) : null}
        <Text style={styles.foot}>🔒 Visualização com marca d'água do usuário, link assinado de 5 minutos e registro de acesso (LGPD).</Text>
      </Card>

      <Card
        title={`🧾 Comprovantes do cliente (${recs.data?.length ?? 0})`}
        right={<Button testID="creceipt-add" title="📎 Anexar Comprovante que Cliente Enviou" variant="warning" onPress={openRecModal} />}
      >
        {recs.error ? <ErrorState message={recs.error} onRetry={recs.reload} /> : null}
        {recs.loading && !recs.data ? <Loading /> : null}
        {recs.data && recs.data.length === 0 ? <Empty text="Nenhum comprovante enviado pelo cliente" icon="🧾" /> : null}
        {recs.data?.length ? (
          <Grid cols={cols}>
            {recs.data.map((r) => (
              <ReceiptCard key={r.id} r={r} isAdmin={isAdmin} busy={busyId === r.id} onCheck={() => void check(r)} onView={() => openFile(r.fileId).catch((e) => toast(errorMessage(e), 'error'))} />
            ))}
          </Grid>
        ) : null}
        <Text style={styles.foot}>Se houver exatamente um pagamento aguardando aprovação deste cliente, o comprovante é vinculado a ele automaticamente.</Text>
      </Card>

      <Modal testID="doc-modal" visible={docOpen} title="📁 Enviar documento" onClose={() => setDocOpen(false)} width={560}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setDocOpen(false)} /><Button testID="doc-submit" title="Enviar" variant="success" loading={dBusy} onPress={() => void submitDoc()} /></>}>
        <Select testID="doc-type" label="Tipo de documento" required value={dType} onChange={setDType} options={DOCUMENT_TYPES.map((t) => ({ value: t.value as DocumentType, label: `${t.icon} ${t.label}` }))} />
        <Field label="Arquivo" required>
          <FilePickButton testID="doc-file" picked={dFile} onPicked={setDFile} onError={setDErr} />
        </Field>
        <Input testID="doc-expiry" label="Validade (opcional)" mask="date" value={dExpiry} onChangeText={setDExpiry} placeholder="dd/mm/aaaa" hint="Após a validade o documento aparece como VENCIDO" />
        <Input testID="doc-notes" label="Observações" value={dNotes} onChangeText={setDNotes} placeholder="Opcional" multiline rows={2} maxLength={500} />
        <InlineError message={dErr} />
      </Modal>

      <Modal testID="creceipt-modal" visible={recOpen} title="📎 Comprovante enviado pelo cliente" onClose={() => setRecOpen(false)} width={560}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setRecOpen(false)} /><Button testID="creceipt-submit" title="Anexar" variant="success" loading={rBusy} onPress={() => void submitReceipt()} /></>}>
        <Notice tone="info" text="Use para guardar o comprovante que o cliente mandou pelo WhatsApp. Para lançar o pagamento, use 'Lançar recibo' no empréstimo." />
        <Field label="Comprovante" required>
          <FilePickButton testID="creceipt-file" picked={rFile} onPicked={setRFile} onError={setRErr} />
        </Field>
        <Input testID="creceipt-date" label="Data em que o cliente enviou" required mask="date" value={rDate} onChangeText={setRDate} placeholder="dd/mm/aaaa" />
        <MoneyInput testID="creceipt-value" label="Valor informado (opcional)" value={rValue} onChange={setRValue} />
        <Input label="Observações" value={rNotes} onChangeText={setRNotes} placeholder="Opcional" multiline rows={2} maxLength={500} />
        <InlineError message={rErr} />
      </Modal>

      <Modal testID="doc-viewer" visible={!!viewer} title={viewer?.title ?? ''} onClose={() => setViewer(null)} width={900}
        footer={<><Button title="Abrir em nova aba" variant="secondary" icon="↗" onPress={() => viewer && ((globalThis as any).open ? (globalThis as any).open(viewer.url, '_blank', 'noopener') : Linking.openURL(viewer.url))} /><Button title="Fechar" onPress={() => setViewer(null)} /></>}>
        {viewer?.image ? (
          <Image testID="doc-image" source={{ uri: viewer.url }} style={{ width: '100%', height: Math.max(240, Math.min(height * 0.62, 680)), borderRadius: radius.md, backgroundColor: '#020617' }} resizeMode="contain" />
        ) : null}
        <Text style={[styles.foot, { marginTop: 10 }]}>Imagem com marca d'água do visualizador. Link expira às {viewer ? dateTimeBR(viewer.expiresAt).slice(11) : ''}.</Text>
      </Modal>

      <PromptModal
        visible={!!toDelete}
        title="🗑 Excluir documento"
        tone="danger"
        description={toDelete ? `Excluir "${toDelete.label}" deste cliente? A exclusão fica registrada na auditoria.` : ''}
        confirmLabel="Excluir"
        confirmVariant="danger"
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await api.documents.remove(toDelete.id);
          docs.setData((l) => (l ?? []).filter((x) => x.id !== toDelete.id));
          setToDelete(null);
          toast('Documento excluído');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, padding: 12, gap: 6, flexGrow: 1 },
  tileHead: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  tileTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  tileSub: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  notes: { color: colors.text, fontSize: 13, fontStyle: 'italic' },
  linked: { color: '#93C5FD', fontSize: 12, fontWeight: '700' },
  tileActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  foot: { color: colors.textDim, fontSize: 12, fontWeight: '600', marginTop: 4 },
  pick: { flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'dashed', borderRadius: 10, padding: 10 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  thumbPh: { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
