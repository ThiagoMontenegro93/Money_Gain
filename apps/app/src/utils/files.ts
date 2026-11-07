import { Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../api';
import type { FileDTO } from '../api/types';
import { API_URL } from '../config';

const MAX = 10 * 1024 * 1024;

export interface PickedFile {
  name: string;
  type: string;
  size?: number;
  /** web */
  file?: Blob;
  /** nativo */
  uri?: string;
  previewUri?: string;
}

function pickWeb(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const doc = (globalThis as any).document;
    if (!doc) return resolve(null);
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      resolve({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, file: f, previewUri: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined });
    };
    doc.body.appendChild(input);
    input.click();
  });
}

/** Abre o seletor de arquivos (imagem ou PDF). */
export async function pickFile(kind: 'image' | 'imageOrPdf' = 'imageOrPdf', camera = false): Promise<PickedFile | null> {
  if (Platform.OS === 'web') return pickWeb(kind === 'image' ? 'image/*' : 'image/*,application/pdf');
  if (kind === 'imageOrPdf' && !camera) {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return null;
    const a = r.assets[0];
    return { name: a.name, type: a.mimeType ?? 'application/octet-stream', size: a.size, uri: a.uri, previewUri: a.mimeType?.startsWith('image/') ? a.uri : undefined };
  }
  const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Permissão negada para acessar câmera/galeria');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
  const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { name: a.fileName ?? `foto-${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg', size: a.fileSize, uri: a.uri, previewUri: a.uri };
}

export async function uploadFile(f: PickedFile): Promise<FileDTO> {
  if (f.size && f.size > MAX) throw new Error('Arquivo maior que 10 MB');
  const form = new FormData();
  if (f.file) form.append('file', f.file as Blob, f.name);
  else form.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
  return api.files.upload(form);
}

/** Converte a URL assinada (relativa ou absoluta) em URL abrível. */
export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const m = /^(https?:\/\/[^/]+)(\/.*)?$/.exec(API_URL);
  const origin = m?.[1] ?? '';
  const basePath = m?.[2] ?? '';
  if (basePath && url.startsWith(basePath + '/')) return origin + url;
  if (url.startsWith('/')) return API_URL + url;
  return `${API_URL}/${url}`;
}

/** Busca URL assinada (5 min) e abre o arquivo. */
export async function openFile(id: string): Promise<void> {
  const { url } = await api.files.url(id);
  const full = absoluteUrl(url);
  if (Platform.OS === 'web') (globalThis as any).open?.(full, '_blank', 'noopener');
  else await Linking.openURL(full);
}
