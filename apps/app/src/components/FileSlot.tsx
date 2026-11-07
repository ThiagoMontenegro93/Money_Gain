import React, { useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { ApiError, errorMessage } from '../api/http';
import { holdFile, isLocalFileRef } from '../offline/outbox';
import { colors } from '../theme';
import { openFile, pickFile, uploadFile } from '../utils/files';
import { Button, Field } from './ui';

/**
 * Upload de um arquivo privado (POST /files) com preview; guarda só o id.
 * Com `offline`, sem internet o arquivo fica guardado no aparelho e o id vira uma referência
 * local ("local:...") que a fila de envio troca pelo id real ao sincronizar (Fase 4).
 */
export function FileSlot({ label, fileId, onChange, kind = 'image', hint, testID, offline }: { label: string; fileId: string | null | undefined; onChange: (id: string | null) => void; kind?: 'image' | 'imageOrPdf'; hint?: string; testID?: string; offline?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  const pick = async (camera = false) => {
    setErr(null);
    let f: Awaited<ReturnType<typeof pickFile>> = null;
    try {
      f = await pickFile(kind, camera);
      if (!f) return;
      setBusy(true);
      const up = await uploadFile(f);
      setPreview(f.previewUri ?? null);
      setName(up.originalName ?? f.name);
      onChange(up.id);
    } catch (e) {
      if (offline && f && e instanceof ApiError && e.status === 0) {
        setPreview(f.previewUri ?? null);
        setName(f.name);
        onChange(holdFile(f));
      } else setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const local = isLocalFileRef(fileId);
  return (
    <Field label={label} error={err} hint={hint}>
      <View style={styles.box} testID={testID}>
        {preview ? <Image source={{ uri: preview }} style={styles.img} resizeMode="cover" /> : (
          <View style={[styles.img, styles.placeholder]}>
            <Text style={{ fontSize: 26 }}>{fileId ? '📄' : '📷'}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 6 }}>
          <Text testID={testID ? `${testID}-status` : undefined} style={{ color: local ? colors.warning : fileId ? colors.success : colors.textMuted, fontWeight: '700' }}>
            {local ? `📴 Guardado no aparelho${name ? `: ${name}` : ''} (sobe quando a internet voltar)` : fileId ? `✓ Anexado${name ? `: ${name}` : ''}` : 'Nenhum arquivo anexado'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" title={fileId ? 'Trocar' : 'Anexar'} icon="📎" loading={busy} onPress={() => void pick(false)} />
            {Platform.OS !== 'web' ? <Button size="sm" variant="secondary" title="Câmera" icon="📸" onPress={() => void pick(true)} /> : null}
            {fileId && !local ? <Button size="sm" variant="secondary" title="Ver" icon="👁" onPress={() => openFile(fileId).catch((e) => setErr(errorMessage(e)))} /> : null}
            {fileId ? <Button size="sm" variant="ghost" title="Remover" onPress={() => { onChange(null); setPreview(null); setName(null); }} /> : null}
          </View>
        </View>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderStyle: 'dashed', borderRadius: 10, padding: 10 },
  img: { width: 72, height: 72, borderRadius: 8 },
  placeholder: { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
