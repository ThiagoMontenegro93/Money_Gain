import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius } from '../../theme';

export function Card({ title, right, children, style, accent, testID }: { title?: string; right?: React.ReactNode; children?: React.ReactNode; style?: StyleProp<ViewStyle>; accent?: string; testID?: string }) {
  return (
    <View testID={testID} style={[styles.card, accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null, style]}>
      {(title || right) && (
        <View style={styles.head}>
          {title ? <Text style={styles.title}>{title}</Text> : <View />}
          {right ? <View style={{ flexShrink: 1, maxWidth: '100%' }}>{right}</View> : null}
        </View>
      )}
      {children}
    </View>
  );
}

/** Seção com borda e título em caixa alta (ficha do cliente). */
export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  section: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, padding: 16, marginBottom: 16, backgroundColor: 'rgba(15,23,42,0.4)' },
  sectionTitle: { color: colors.label, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
});
