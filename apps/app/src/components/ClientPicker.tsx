import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import type { ClientListItem } from '../api/types';
import { useDebounced } from '../hooks/useDebounced';
import { classRow, colors } from '../theme';
import { brl } from '../utils/format';
import { Empty, Input, Loading, ScoreBadge } from './ui';

/** Busca e seleção de cliente (usa GET /clients?search=). */
export function ClientPicker({ selectedId, onSelect }: { selectedId?: string | null; onSelect: (c: ClientListItem) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [items, setItems] = useState<ClientListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setErr(null);
    api.clients
      .list({ search: q || undefined })
      .then((r) => alive && setItems(r.items))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [q]);
  return (
    <View>
      <Input testID="client-picker-search" label="Buscar cliente" value={search} onChangeText={setSearch} placeholder="🔍 Nome, CPF ou telefone" />
      {err ? <Text style={{ color: '#FCA5A5' }}>{err}</Text> : null}
      {!items && !err ? <Loading /> : null}
      {items && items.length === 0 ? <Empty text="Nenhum cliente encontrado" icon="👥" /> : null}
      <ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled>
        {items?.slice(0, 30).map((c) => {
          const rs = classRow[c.classificacao];
          const on = c.id === selectedId;
          return (
            <Pressable
              key={c.id}
              testID={`pick-${c.id}`}
              onPress={() => onSelect(c)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, marginBottom: 6, backgroundColor: rs.bg, borderLeftWidth: 4, borderLeftColor: rs.border, borderWidth: on ? 3 : 0, borderColor: on ? colors.primary : 'transparent' }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: rs.text, fontWeight: '800' }} numberOfLines={1}>{on ? '✓ ' : ''}{c.classificacao === 'PERDA' ? '💀 ' : ''}{c.fullName}{c.isBlocked ? ' 🚫' : ''}</Text>
                <Text style={{ color: rs.textMuted, fontSize: 12, fontWeight: '600' }}>{c.cpfMasked} · {c.whatsapp ?? '—'} · em aberto {brl(c.emAbertoCents)}</Text>
              </View>
              <ScoreBadge cls={c.classificacao} score={c.score} size="sm" />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
