import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '@/api';
import { errorMessage } from '@/api/http';
import type { Role, TransferType, UserDTO } from '@/api/types';
import { ROLE_LABEL, useAuth } from '@/auth/AuthContext';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { TransferList } from '@/components/TransferList';
import { Badge, Button, Card, Checkbox, Column, Empty, ErrorState, Grid, InlineError, Input, Loading, Modal, MoneyInput, Segmented, Select, StatCard, Table, Stack } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLayout } from '@/hooks/useLayout';
import { colors } from '@/theme';
import { brl, dateTimeBR, decimalText, parseDecimal, TRANSFER_LABEL } from '@/utils/format';
import { formatPhone } from '@lendcontrol/core';

interface TransferIntent {
  type: TransferType;
  to?: UserDTO;
  max?: number;
}

function WalletCards({ u, cols }: { u: UserDTO; cols: number }) {
  const w = u.wallet;
  return (
    <Grid cols={cols}>
      <StatCard label="Capital disponível" value={brl(w.capitalDisponivelCents)} color="#60A5FA" icon="💵" />
      <StatCard label="Emprestado" value={brl(w.capitalEmprestadoCents)} color="#38BDF8" icon="💰" />
      <StatCard label="Recebido de clientes" value={brl(w.recebidoClientesCents)} color={colors.success} icon="📥" />
      <StatCard label="Para repassar p/ dono" value={brl(w.paraRepassarCents)} color={colors.warning} icon="↩️" />
      <StatCard label="Comissão a pagar" value={brl(w.comissaoAPagarCents)} color="#F472B6" icon="💼" sub={`${u.commissionPercent}% sobre juros`} />
    </Grid>
  );
}

function Ledger({ userId }: { userId?: string }) {
  const { isDesktop } = useLayout();
  const { data, error, loading, reload } = useAsync(() => api.ledger(userId), [userId]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!isDesktop) {
    if (!data?.length) return <Empty text="Sem movimentações no razão" icon="📒" />;
    return (
      <View testID="ledger">
        {data.map((e) => (
          <View key={e.id} style={styles.lrow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{e.description || e.type}</Text>
              <Text style={{ color: colors.textDim, fontSize: 12 }}>{dateTimeBR(e.createdAt)} · {e.type}</Text>
            </View>
            <Text style={{ color: e.amountCents < 0 ? '#FCA5A5' : '#6EE7B7', fontWeight: '800' }}>{brl(e.amountCents)}</Text>
          </View>
        ))}
      </View>
    );
  }
  const cols: Column<NonNullable<typeof data>[number]>[] = [
    { key: 'date', title: 'Data', width: 150, render: (e) => dateTimeBR(e.createdAt) },
    { key: 'type', title: 'Tipo', width: 200, render: (e) => e.type },
    { key: 'desc', title: 'Descrição', flex: 2, render: (e) => e.description },
    { key: 'val', title: 'Valor', width: 140, align: 'right', render: (e) => <Text style={{ color: e.amountCents < 0 ? '#FCA5A5' : '#6EE7B7', fontWeight: '800', fontSize: 13 }}>{brl(e.amountCents)}</Text> },
  ];
  return <Table testID="ledger" columns={cols} rows={data ?? []} keyOf={(e) => e.id} minWidth={720} empty={<Empty text="Sem movimentações no razão" icon="📒" />} />;
}

function UsersList({ users, meId, onEdit }: { users: UserDTO[]; meId?: string; onEdit: (u: UserDTO) => void }) {
  const { isDesktop } = useLayout();
  const status = (u: UserDTO) => (u.isActive ? <Badge size="sm" text="Ativo" bg="#064E3B" color="#A7F3D0" /> : <Badge size="sm" text="Inativo" bg="#374151" />);
  if (!isDesktop) {
    return (
      <View testID="users-list">
        {users.map((u) => (
          <View key={u.id} style={styles.lrow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{u.name}{u.id === meId ? ' (você)' : ''}</Text>
              <Text style={{ color: colors.textDim, fontSize: 12 }} numberOfLines={1}>{ROLE_LABEL[u.role]} · {u.commissionPercent}% · {u.email}</Text>
            </View>
            {status(u)}
            <Button testID={`user-row-edit-${u.id}`} size="sm" variant="secondary" icon="✏️" title="Editar" onPress={() => onEdit(u)} />
          </View>
        ))}
      </View>
    );
  }
  const cols: Column<UserDTO>[] = [
    { key: 'name', title: 'Nome', flex: 2, render: (u) => `${u.name}${u.id === meId ? ' (você)' : ''}` },
    { key: 'email', title: 'E-mail', flex: 2, render: (u) => u.email },
    { key: 'role', title: 'Papel', width: 130, render: (u) => ROLE_LABEL[u.role] },
    { key: 'pix', title: 'PIX', flex: 1, render: (u) => u.pixKey || '—' },
    { key: 'com', title: 'Comissão', width: 100, align: 'right', render: (u) => `${decimalText(u.commissionPercent)}%` },
    { key: 'st', title: 'Status', width: 90, render: status },
    { key: 'act', title: '', width: 100, align: 'right', render: (u) => <Button testID={`user-row-edit-${u.id}`} size="sm" variant="secondary" icon="✏️" title="Editar" onPress={() => onEdit(u)} /> },
  ];
  return <Table testID="users-list" columns={cols} rows={users} keyOf={(u) => u.id} minWidth={760} />;
}

export default function Team() {
  const { user, hasRole, refreshMe } = useAuth();
  const toast = useToast();
  const { isDesktop, isWide } = useLayout();
  const isOwner = hasRole('SUPER_ADMIN');
  const isAdmin = hasRole('ADMIN', 'SUPER_ADMIN');
  const { data: wallets, error, loading, reload } = useAsync(() => api.wallets(), []);
  const { data: transfers, reload: reloadT } = useAsync(() => api.transfers.list(), []);
  const [ledgerUser, setLedgerUser] = useState<string | null>(null);
  const [intent, setIntent] = useState<TransferIntent | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [nu, setNu] = useState({ name: '', email: '', password: '', phone: '', role: 'OPERATOR' as Role, commission: '30', revolving: true });
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<UserDTO | null>(null);
  const [eu, setEu] = useState({ name: '', phone: '', pixKey: '', role: 'OPERATOR' as Role, commission: '', revolving: true, isActive: true });
  const [eBusy, setEBusy] = useState(false);
  const [eErr, setEErr] = useState<string | null>(null);
  const { data: allUsers, reload: reloadUsers } = useAsync(() => (isOwner ? api.users.list() : Promise.resolve([] as UserDTO[])), [isOwner]);

  const cols = isWide ? 5 : isDesktop ? 3 : 2;
  const me = wallets?.find((w) => w.id === user?.id) ?? user ?? null;

  const openTransfer = (t: TransferIntent) => {
    setIntent(t);
    setValue(t.max && t.type !== 'REPASSE_CAPITAL' ? t.max : null);
    setNotes('');
    setTErr(null);
  };

  const submitTransfer = async () => {
    if (!intent) return;
    if (!value || value <= 0) return setTErr('Informe o valor');
    if (intent.max != null && intent.type !== 'REPASSE_CAPITAL' && value > intent.max) return setTErr(`Valor máximo: ${brl(intent.max)}`);
    setTBusy(true);
    setTErr(null);
    try {
      const r = await api.transfers.create({ type: intent.type, valueCents: value, ...(intent.to ? { toUserId: intent.to.id } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      toast(r.status === 'APROVADO' ? 'Transferência registrada' : 'Repasse enviado - aguardando aprovação do dono');
      setIntent(null);
      await Promise.all([reload(), reloadT(), refreshMe()]);
    } catch (e) {
      setTErr(errorMessage(e));
    } finally {
      setTBusy(false);
    }
  };

  const createUser = async () => {
    if (!nu.name.trim() || !nu.email.trim() || nu.password.length < 8) return setCErr('Informe nome, e-mail e senha (mínimo 8 caracteres)');
    setCBusy(true);
    setCErr(null);
    try {
      await api.users.create({ name: nu.name.trim(), email: nu.email.trim(), password: nu.password, role: nu.role, ...(nu.phone ? { phone: nu.phone } : {}), commissionPercent: parseDecimal(nu.commission) ?? 0, revolving: nu.revolving });
      toast('Funcionário criado');
      setCreateOpen(false);
      setNu({ name: '', email: '', password: '', phone: '', role: 'OPERATOR', commission: '30', revolving: true });
      await reload();
    } catch (e) {
      setCErr(errorMessage(e));
    } finally {
      setCBusy(false);
    }
  };

  const openEdit = (u: UserDTO) => {
    setEu({ name: u.name, phone: u.phone ? formatPhone(u.phone) : '', pixKey: u.pixKey ?? '', role: u.role, commission: decimalText(u.commissionPercent), revolving: u.revolving, isActive: u.isActive });
    setEErr(null);
    setEdit(u);
  };

  const saveEdit = async () => {
    if (!edit) return;
    if (eu.name.trim().length < 2) return setEErr('Informe o nome');
    const pct = parseDecimal(eu.commission);
    if (pct == null || pct < 0 || pct > 100) return setEErr('Comissão deve estar entre 0 e 100%');
    setEBusy(true);
    setEErr(null);
    try {
      await api.users.update(edit.id, { name: eu.name.trim(), phone: eu.phone.trim() || null, pixKey: eu.pixKey.trim() || null, role: eu.role, commissionPercent: pct, revolving: eu.revolving, isActive: eu.isActive });
      toast('Usuário atualizado');
      setEdit(null);
      await Promise.all([reload(), reloadUsers(), edit.id === user?.id ? refreshMe() : Promise.resolve()]);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setEErr(errorMessage(e));
    } finally {
      setEBusy(false);
    }
  };

  const employees = (wallets ?? []).filter((w) => (isAdmin ? w.id !== user?.id || w.role === 'OPERATOR' : true));

  return (
    <Screen
      title={isAdmin ? 'Equipe / Carteira' : 'Minha Carteira'}
      subtitle={isAdmin ? 'Re-empréstimo: o dono repassa capital, o funcionário empresta, cobra e repassa o lucro.' : 'Seu capital, o que recebeu de clientes e o que precisa repassar ao dono.'}
      onRefresh={() => { void reload(); void reloadT(); }}
      refreshing={loading && !!wallets}
      actions={isOwner ? <Button testID="new-user" title="Novo Funcionário" icon="➕" onPress={() => { setCErr(null); setCreateOpen(true); }} /> : undefined}
    >
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !wallets ? <Loading /> : null}

      {!isAdmin && me ? (
        <Card title={`💼 Carteira de ${me.name}`} style={{ marginBottom: 12 }}
          right={
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button testID="repasse-lucro" title="Repassar para Dono" icon="↩️" variant="warning" disabled={!me.wallet.paraRepassarCents} onPress={() => openTransfer({ type: 'REPASSE_LUCRO', max: me.wallet.paraRepassarCents })} />
              <Button title="Devolver capital" icon="🏦" variant="secondary" disabled={!me.wallet.capitalDisponivelCents} onPress={() => openTransfer({ type: 'DEVOLUCAO_CAPITAL', max: me.wallet.capitalDisponivelCents })} />
            </View>
          }>
          <WalletCards u={me} cols={cols} />
          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Modo {me.revolving ? 'revolving: o principal recebido volta para seu capital disponível para re-emprestar.' : 'sem revolving: o principal recebido vai para repasse ao dono.'}</Text>
        </Card>
      ) : null}

      {isAdmin && wallets ? (
        <>
          {employees.length === 0 ? <Empty text="Nenhum funcionário cadastrado" icon="🧑‍💼" /> : null}
          {employees.map((u) => (
            <Card
              key={u.id}
              testID={`wallet-${u.id}`}
              title={`${u.name} · ${ROLE_LABEL[u.role]}`}
              style={{ marginBottom: 12 }}
              accent={u.isActive ? colors.primary : colors.textDim}
              right={
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Badge text={`Comissão ${u.commissionPercent}%`} bg={colors.surface2} />
                  {u.revolving ? <Badge text="Revolving" bg="#1E3A8A" color="#BFDBFE" /> : null}
                  {!u.isActive ? <Badge text="Inativo" bg="#374151" /> : null}
                  {isOwner ? <Button size="sm" title="Repassar Capital" icon="💸" onPress={() => openTransfer({ type: 'REPASSE_CAPITAL', to: u })} /> : null}
                  {isOwner ? <Button size="sm" title="Pagar Comissão" icon="💼" variant="secondary" disabled={!u.wallet.comissaoAPagarCents} onPress={() => openTransfer({ type: 'PAGAMENTO_COMISSAO', to: u, max: u.wallet.comissaoAPagarCents })} /> : null}
                  <Button size="sm" title="Extrato" icon="📒" variant="ghost" onPress={() => setLedgerUser(u.id)} />
                  {isOwner ? <Button testID={`edit-user-${u.id}`} size="sm" title="Editar" icon="✏️" variant="secondary" onPress={() => openEdit(u)} /> : null}
                </View>
              }
            >
              <Text style={{ color: colors.textMuted, marginBottom: 10, fontWeight: '600' }}>{u.email}{u.phone ? ` · ${u.phone}` : ''}</Text>
              <WalletCards u={u} cols={cols} />
            </Card>
          ))}
        </>
      ) : null}

      {isOwner && allUsers?.length ? (
        <Card title="👥 Usuários do sistema" style={{ marginBottom: 12, padding: isDesktop ? 16 : 10 }} testID="users-card">
          <UsersList users={allUsers} meId={user?.id} onEdit={openEdit} />
        </Card>
      ) : null}

      <Card title="↔️ Repasses" style={{ marginBottom: 12 }}>
        <TransferList transfers={transfers ?? []} />
      </Card>

      <Card
        title="📒 Extrato do razão"
        right={isAdmin ? <Select value={ledgerUser} onChange={setLedgerUser} allowEmpty placeholder="Geral / meu" options={(wallets ?? []).map((u) => ({ value: u.id, label: u.name }))} style={{ minWidth: 220, marginBottom: 0 }} /> : undefined}
        style={{ padding: isDesktop ? 16 : 10 }}
      >
        <Ledger userId={ledgerUser ?? undefined} />
      </Card>

      <Modal testID="transfer-modal" visible={!!intent} title={intent ? TRANSFER_LABEL[intent.type] : ''} onClose={() => setIntent(null)} width={520}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setIntent(null)} /><Button testID="transfer-submit" title="Confirmar" variant="success" loading={tBusy} onPress={() => void submitTransfer()} /></>}>
        <Text style={{ color: colors.text, fontWeight: '600', marginBottom: 12 }}>
          {intent?.type === 'REPASSE_CAPITAL' && `Enviar capital para ${intent.to?.name}. Credita o capital disponível na hora.`}
          {intent?.type === 'PAGAMENTO_COMISSAO' && `Pagar comissão de ${intent.to?.name}. Disponível: ${brl(intent.max)}.`}
          {intent?.type === 'REPASSE_LUCRO' && `Repassar ao dono o que você recebeu de clientes. Disponível: ${brl(intent.max)}. Fica aguardando aprovação do dono.`}
          {intent?.type === 'DEVOLUCAO_CAPITAL' && `Devolver capital disponível ao dono. Disponível: ${brl(intent.max)}. Fica aguardando aprovação.`}
        </Text>
        <MoneyInput testID="transfer-value" label="Valor" required big value={value} onChange={setValue} />
        <Input label="Observações" value={notes} onChangeText={setNotes} placeholder="Opcional" />
        <InlineError message={tErr} />
      </Modal>

      <Modal testID="edit-user-modal" visible={!!edit} title={`✏️ Editar ${edit?.name ?? ''}`} onClose={() => setEdit(null)} width={620}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setEdit(null)} /><Button testID="edit-user-submit" title="Salvar" variant="success" loading={eBusy} onPress={() => void saveEdit()} /></>}>
        <Text style={{ color: colors.textMuted, marginBottom: 10, fontWeight: '600' }}>{edit?.email}</Text>
        <Input testID="eu-name" label="Nome" required value={eu.name} onChangeText={(v) => setEu({ ...eu, name: v })} />
        <Stack row={isDesktop} style={styles.row}>
          <Input testID="eu-phone" label="Telefone" mask="phone" value={eu.phone} onChangeText={(v) => setEu({ ...eu, phone: v })} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
          <Input testID="eu-pix" label="Chave PIX" value={eu.pixKey} onChangeText={(v) => setEu({ ...eu, pixKey: v })} placeholder="Opcional" autoCapitalize="none" style={{ flex: 1 }} />
        </Stack>
        <Input testID="eu-commission" label="Comissão % sobre juros" mask="decimal" value={eu.commission} onChangeText={(v) => setEu({ ...eu, commission: v })} />
        <Segmented testIDPrefix="eu-role" label="Papel" value={eu.role} onChange={(v) => setEu({ ...eu, role: v })} options={[{ value: 'OPERATOR', label: 'Funcionário' }, { value: 'ADMIN', label: 'Administrador' }, { value: 'SUPER_ADMIN', label: 'Dono' }]} />
        <Checkbox checked={eu.revolving} onChange={(v) => setEu({ ...eu, revolving: v })} label="Revolving: principal recebido volta para o funcionário re-emprestar" />
        <Checkbox testID="eu-active" checked={eu.isActive} onChange={(v) => setEu({ ...eu, isActive: v })} label={eu.isActive ? 'Ativo (pode entrar no sistema)' : 'Inativo: não consegue mais fazer login'} />
        {edit?.id === user?.id ? <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>Você está editando o seu próprio usuário: não é possível se desativar ou se rebaixar.</Text> : null}
        <InlineError message={eErr} />
      </Modal>

      <Modal testID="user-modal" visible={createOpen} title="➕ Novo Funcionário" onClose={() => setCreateOpen(false)} width={620}
        footer={<><Button title="Cancelar" variant="secondary" onPress={() => setCreateOpen(false)} /><Button testID="user-submit" title="Criar" variant="success" loading={cBusy} onPress={() => void createUser()} /></>}>
        <Input label="Nome" required value={nu.name} onChangeText={(v) => setNu({ ...nu, name: v })} placeholder="Nome do funcionário" />
        <Stack row={isDesktop} style={styles.row}>
          <Input label="E-mail" required value={nu.email} onChangeText={(v) => setNu({ ...nu, email: v })} placeholder="email@exemplo.com" autoCapitalize="none" style={{ flex: 1 }} />
          <Input label="Telefone" mask="phone" value={nu.phone} onChangeText={(v) => setNu({ ...nu, phone: v })} placeholder="(21) 99999-9999" style={{ flex: 1 }} />
        </Stack>
        <Stack row={isDesktop} style={styles.row}>
          <Input label="Senha inicial" required secure value={nu.password} onChangeText={(v) => setNu({ ...nu, password: v })} placeholder="Mínimo 8 caracteres" style={{ flex: 1 }} autoCapitalize="none" />
          <Input label="Comissão % sobre juros" mask="decimal" value={nu.commission} onChangeText={(v) => setNu({ ...nu, commission: v })} style={{ flex: 1 }} />
        </Stack>
        <Segmented label="Papel" value={nu.role} onChange={(v) => setNu({ ...nu, role: v })} options={[{ value: 'OPERATOR', label: 'Funcionário' }, { value: 'ADMIN', label: 'Administrador' }]} />
        <Checkbox checked={nu.revolving} onChange={(v) => setNu({ ...nu, revolving: v })} label="Revolving: principal recebido volta para o funcionário re-emprestar" />
        <InlineError message={cErr} />
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  lrow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
});
