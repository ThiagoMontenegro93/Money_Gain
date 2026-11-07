import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme';

export interface Column<R> {
  key: string;
  title: string;
  width?: number;
  flex?: number;
  /** Largura mínima antes de a tabela rolar na horizontal. */
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  render: (row: R) => React.ReactNode;
}

export interface RowStyle {
  bg?: string;
  border?: string;
  text?: string;
}

export function Table<R>({ columns, rows, keyOf, onRowPress, rowStyle, minWidth = 900, empty, testID }: { columns: Column<R>[]; rows: R[]; keyOf: (r: R) => string; onRowPress?: (r: R) => void; rowStyle?: (r: R) => RowStyle; minWidth?: number; empty?: React.ReactNode; testID?: string }) {
  // Colunas com largura preferida encolhem até ~72% antes de a tabela ganhar rolagem horizontal
  const minOf = (c: Column<R>) => c.minWidth ?? (c.width ? Math.round(c.width * 0.72) : (c.flex ?? 1) >= 2 ? 150 : 90);
  const autoMin = Math.min(minWidth, columns.reduce((s, c) => s + minOf(c), 4));
  const cellStyle = (c: Column<R>) => [styles.cell, c.width ? { flexBasis: c.width, flexGrow: 0, flexShrink: 1, minWidth: minOf(c) } : { flex: c.flex ?? 1, minWidth: minOf(c) }, { alignItems: c.align === 'right' ? ('flex-end' as const) : c.align === 'center' ? ('center' as const) : ('flex-start' as const) }];
  // A área de rolagem horizontal não limita a largura do conteúdo: fixamos a largura da tabela
  // na largura visível (ou no mínimo legível), assim as colunas encolhem antes de rolar.
  const [boxW, setBoxW] = React.useState(0);
  const tableW = boxW ? Math.max(autoMin, boxW) : undefined;
  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} testID={testID} onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}>
      <View style={tableW ? { width: tableW } : { minWidth: autoMin, flex: 1 }}>
        <View style={styles.headRow}>
          {columns.map((c) => (
            <View key={c.key} style={cellStyle(c)}>
              <Text style={styles.headText}>{c.title.toUpperCase()}</Text>
            </View>
          ))}
        </View>
        {rows.length === 0 && empty}
        {rows.map((r) => {
          const rs = rowStyle?.(r) ?? {};
          return (
            <Pressable
              key={keyOf(r)}
              onPress={onRowPress ? () => onRowPress(r) : undefined}
              style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [
                styles.row,
                rs.bg ? { backgroundColor: rs.bg } : null,
                rs.border ? { borderLeftWidth: 4, borderLeftColor: rs.border } : { borderLeftWidth: 4, borderLeftColor: 'transparent' },
                hovered && onRowPress ? { opacity: 0.88 } : null,
              ]}
            >
              {columns.map((c) => {
                const v = c.render(r);
                return (
                  <View key={c.key} style={cellStyle(c)}>
                    {typeof v === 'string' || typeof v === 'number' ? (
                      <Text style={[styles.cellText, rs.text ? { color: rs.text } : null, c.align === 'right' && { textAlign: 'right' }]} numberOfLines={1}>
                        {v}
                      </Text>
                    ) : (
                      v
                    )}
                  </View>
                );
              })}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', backgroundColor: '#0B1220', borderBottomWidth: 1, borderBottomColor: colors.border, paddingLeft: 4 },
  headText: { color: colors.textMuted, fontWeight: '800', fontSize: 11, letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(51,65,85,0.6)', minHeight: 40 },
  cell: { paddingHorizontal: 6, paddingVertical: 8, justifyContent: 'center' },
  cellText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
