import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; text: string; tone: Tone }

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, tone: Tone = 'success') => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, text, tone }]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <View pointerEvents="box-none" style={styles.wrap}>
        {items.map((i) => (
          <Pressable key={i.id} onPress={() => setItems((l) => l.filter((x) => x.id !== i.id))} style={[styles.toast, { borderLeftColor: i.tone === 'success' ? colors.success : i.tone === 'error' ? colors.danger : colors.primary }]}>
            <Text style={styles.text}>{i.tone === 'success' ? '✅ ' : i.tone === 'error' ? '⛔ ' : 'ℹ️ '}{i.text}</Text>
          </Pressable>
        ))}
      </View>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 16, bottom: 80, left: 16, alignItems: 'flex-end', gap: 8 },
  toast: { backgroundColor: '#020617', borderWidth: 1, borderColor: colors.border, borderLeftWidth: 5, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, maxWidth: 460 },
  text: { color: colors.text, fontWeight: '700', fontSize: 14 },
});
