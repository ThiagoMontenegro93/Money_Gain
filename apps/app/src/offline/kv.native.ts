import AsyncStorage from '@react-native-async-storage/async-storage';

/** Armazenamento chave-valor do modo offline - versão nativa (AsyncStorage). */
export async function kvGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export async function kvRemove(keys: string[]): Promise<void> {
  try {
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    /* indisponível */
  }
}

export async function kvKeys(prefix: string): Promise<string[]> {
  try {
    return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
}
