import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '../../theme';

export function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.label}>
      {text.toUpperCase()}
      {required ? <Text style={styles.req}> *</Text> : null}
    </Text>
  );
}

export function Field({ label, required, error, hint, children, style }: { label?: string; required?: boolean; error?: string | null; hint?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Label text={label} required={required} /> : null}
      {children}
      {error ? <Text style={styles.error}>⚠ {error}</Text> : null}
      {!error && hint ? typeof hint === 'string' ? <Text style={styles.hint}>{hint}</Text> : hint : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14, minWidth: 0 },
  label: { color: colors.label, fontSize: 13, fontWeight: '600', letterSpacing: 0.6, marginBottom: 6 },
  req: { color: colors.required, fontWeight: '800' },
  error: { color: '#FCA5A5', fontSize: 12, fontWeight: '700', marginTop: 4 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 4, fontWeight: '600' },
});
