import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

export interface TabDef<K extends string | number> {
  key: K;
  label: string;
  icon?: string;
  error?: boolean;
  badge?: string | number;
}

export function Tabs<K extends string | number>({ tabs, active, onChange }: { tabs: TabDef<K>[]; active: K; onChange: (k: K) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Pressable key={String(t.key)} testID={`tab-${t.key}`} onPress={() => onChange(t.key)} style={[styles.tab, on && styles.tabOn, t.error && styles.tabErr]}>
            {t.icon ? <Text style={styles.icon}>{t.icon}</Text> : null}
            <Text style={[styles.label, on && { color: '#FFFFFF' }, t.error && { color: '#FCA5A5' }]}>{t.label}</Text>
            {t.error ? <View style={styles.dot} /> : null}
            {t.badge != null ? <Text style={styles.badge}>{t.badge}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 6, paddingBottom: 2 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.primaryDark, borderColor: colors.primary },
  tabErr: { borderColor: colors.danger },
  icon: { fontSize: 16 },
  label: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  badge: { color: colors.text, backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 6, fontSize: 12, fontWeight: '800' },
});
