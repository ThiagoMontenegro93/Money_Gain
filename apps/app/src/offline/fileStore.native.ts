/** Arquivos da fila offline - versão nativa: cópia em documentDirectory/outbox (sobrevive ao fechamento do app). */
import * as FileSystem from 'expo-file-system/legacy';
import type { PickedFile } from '../utils/files';

export interface StoredFile {
  key: string;
  name: string;
  type: string;
  size?: number;
  where: 'idb' | 'data' | 'fs';
  uri?: string;
}

export const DATAURL_MAX = 0;
const dir = () => `${FileSystem.documentDirectory ?? ''}outbox/`;

export async function persistFile(f: PickedFile, key: string): Promise<StoredFile> {
  if (!f.uri) throw new Error('Arquivo indisponível para guardar no aparelho');
  await FileSystem.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => undefined);
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(f.name)?.[0] ?? '';
  const to = `${dir()}${key}${ext}`;
  await FileSystem.copyAsync({ from: f.uri, to });
  return { key, name: f.name, type: f.type, size: f.size, where: 'fs', uri: to };
}

/** No React Native o FormData aceita { uri, name, type }. */
export async function filePart(s: StoredFile): Promise<Blob> {
  const info = await FileSystem.getInfoAsync(s.uri ?? '');
  if (!info.exists) throw new Error(`Arquivo "${s.name}" não está mais no aparelho`);
  return { uri: s.uri, name: s.name, type: s.type } as unknown as Blob;
}

export async function removeFile(s: StoredFile): Promise<void> {
  if (s.uri) await FileSystem.deleteAsync(s.uri, { idempotent: true }).catch(() => undefined);
}
