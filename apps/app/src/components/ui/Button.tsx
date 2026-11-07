import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { colors, radius } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'ghost' | 'dark';

const VARIANTS: Record<ButtonVariant, { bg: string; text: string; border: string }> = {
  primary: { bg: colors.primary, text: '#FFFFFF', border: colors.primary },
  secondary: { bg: colors.surface2, text: colors.text, border: colors.borderStrong },
  success: { bg: colors.successDark, text: '#FFFFFF', border: colors.successDark },
  danger: { bg: colors.dangerDark, text: '#FFFFFF', border: colors.dangerDark },
  warning: { bg: '#D97706', text: '#FFFFFF', border: '#D97706' },
  ghost: { bg: 'transparent', text: colors.textMuted, border: 'transparent' },
  dark: { bg: '#020617', text: '#FFFFFF', border: '#334155' },
};

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
  testID?: string;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', icon, loading, disabled, style, full, testID }: ButtonProps) {
  const v = VARIANTS[variant];
  const off = disabled || loading;
  const pad = size === 'sm' ? { paddingVertical: 6, paddingHorizontal: 10 } : size === 'lg' ? { paddingVertical: 14, paddingHorizontal: 22 } : { paddingVertical: 10, paddingHorizontal: 16 };
  const fs = size === 'sm' ? 13 : size === 'lg' ? 17 : 14;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      onPress={off ? undefined : onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        pad,
        { backgroundColor: v.bg, borderColor: v.border },
        full && { alignSelf: 'stretch' },
        (pressed || hovered) && !off && { opacity: 0.85 },
        off && { opacity: 0.45 },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={v.text} style={{ marginRight: 8 }} /> : icon ? <Text style={{ fontSize: fs, marginRight: 6 }}>{icon}</Text> : null}
        <Text style={[styles.text, { color: v.text, fontSize: fs }]} numberOfLines={2}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  text: { fontWeight: '700', flexShrink: 1, textAlign: 'center' },
});
