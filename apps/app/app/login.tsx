import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { errorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { Button, InlineError, Input } from '@/components/ui';
import { getApiUrl, isServerConfigured, normalizeApiUrl, probeApiUrl, saveApiUrl, SERVER_EDITABLE } from '@/config';
import { clearCache } from '@/offline/cache';
import { colors } from '@/theme';

export default function Login() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // servidor (só no app nativo)
  const [apiUrl, setApiUrlState] = useState(getApiUrl());
  const [editing, setEditing] = useState(false);
  const [server, setServer] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [serverOk, setServerOk] = useState<string | null>(null);

  // o servidor salvo no aparelho é lido junto com a sessão (AuthProvider)
  useEffect(() => {
    if (!loading) setApiUrlState(getApiUrl());
  }, [loading]);

  if (!loading && user) return <Redirect href="/" />;

  const needServer = SERVER_EDITABLE && !loading && !isServerConfigured();
  const showServerForm = SERVER_EDITABLE && (editing || needServer);

  const submit = async () => {
    if (showServerForm) return setErr('Salve o endereço do servidor antes de entrar');
    if (!email || !password) return setErr('Informe e-mail e senha');
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openServer = () => {
    setServer(isServerConfigured() ? apiUrl : '');
    setServerErr(null);
    setServerOk(null);
    setEditing(true);
  };

  const saveServer = async () => {
    const url = normalizeApiUrl(server);
    if (!url) return setServerErr('Endereço inválido. Ex.: 192.168.0.10:3000 ou https://seu-dominio.com/api');
    setServerBusy(true);
    setServerErr(null);
    setServerOk(null);
    const probe = await probeApiUrl(url);
    if (!probe.ok) {
      setServerBusy(false);
      return setServerErr(`${probe.message} (${url})`);
    }
    // outro servidor = outros dados: o cache de leitura do servidor anterior não vale mais
    if (url !== getApiUrl()) await clearCache();
    await saveApiUrl(url);
    setApiUrlState(url);
    setServerBusy(false);
    setServerOk(`Conectado a ${url}`);
    setEditing(false);
    setErr(null);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.logo}>LendControl <Text style={{ color: colors.primary }}>PRO</Text></Text>
          <Text style={styles.ver}>V6.5 · Controle de empréstimos com re-empréstimo</Text>

          {showServerForm ? (
            <View testID="server-form" style={styles.serverBox}>
              <Text style={styles.serverTitle}>Servidor do LendControl</Text>
              <Text style={styles.serverHelp}>
                Informe o endereço do servidor onde o sistema está instalado. Na mesma rede Wi-Fi use o IP do computador (ex.: 192.168.0.10:3000); na internet, o seu domínio (ex.: https://seu-dominio.com).
              </Text>
              <Input testID="server-url" label="Endereço do servidor" value={server} onChangeText={setServer} placeholder="192.168.0.10:3000" keyboardType="url" autoCapitalize="none" onSubmitEditing={saveServer} />
              <InlineError message={serverErr} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button testID="server-save" title="Testar e salvar" loading={serverBusy} onPress={saveServer} style={{ flex: 1 }} />
                {isServerConfigured() ? <Button title="Cancelar" variant="ghost" onPress={() => setEditing(false)} /> : null}
              </View>
            </View>
          ) : (
            <>
              {serverOk ? <Text testID="server-ok" style={styles.ok}>{serverOk}</Text> : null}
              <Input testID="login-email" label="E-mail" required value={email} onChangeText={setEmail} placeholder="seu@email.com" keyboardType="email-address" autoCapitalize="none" autoFocus={Platform.OS === 'web'} />
              <Input testID="login-password" label="Senha" required value={password} onChangeText={setPassword} secure placeholder="Sua senha" onSubmitEditing={submit} autoCapitalize="none" />
              <InlineError message={err} />
              <Button testID="login-submit" title="Entrar" size="lg" loading={busy} onPress={submit} full style={{ marginTop: 6 }} />
            </>
          )}

          {SERVER_EDITABLE && !showServerForm ? (
            <Pressable testID="server-change" onPress={openServer} style={styles.serverLink} accessibilityRole="button">
              <Text style={styles.api}>Servidor: {apiUrl}</Text>
              <Text style={styles.change}>Alterar servidor</Text>
            </Pressable>
          ) : !SERVER_EDITABLE ? (
            <Text style={styles.api}>API: {apiUrl}</Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 28 },
  logo: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  ver: { color: colors.textMuted, textAlign: 'center', marginBottom: 24, marginTop: 4, fontWeight: '600' },
  api: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 16 },
  serverBox: { gap: 4 },
  serverTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  serverHelp: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  serverLink: { alignItems: 'center' },
  change: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 4, paddingVertical: 6 },
  ok: { color: colors.success, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
});
