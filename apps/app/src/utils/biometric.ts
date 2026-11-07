import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Verificação biométrica adicional (celular). Retorna true se aprovada ou se o
 * aparelho não tiver biometria disponível (aí vale só a senha). false = cancelada/falhou.
 */
export async function biometricCheck(reason: string): Promise<{ ok: boolean; used: boolean }> {
  if (Platform.OS === 'web') return { ok: true, used: false };
  try {
    const has = await LocalAuthentication.hasHardwareAsync();
    const enrolled = has && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return { ok: true, used: false };
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Cancelar', disableDeviceFallback: false });
    return { ok: r.success, used: true };
  } catch {
    return { ok: true, used: false };
  }
}
