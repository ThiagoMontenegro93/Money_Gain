import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from 'react-native';
import { colors, scoreColor } from '../../theme';
import { Field } from './Field';

export function ProgressBar({ percent, color = colors.primary, height = 10, track = '#0B1220' }: { percent: number; color?: string; height?: number; track?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ height, backgroundColor: track, borderRadius: height, overflow: 'hidden' }}>
      <View style={{ width: `${p}%`, height: '100%', backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

export function StatCard({ label, value, sub, color = colors.primary, icon, style, onPress, testID }: { label: string; value: string; sub?: string; color?: string; icon?: string; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  const { width } = useWindowDimensions();
  const fs = width < 640 ? 18 : width < 1024 ? 21 : 24;
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={[styles.stat, { borderTopColor: color }, style]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
        {icon ? <Text style={{ fontSize: 18 }}>{icon}</Text> : null}
      </View>
      <Text style={[styles.statValue, { color, fontSize: fs }]}>
        {value}
      </Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </Pressable>
  );
}

/** Seletor de score 0-10 com cor (0-3 vermelho, 4-7 amarelo, 8-10 verde). */
export function ScoreSelector({ label, value, onChange, error }: { label?: string; value: number | null | undefined; onChange: (v: number | null) => void; error?: string | null }) {
  return (
    <Field label={label} error={error}>
      <View style={styles.scoreRow}>
        {Array.from({ length: 11 }, (_, i) => {
          const on = value != null && i <= value;
          const c = scoreColor(i);
          return (
            <Pressable
              key={i}
              testID={`score-${i}`}
              onPress={() => onChange(value === i ? null : i)}
              style={[styles.scoreCell, { borderColor: c, backgroundColor: on ? scoreColor(value) : colors.inputBg }]}
            >
              <Text style={{ color: on ? '#FFFFFF' : colors.inputText, fontWeight: '800', fontSize: 14 }}>{i}</Text>
            </Pressable>
          );
        })}
        <Text style={[styles.scoreValue, { color: scoreColor(value) }]}>{value == null ? '—' : `${value}/10`}</Text>
      </View>
    </Field>
  );
}

export function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number' ? <Text style={[styles.v, mono && { fontFamily: 'monospace' }]}>{v === '' ? '—' : v}</Text> : v}
    </View>
  );
}

export function Row({ children, gap = 12, style, wrap = true }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', gap, flexWrap: wrap ? 'wrap' : 'nowrap', alignItems: 'flex-start' }, style]}>{children}</View>;
}

/** Grade responsiva: `cols` colunas no desktop, 1 no celular. */
export function Grid({ cols, children, gap = 12 }: { cols: number; children: React.ReactNode; gap?: number }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {items.map((c, i) => (
        <View key={i} style={{ width: `${100 / cols}%`, paddingHorizontal: gap / 2, marginBottom: gap }}>
          {c}
        </View>
      ))}
    </View>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}
export function Txt({ children, style, bold }: { children: React.ReactNode; style?: StyleProp<any>; bold?: boolean }) {
  return <Text style={[styles.txt, bold && { fontWeight: '700' }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  stat: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, padding: 14, minHeight: 104 },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, flex: 1 },
  statValue: { fontSize: 24, fontWeight: '800', marginTop: 8 },
  statSub: { color: colors.textMuted, fontSize: 12, marginTop: 4, fontWeight: '600' },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  scoreCell: { width: 38, height: 38, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  scoreValue: { fontSize: 18, fontWeight: '900', marginLeft: 8 },
  kv: { marginBottom: 10, minWidth: 130, flexShrink: 1 },
  k: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2, textTransform: 'uppercase' },
  v: { color: colors.text, fontSize: 15, fontWeight: '600' },
  h1: { color: colors.text, fontSize: 24, fontWeight: '800' },
  h2: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  muted: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  txt: { color: colors.text, fontSize: 14 },
});

/**
 * Linha que vira coluna no celular. Em coluna, os filhos perdem o `flex` (base 0)
 * para não colapsarem/sobreporem (react-native-web usa min-height 0).
 */
export function Stack({ row, gap = 12, colGap, children, style }: { row: boolean; gap?: number; colGap?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[style, { flexDirection: row ? 'row' : 'column', gap: row ? gap : colGap ?? gap }]}>
      {row
        ? kids
        : kids.map((c) =>
            React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<{ style?: StyleProp<ViewStyle> }>, { style: [(c as React.ReactElement<{ style?: StyleProp<ViewStyle> }>).props.style, { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%', minWidth: 0 }] }) : c,
          )}
    </View>
  );
}
