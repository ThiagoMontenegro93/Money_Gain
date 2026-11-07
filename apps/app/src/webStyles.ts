import { Platform } from 'react-native';
import { colors } from './theme';

/** CSS global da web (seção 11 - placeholders visíveis + foco). */
export function injectWebStyles() {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as any).document;
  if (!doc || doc.getElementById('lc-global-css')) return;
  const style = doc.createElement('style');
  style.id = 'lc-global-css';
  style.textContent = `
    html, body, #root { background: ${colors.bg}; height: 100%; }
    select, option { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    input::placeholder, textarea::placeholder { color: #64748B !important; opacity: 1 !important; font-weight: 500; }
    input:focus, textarea:focus, select:focus { outline: none !important; }
    select.lc-select:focus { border-color: ${colors.inputFocus} !important; }
    input, textarea, select { caret-color: ${colors.inputFocus}; }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 6px; }
    ::-webkit-scrollbar-track { background: #0B1220; }
  `;
  doc.head.appendChild(style);
}
