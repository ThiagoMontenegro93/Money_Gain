import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { errorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { Button, InlineError, Input } from '@/components/ui';
import { API_URL } from '@/config';
import { colors } from '@/theme';

export default function Login() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!loading && user) return <Redirect href="/" />;

  const submit = async () => {
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.logo}>LendControl <Text style={{ color: colors.primary }}>PRO</Text></Text>
        <Text style={styles.ver}>V6.5 · Controle de empréstimos com re-empréstimo</Text>
        <Input testID="login-email" label="E-mail" required value={email} onChangeText={setEmail} placeholder="seu@email.com" keyboardType="email-address" autoCapitalize="none" autoFocus />
        <Input testID="login-password" label="Senha" required value={password} onChangeText={setPassword} secure placeholder="Sua senha" onSubmitEditing={submit} autoCapitalize="none" />
        <InlineError message={err} />
        <Button testID="login-submit" title="Entrar" size="lg" loading={busy} onPress={submit} full style={{ marginTop: 6 }} />
        <Text style={styles.api}>API: {API_URL}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 28 },
  logo: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  ver: { color: colors.textMuted, textAlign: 'center', marginBottom: 24, marginTop: 4, fontWeight: '600' },
  api: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 16 },
});
