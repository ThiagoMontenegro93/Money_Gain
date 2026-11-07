import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';
import { Button } from './Button';

export function Loading({ text = 'Carregando...' }: { text?: string }) {
  return (
    <View style={styles.box}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.box, styles.err]}>
      <Text style={styles.errTitle}>Não foi possível carregar</Text>
      <Text style={styles.errText}>{message}</Text>
      {onRetry ? <Button title="Tentar novamente" icon="↻" variant="secondary" onPress={onRetry} style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

export function Empty({ text, icon = '📭', children }: { text: string; icon?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.box}>
      <Text style={{ fontSize: 28 }}>{icon}</Text>
      <Text style={styles.text}>{text}</Text>
      {children}
    </View>
  );
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View style={styles.inline}>
      <Text style={styles.inlineText}>⚠ {message}</Text>
    </View>
  );
}

export function Notice({ text, tone = 'info', testID }: { text: React.ReactNode; tone?: 'info' | 'warning' | 'success' | 'danger'; testID?: string }) {
  const c = { info: ['#0C4A6E', '#38BDF8', '#E0F2FE'], warning: ['#451A03', '#F59E0B', '#FEF3C7'], success: ['#064E3B', '#10B981', '#D1FAE5'], danger: ['#450A0A', '#EF4444', '#FEE2E2'] }[tone];
  return (
    <View testID={testID} style={[styles.notice, { backgroundColor: c[0], borderColor: c[1] }]}>
      {typeof text === 'string' ? <Text style={{ color: c[2], fontWeight: '600', fontSize: 14 }}>{text}</Text> : text}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 32, alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { color: colors.textMuted, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  err: { borderWidth: 1, borderColor: colors.danger, borderRadius: 12, backgroundColor: 'rgba(127,29,29,0.25)', margin: 8 },
  errTitle: { color: '#FCA5A5', fontWeight: '800', fontSize: 16 },
  errText: { color: colors.text, fontSize: 14, textAlign: 'center' },
  inline: { backgroundColor: 'rgba(127,29,29,0.35)', borderColor: colors.danger, borderWidth: 1, borderRadius: 8, padding: 10, marginVertical: 8 },
  inlineText: { color: '#FECACA', fontWeight: '700', fontSize: 14 },
  notice: { borderWidth: 1, borderRadius: 10, padding: 12, marginVertical: 6 },
});
