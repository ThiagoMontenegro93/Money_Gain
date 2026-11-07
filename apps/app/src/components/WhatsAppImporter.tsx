import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CLIENT_FIELDS, ClientForm, ClientFormKey, formatBRL, ImportResult, isoToBR, parseWhatsAppBlock, parseWhatsAppLine } from '@lendcontrol/core';
import { useLayout } from '../hooks/useLayout';
import { colors } from '../theme';
import { Button, Input, Modal, Notice, Stack } from './ui';

export const LINE_EXAMPLE =
  'JOAO SILVA SANTOS;12345678909;1234567 SSP;15/03/1990;21999999999;Rua das Flores 123;20745-000;PIX 21999999999;MARIA MAE 21977777777;CARLOS FIADOR 98765432100;PEDRO INDICACAO';

export const BLOCK_EXAMPLE = `Nome: Joao Silva Santos
CPF: 123.456.789-09
RG: 1234567 SSP
Nascimento: 15/03/1990
WhatsApp: 21 99999-9999
Endereço: Rua das Flores 123, Centro, Rio - RJ
CEP: 20745-000
Ponto Ref: Portão azul
PIX: 21999999999 (celular)
Profissão: Motorista
Emergência: Maria Silva (Mãe) - 21 97777-7777
Fiador: Carlos Pereira - 987.654.321-00 - 21 96666-6666
Indicação: Pedro da Silva - 21 98888-8888`;

const has = (d: Partial<ClientForm>, k: ClientFormKey) => d[k] !== undefined && d[k] !== null && String(d[k]).trim() !== '';

/** Interpreta as duas caixas (linha e/ou bloco). Se ambas preenchidas, o bloco prevalece. */
export function interpret(line: string, block: string): ImportResult | null {
  const results: ImportResult[] = [];
  if (line.trim()) results.push(parseWhatsAppLine(line.trim()));
  if (block.trim()) results.push(parseWhatsAppBlock(block.trim()));
  if (!results.length) return null;
  if (results.length === 1) return results[0];
  const data: Partial<ClientForm> = { ...results[0].data };
  for (const [k, v] of Object.entries(results[1].data)) if (v !== undefined && v !== null && String(v).trim() !== '') (data as Record<string, unknown>)[k] = v;
  data.hasGuarantor = !!(results[0].data.hasGuarantor || results[1].data.hasGuarantor);
  const fields = CLIENT_FIELDS.filter((f) => !(f.key.startsWith('guarantor') && !data.hasGuarantor));
  const warnings = Array.from(new Set([...results[0].warnings, ...results[1].warnings])).filter((w) => !(w.startsWith('Telefone') && data.whatsapp));
  return {
    data,
    format: 'BLOCO',
    warnings,
    found: fields.filter((f) => has(data, f.key)).map(({ key, label }) => ({ key, label })),
    missing: fields.filter((f) => !has(data, f.key)).map(({ key, label }) => ({ key, label })),
  };
}

function display(key: ClientFormKey, v: unknown): string {
  if (v == null) return '';
  if (key === 'birthDate') {
    try {
      return isoToBR(String(v));
    } catch {
      return String(v);
    }
  }
  if (key === 'incomeCents') return formatBRL(Number(v));
  return String(v);
}

export function WhatsAppImporter({ onApply }: { onApply: (r: ImportResult) => void }) {
  const { isDesktop } = useLayout();
  const [line, setLine] = useState('');
  const [block, setBlock] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    setErr(null);
    const r = interpret(line, block);
    if (!r) return setErr('Cole a mensagem do cliente em uma das caixas acima.');
    if (r.found.length === 0) return setErr('Não reconhecemos nenhum campo. Confira o formato (linha com ; ou bloco "Chave: valor").');
    setResult(r);
  };

  const total = result ? result.found.length + result.missing.length : 0;
  return (
    <View style={styles.box} testID="wa-importer">
      <Text style={styles.title}>📋 Importar dados que cliente enviou por WhatsApp</Text>
      <Text style={styles.sub}>Cole a mensagem exatamente como o cliente enviou. O sistema interpreta e preenche as 5 abas da ficha.</Text>
      <Stack row={isDesktop} colGap={0} style={styles.cols}>
        <Input testID="wa-line" label="Colar LINHA ÚNICA (separada por ;)" value={line} onChangeText={setLine} multiline rows={isDesktop ? 9 : 6} placeholder={`Exemplo:\n${LINE_EXAMPLE}`} style={{ flex: 1 }} />
        <Input testID="wa-block" label="Colar BLOCO ORGANIZADO" value={block} onChangeText={setBlock} multiline rows={isDesktop ? 9 : 6} placeholder={`Exemplo:\n${BLOCK_EXAMPLE}`} style={{ flex: 1 }} />
      </Stack>
      {err ? <Notice tone="warning" text={err} /> : null}
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <Button testID="wa-interpret" title="🔍 INTERPRETAR E PREENCHER FICHA" size="lg" variant="success" onPress={run} style={{ maxWidth: '100%' }} />
      </View>

      <Modal
        testID="wa-preview"
        visible={!!result}
        title="Pré-visualização da importação"
        onClose={() => setResult(null)}
        width={760}
        footer={
          <>
            <Button title="Cancelar" variant="secondary" onPress={() => setResult(null)} />
            <Button
              testID="wa-confirm"
              title="✓ Confirmar e preencher ficha"
              variant="success"
              onPress={() => {
                if (result) onApply(result);
                setResult(null);
                setLine('');
                setBlock('');
              }}
            />
          </>
        }
      >
        {result ? (
          <>
            <Text style={styles.summary}>
              Encontramos {result.found.length} de {total} campos.
              {result.missing.length ? ` Faltam: ${result.missing.map((m) => m.label).join(', ')}.` : ' Ficha completa!'} Confirma?
            </Text>
            <Text style={styles.fmt}>Formato detectado: {result.format === 'LINHA' ? 'Linha única (;)' : 'Bloco organizado'}</Text>
            {result.warnings.map((w) => (
              <Notice key={w} tone="warning" text={`⚠️ ${w}`} />
            ))}
            <View style={styles.list}>
              {result.found.map((f) => (
                <View key={f.key} style={[styles.item, { borderColor: colors.success, backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                  <Text style={{ color: colors.success, fontWeight: '900' }}>✓</Text>
                  <Text style={styles.itemLabel}>{f.label}</Text>
                  <Text style={styles.itemValue} numberOfLines={1}>{display(f.key, result.data[f.key])}</Text>
                </View>
              ))}
              {result.missing.map((f) => (
                <View key={f.key} style={[styles.item, { borderColor: colors.warning, backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                  <Text style={{ color: colors.warning, fontWeight: '900' }}>!</Text>
                  <Text style={styles.itemLabel}>{f.label}</Text>
                  <Text style={[styles.itemValue, { color: colors.warning }]}>faltando</Text>
                </View>
              ))}
            </View>
            {result.data.pixKey ? <Text style={styles.extra}>Tipo PIX detectado: {result.data.pixType}</Text> : null}
            {result.data.emergencyRelation ? <Text style={styles.extra}>Parentesco emergência: {result.data.emergencyRelation}</Text> : null}
          </>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.07)', borderRadius: 14, padding: 16, marginBottom: 18 },
  title: { color: '#BBF7D0', fontSize: 18, fontWeight: '900' },
  sub: { color: colors.textMuted, marginTop: 4, marginBottom: 12, fontWeight: '600' },
  cols: { flexDirection: 'row', gap: 14 },
  summary: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 4 },
  fmt: { color: colors.textMuted, marginBottom: 10 },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, width: '48%', minWidth: 260, flexGrow: 1 },
  itemLabel: { color: colors.label, fontWeight: '800', width: 130, fontSize: 13 },
  itemValue: { color: colors.text, flex: 1, fontWeight: '600', fontSize: 13 },
  extra: { color: colors.textMuted, marginTop: 8, fontSize: 13 },
});
