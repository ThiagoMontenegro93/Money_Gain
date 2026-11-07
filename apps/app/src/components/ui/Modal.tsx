import React from 'react';
import { Modal as RNModal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, radius } from '../../theme';

export type ModalTone = 'default' | 'warning' | 'danger' | 'success';

const TONES: Record<ModalTone, { head: string; border: string; text: string }> = {
  default: { head: colors.surface2, border: colors.border, text: colors.text },
  warning: { head: '#FBBF24', border: '#F59E0B', text: '#451A03' },
  danger: { head: '#B91C1C', border: '#EF4444', text: '#FFFFFF' },
  success: { head: '#059669', border: '#10B981', text: '#FFFFFF' },
};

export function Modal({ visible, title, onClose, children, footer, tone = 'default', width = 640, testID }: { visible: boolean; title: string; onClose: () => void; children?: React.ReactNode; footer?: React.ReactNode; tone?: ModalTone; width?: number; testID?: string }) {
  const { height, width: w } = useWindowDimensions();
  const t = TONES[tone];
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View testID={testID} style={[styles.box, { width: Math.min(width, w - 24), maxHeight: height - 40, borderColor: t.border }]}>
          <View style={[styles.head, { backgroundColor: t.head }]}>
            <Text style={[styles.title, { color: t.text }]}>{title}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Fechar" hitSlop={10}>
              <Text style={[styles.close, { color: t.text }]}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 18 }}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.75)', alignItems: 'center', justifyContent: 'center' },
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, gap: 12 },
  title: { fontSize: 17, fontWeight: '800', flex: 1 },
  close: { fontSize: 18, fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: colors.border },
});
