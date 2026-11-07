import React, { useState } from 'react';
import { Modal as RNModal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius } from '../../theme';
import { Field } from './Field';

export interface Option<V extends string = string> {
  value: V;
  label: string;
}

export interface SelectProps<V extends string> {
  label?: string;
  value: V | null | undefined;
  options: Option<V>[];
  onChange: (v: V | null) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  allowEmpty?: boolean;
}

export function Select<V extends string>(p: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const current = p.options.find((o) => o.value === p.value);
  const borderColor = p.error ? colors.danger : colors.inputBorder;

  if (Platform.OS === 'web') {
    // <select> nativo do navegador: melhor para teclado/desktop
    return (
      <Field label={p.label} required={p.required} error={p.error} style={p.style}>
        {React.createElement(
          'select',
          {
            'data-testid': p.testID,
            value: p.value ?? '',
            onChange: (e: { target: { value: string } }) => p.onChange((e.target.value || null) as V | null),
            className: 'lc-select',
            style: {
              backgroundColor: colors.inputBg,
              color: current ? colors.inputText : colors.inputPlaceholder,
              fontWeight: 600,
              fontSize: 16,
              border: `2px solid ${borderColor}`,
              borderRadius: radius.md,
              padding: '10px 10px',
              minHeight: 46,
                            width: '100%',
            },
          },
          [
            <option key="__empty" value="" disabled={!p.allowEmpty} style={{ color: colors.inputPlaceholder }}>
              {p.placeholder ?? 'Selecione...'}
            </option>,
            ...p.options.map((o) => (
              <option key={o.value} value={o.value} style={{ color: colors.inputText }}>
                {o.label}
              </option>
            )),
          ],
        )}
      </Field>
    );
  }

  return (
    <Field label={p.label} required={p.required} error={p.error} style={p.style}>
      <Pressable testID={p.testID} onPress={() => setOpen(true)} style={[styles.box, { borderColor }]}>
        <Text style={[styles.value, !current && { color: colors.inputPlaceholder, fontWeight: '500' }]}>{current?.label ?? p.placeholder ?? 'Selecione...'}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      <RNModal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{p.label ?? 'Selecione'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {p.allowEmpty && (
                <Pressable style={styles.opt} onPress={() => { p.onChange(null); setOpen(false); }}>
                  <Text style={[styles.optText, { color: colors.textMuted }]}>{p.placeholder ?? 'Nenhum'}</Text>
                </Pressable>
              )}
              {p.options.map((o) => (
                <Pressable key={o.value} style={[styles.opt, o.value === p.value && styles.optActive]} onPress={() => { p.onChange(o.value); setOpen(false); }}>
                  <Text style={styles.optText}>{o.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </RNModal>
    </Field>
  );
}

/** Botões lado a lado (ex.: Método, Tipo, SIM/NÃO). */
export function Segmented<V extends string>({ label, value, options, onChange, required, error, style, testIDPrefix }: { label?: string; value: V | null | undefined; options: Option<V>[]; onChange: (v: V) => void; required?: boolean; error?: string | null; style?: StyleProp<ViewStyle>; testIDPrefix?: string }) {
  return (
    <Field label={label} required={required} error={error} style={style}>
      <View style={styles.seg}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
              onPress={() => onChange(o.value)}
              style={[styles.segItem, active && styles.segActive]}
            >
              <Text style={[styles.segText, active && { color: '#FFFFFF' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Field>
  );
}

export function Checkbox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={() => onChange(!checked)} style={styles.check} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.box2, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}>{typeof label === 'string' ? <Text style={styles.checkLabel}>{label}</Text> : label}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.inputBg, borderWidth: 2, borderRadius: radius.md, paddingHorizontal: 12, minHeight: 46, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1, color: colors.inputText, fontWeight: '600', fontSize: 16 },
  caret: { color: colors.inputText, fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: 'rgba(2,6,23,0.7)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 8 },
  opt: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.sm },
  optActive: { backgroundColor: colors.primaryDark },
  optText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  seg: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 2, borderColor: colors.inputBorder, backgroundColor: colors.inputBg },
  segActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { color: colors.inputText, fontWeight: '700', fontSize: 14 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  box2: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.inputBorder, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tick: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  checkLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
