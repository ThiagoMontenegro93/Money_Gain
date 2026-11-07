import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLayout } from '../hooks/useLayout';
import { colors } from '../theme';

/** Container padrão das telas: título, ações e conteúdo rolável. */
export function Screen({ title, subtitle, actions, children, onRefresh, refreshing, maxWidth = 1600, footer }: { title?: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; maxWidth?: number; footer?: React.ReactNode }) {
  const { isDesktop } = useLayout();
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { padding: isDesktop ? 24 : 12 }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: '100%', maxWidth, alignSelf: 'center' }}>
          {(title || actions) && (
            <View style={styles.head}>
              <View style={{ flexShrink: 1 }}>
                {title ? <Text style={[styles.title, !isDesktop && { fontSize: 20 }]}>{title}</Text> : null}
                {subtitle ? typeof subtitle === 'string' ? <Text style={styles.sub}>{subtitle}</Text> : subtitle : null}
              </View>
              {actions ? <View style={styles.actions}>{actions}</View> : null}
            </View>
          )}
          {children}
        </View>
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: 4, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 1, maxWidth: '100%' },
});
