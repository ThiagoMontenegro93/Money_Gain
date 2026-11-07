import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { colors } from '../theme';

export interface Slice {
  label: string;
  value: number;
  color: string;
}

function arc(cx: number, cy: number, r: number, start: number, end: number) {
  const p = (a: number) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];
  const [x1, y1] = p(start);
  const [x2, y2] = p(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

/** Pizza simples em SVG com legenda. */
export function PieChart({ data, size = 200 }: { data: Slice[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2;
  let acc = 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <Svg width={size} height={size}>
        {total === 0 ? (
          <Circle cx={r} cy={r} r={r - 2} fill={colors.surface2} />
        ) : (
          <G>
            {data.map((d) => {
              if (!d.value) return null;
              const start = (acc / total) * Math.PI * 2;
              acc += d.value;
              const end = (acc / total) * Math.PI * 2;
              if (d.value === total) return <Circle key={d.label} cx={r} cy={r} r={r - 2} fill={d.color} stroke={colors.surface} strokeWidth={2} />;
              return <Path key={d.label} d={arc(r, r, r - 2, start, end)} fill={d.color} stroke={colors.surface} strokeWidth={2} />;
            })}
          </G>
        )}
        <Circle cx={r} cy={r} r={r * 0.5} fill={colors.surface} />
      </Svg>
      <View style={{ gap: 8 }}>
        {data.map((d) => (
          <View key={d.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: d.color }} />
            <Text style={{ color: colors.text, fontWeight: '700', minWidth: 80 }}>{d.label}</Text>
            <Text style={{ color: colors.textMuted, fontWeight: '700' }}>
              {d.value} {total ? `(${Math.round((d.value / total) * 100)}%)` : ''}
            </Text>
          </View>
        ))}
        <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>Total: {total} clientes</Text>
      </View>
    </View>
  );
}
