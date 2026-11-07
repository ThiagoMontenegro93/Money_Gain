import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import type { ClientLookupItem } from '../api/types';
import { useDebounced } from '../hooks/useDebounced';
import { classIcon, colors } from '../theme';
import { Input } from './ui';

/** Campo de nome com busca de clientes existentes (GET /clients/lookup). */
export function ClientLookupField({ label, required, value, onChangeText, onSelect, error, placeholder, excludeId, testID }: { label: string; required?: boolean; value: string | null | undefined; onChangeText: (v: string) => void; onSelect: (c: ClientLookupItem) => void; error?: string | null; placeholder?: string; excludeId?: string; testID?: string }) {
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<ClientLookupItem[]>([]);
  const [touched, setTouched] = useState(false);
  const q = useDebounced(value ?? '', 300);

  useEffect(() => {
    if (!touched || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    api.clients
      .lookup(q.trim())
      .then((r) => alive && setResults(r.filter((c) => c.id !== excludeId)))
      .catch(() => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [q, touched, excludeId]);

  return (
    <View style={{ zIndex: focused ? 50 : 1 }}>
      <Input
        testID={testID}
        label={label}
        required={required}
        value={value}
        error={error}
        placeholder={placeholder ?? 'Digite para buscar clientes existentes...'}
        onChangeText={(t) => {
          setTouched(true);
          setFocused(true);
          onChangeText(t);
        }}
      />
      {focused && results.length > 0 ? (
        <View style={styles.drop}>
          <Text style={styles.dropTitle}>CLIENTES ENCONTRADOS</Text>
          {results.map((c) => (
            <Pressable
              key={c.id}
              style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.item, hovered && { backgroundColor: '#E2E8F0' }]}
              onPress={() => {
                onSelect(c);
                setResults([]);
                setFocused(false);
                setTouched(false);
              }}
            >
              <Text style={styles.itemName}>{classIcon[c.classificacao]} {c.fullName}</Text>
              <Text style={styles.itemSub}>{c.whatsapp ?? 'sem telefone'} · cliente desde {String(c.since).slice(0, 4)}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.item} onPress={() => setFocused(false)}>
            <Text style={[styles.itemSub, { fontWeight: '700' }]}>Não é nenhum destes - continuar digitando</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  drop: { backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 2, borderColor: colors.inputFocus, marginTop: -8, marginBottom: 12, overflow: 'hidden' },
  dropTitle: { color: '#475569', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 12, paddingTop: 8 },
  item: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  itemName: { color: '#0F172A', fontWeight: '700', fontSize: 15 },
  itemSub: { color: '#475569', fontSize: 12 },
});
