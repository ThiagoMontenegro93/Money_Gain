import React from 'react';
import { Text, View } from 'react-native';
import { formatBRL } from '@lendcontrol/core';
import type { LongLate, LongLateMode } from '../api/types';
import { colors } from '../theme';
import { Checkbox, Input, MoneyInput, Segmented } from './ui';

/** Estado editável da cobrança por atraso longo (texto nos campos, centavos no valor fixo). */
export interface LongLateDraft {
  on: boolean;
  mode: Exclude<LongLateMode, 'OFF'>;
  days: string;
  percent: string;
  fixedCents: number | null;
}

export const draftFromLongLate = (l: Partial<LongLate> | null | undefined): LongLateDraft => ({
  on: !!l?.longLateMode && l.longLateMode !== 'OFF',
  mode: l?.longLateMode === 'FIXED' ? 'FIXED' : 'PERCENT',
  days: String(l?.longLateAfterDays ?? 60),
  percent: l?.longLatePercent ? String(l.longLatePercent).replace('.', ',') : '',
  fixedCents: l?.longLateFixedCents || null,
});

/** Converte o rascunho para o formato da API, ou devolve a mensagem de erro. */
export function longLateFromDraft(d: LongLateDraft): { value: LongLate } | { error: string } {
  if (!d.on) return { value: { longLateMode: 'OFF', longLateAfterDays: Number(d.days) || 60, longLatePercent: 0, longLateFixedCents: 0 } };
  const days = Number(d.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: 'Atraso longo: informe a partir de quantos dias (1 a 3650)' };
  if (d.mode === 'PERCENT') {
    const p = Number(d.percent.replace(',', '.'));
    if (!(p > 0 && p <= 100)) return { error: 'Atraso longo: informe a % ao dia (maior que 0 e até 100)' };
    return { value: { longLateMode: 'PERCENT', longLateAfterDays: days, longLatePercent: p, longLateFixedCents: 0 } };
  }
  if (!d.fixedCents || d.fixedCents <= 0) return { error: 'Atraso longo: informe o valor fixo por dia' };
  return { value: { longLateMode: 'FIXED', longLateAfterDays: days, longLatePercent: 0, longLateFixedCents: d.fixedCents } };
}

/** Texto curto para revisão e detalhe do empréstimo. */
export function describeLongLate(l: Partial<LongLate> | null | undefined): string {
  if (!l?.longLateMode || l.longLateMode === 'OFF') return 'Não cobra';
  const what = l.longLateMode === 'FIXED' ? `${formatBRL(l.longLateFixedCents ?? 0)} por dia` : `${String(l.longLatePercent).replace('.', ',')}% ao dia`;
  const n = l.longLateAfterDays ?? 60;
  return `${what} a partir de ${n} dia${n === 1 ? '' : 's'} de atraso`;
}

export function LongLateEditor({ value, onChange, editable = true, prefix = 'll' }: { value: LongLateDraft; onChange: (v: LongLateDraft) => void; editable?: boolean; prefix?: string }) {
  const set = (p: Partial<LongLateDraft>) => editable && onChange({ ...value, ...p });
  return (
    <View style={{ gap: 10 }} testID={`${prefix}-editor`}>
      <Checkbox
        testID={`${prefix}-on`}
        checked={value.on}
        onChange={(on) => set({ on })}
        label="Cobrança especial para atraso longo (ex.: 2 meses ou mais)"
      />
      {value.on ? (
        <View style={{ gap: 10, paddingLeft: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Input
              testID={`${prefix}-days`}
              label="A partir de quantos dias de atraso"
              mask="digits"
              value={value.days}
              onChangeText={(days) => set({ days })}
              editable={editable}
              style={{ flexGrow: 1, flexBasis: 200, maxWidth: 260 }}
              hint="60 dias = 2 meses"
            />
            <Segmented
              label="Como cobrar"
              value={value.mode}
              onChange={(mode) => set({ mode })}
              testIDPrefix={`${prefix}-mode`}
              options={[
                { value: 'PERCENT', label: '% ao dia' },
                { value: 'FIXED', label: 'R$ fixo ao dia' },
              ]}
              style={{ flexGrow: 1, flexBasis: 220, maxWidth: 320 }}
            />
          </View>
          {value.mode === 'PERCENT' ? (
            <Input
              testID={`${prefix}-percent`}
              label="% ao dia sobre a parcela atrasada"
              mask="decimal"
              value={value.percent}
              onChangeText={(percent) => set({ percent })}
              editable={editable}
              style={{ maxWidth: 260 }}
            />
          ) : (
            <MoneyInput
              testID={`${prefix}-fixed`}
              label="Valor fixo por dia, por parcela atrasada"
              value={value.fixedCents}
              onChange={(fixedCents) => set({ fixedCents })}
              editable={editable}
              style={{ maxWidth: 260 }}
            />
          )}
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            Soma um valor a cada dia, a partir do dia em que a parcela completa esse atraso, além da multa diária normal. Entra no valor da parcela e na quitação, e o que for recebido aparece separado no caixa e no painel.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
