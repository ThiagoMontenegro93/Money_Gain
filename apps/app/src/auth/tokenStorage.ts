import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'lendcontrol.token';

/** Token de sessão: SecureStore no nativo, localStorage na web (sempre com try/catch). */
export async function getToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (token) globalThis.localStorage?.setItem(KEY, token);
      else globalThis.localStorage?.removeItem(KEY);
      return;
    }
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // armazenamento indisponível (modo privado etc.) - a sessão vale só enquanto o app estiver aberto
  }
}
