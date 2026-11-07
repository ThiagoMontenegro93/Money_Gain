import React, { forwardRef, useState } from 'react';
import { KeyboardTypeOptions, StyleProp, StyleSheet, TextInput, TextStyle, View, ViewStyle } from 'react-native';
import { formatBRL } from '@lendcontrol/core';
import { colors, radius } from '../../theme';
import { Field } from './Field';
import { applyMask, centsFromTyping, MaskKind } from './masks';

export interface InputProps {
  label?: string;
  value: string | null | undefined;
  onChangeText?: (v: string) => void;
  mask?: MaskKind;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  hint?: React.ReactNode;
  multiline?: boolean;
  rows?: number;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  big?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  testID?: string;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

const KB: Partial<Record<MaskKind, KeyboardTypeOptions>> = { cpf: 'number-pad', phone: 'phone-pad', cep: 'number-pad', date: 'number-pad', digits: 'number-pad', decimal: 'decimal-pad' };

export const Input = forwardRef<TextInput, InputProps>(function Input(p, ref) {
  const [focus, setFocus] = useState(false);
  const borderColor = p.error ? colors.danger : focus ? colors.inputFocus : colors.inputBorder;
  return (
    <Field label={p.label} required={p.required} error={p.error} hint={p.hint} style={p.style}>
      <View style={styles.row}>
        <TextInput
          ref={ref}
          testID={p.testID}
          value={p.value ?? ''}
          onChangeText={(t) => p.onChangeText?.(applyMask(p.mask, t))}
          placeholder={p.placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          secureTextEntry={p.secure}
          keyboardType={p.keyboardType ?? (p.mask ? KB[p.mask] : undefined)}
          editable={p.editable !== false}
          multiline={p.multiline}
          numberOfLines={p.multiline ? p.rows ?? 3 : undefined}
          autoFocus={p.autoFocus}
          onSubmitEditing={p.onSubmitEditing}
          maxLength={p.maxLength}
          autoCapitalize={p.autoCapitalize}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={[
            styles.input,
            p.big && styles.big,
            p.multiline && { minHeight: 22 * (p.rows ?? 3) + 20, textAlignVertical: 'top' },
            { borderColor },
            p.editable === false && { backgroundColor: colors.inputDisabled },
            p.inputStyle,
          ]}
        />
        {p.right}
      </View>
    </Field>
  );
});

/** Input R$ com máscara: armazena centavos (inteiro). */
export function MoneyInput({ value, onChange, ...rest }: Omit<InputProps, 'value' | 'onChangeText' | 'mask'> & { value: number | null | undefined; onChange: (cents: number | null) => void }) {
  return (
    <Input
      {...rest}
      keyboardType="number-pad"
      value={value == null ? '' : formatBRL(value)}
      onChangeText={(t) => onChange(centsFromTyping(t))}
      placeholder={rest.placeholder ?? 'R$ 0,00'}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.inputBg,
    color: colors.inputText,
    fontWeight: '600',
    fontSize: 16,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 46,
  },
  big: { fontSize: 18, paddingVertical: 12, minHeight: 52 },
});
