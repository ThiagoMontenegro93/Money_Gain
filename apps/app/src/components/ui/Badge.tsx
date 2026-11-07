import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { ClientScoreClass } from '@lendcontrol/core';
import { classColor, classIcon, colors } from '../../theme';

export function Badge({ text, bg = colors.surface2, color = colors.text, size = 'md', style, border }: { text: string; bg?: string; color?: string; size?: 'sm' | 'md' | 'lg'; style?: StyleProp<ViewStyle>; border?: string }) {
  const fs = size === 'sm' ? 11 : size === 'lg' ? 15 : 12;
  const pad = size === 'sm' ? { paddingHorizontal: 6, paddingVertical: 2 } : size === 'lg' ? { paddingHorizontal: 12, paddingVertical: 6 } : { paddingHorizontal: 8, paddingVertical: 3 };
  return (
    <View style={[styles.badge, pad, { backgroundColor: bg }, border ? { borderWidth: 1, borderColor: border } : null, style]}>
      <Text style={{ color, fontSize: fs, fontWeight: '700' }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function ScoreBadge({ cls, score, size = 'md' }: { cls: ClientScoreClass; score?: number; size?: 'sm' | 'md' | 'lg' }) {
  const label = { BOM: 'BOM', REGULAR: 'REGULAR', RUIM: 'RUIM', PERDA: 'PERDA' }[cls];
  return <Badge size={size} text={`${classIcon[cls]} ${label}${score != null ? ` ${score}/10` : ''}`} bg={classColor[cls]} color="#FFFFFF" />;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  ATIVO: { bg: '#1D4ED8', color: '#FFFFFF' },
  RASCUNHO: { bg: '#64748B', color: '#FFFFFF' },
  INATIVO: { bg: '#374151', color: '#E5E7EB' },
  QUITADO: { bg: '#059669', color: '#FFFFFF' },
  PERDA: { bg: '#111827', color: '#FCA5A5' },
  CANCELADO: { bg: '#374151', color: '#E5E7EB' },
  AGUARDANDO_APROVACAO: { bg: '#B45309', color: '#FFFFFF' },
  APROVADO: { bg: '#059669', color: '#FFFFFF' },
  REJEITADO: { bg: '#B91C1C', color: '#FFFFFF' },
  BLOQUEADO: { bg: '#7F1D1D', color: '#FFFFFF' },
};

export function StatusChip({ status, label, size = 'sm' }: { status: string; label?: string; size?: 'sm' | 'md' }) {
  const c = STATUS_COLORS[status] ?? { bg: colors.surface2, color: colors.text };
  return <Badge size={size} text={label ?? status} bg={c.bg} color={c.color} />;
}

export function Chip({ label, active, onPress, color = colors.primary, testID }: { label: string; active?: boolean; onPress?: () => void; color?: string; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.chip, { borderColor: active ? color : colors.borderStrong, backgroundColor: active ? color : colors.surface }]}
    >
      <Text style={{ color: active ? '#FFFFFF' : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, alignSelf: 'flex-start' },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
});
