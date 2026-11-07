import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, isWithinWindow, msUntilWindow, renderTemplate, templateForDue } from './messaging';

describe('mensagens', () => {
  it('renderiza variáveis', () => {
    expect(renderTemplate(DEFAULT_TEMPLATES.D_0, { nome: 'João', valor: 'R$ 100,00', vencimento: '30/11/2026', pix_chave: '21999999999' }))
      .toBe('Bom dia, João! Sua parcela de R$ 100,00 vence HOJE (30/11/2026). PIX: 21999999999. Após pagar, envie o comprovante por aqui. Obrigado!');
  });
  it('escolhe template pelo dia', () => {
    expect(templateForDue('2026-11-30', '2026-11-28')).toEqual(['D_MINUS_2']);
    expect(templateForDue('2026-11-30', '2026-11-30')).toEqual(['D_0']);
    expect(templateForDue('2026-11-30', '2026-12-01')).toEqual(['D_PLUS_1']);
    expect(templateForDue('2026-11-30', '2026-12-03')).toEqual(['D_PLUS_3']);
    expect(templateForDue('2026-11-30', '2026-12-07')).toEqual(['D_PLUS_7', 'D_PLUS_7_FIADOR']);
    expect(templateForDue('2026-11-30', '2026-12-05')).toEqual([]);
  });
  it('janela 08-20h em São Paulo', () => {
    expect(isWithinWindow(new Date('2026-11-07T12:00:00Z'))).toBe(true); // 09:00 SP
    expect(isWithinWindow(new Date('2026-11-07T23:30:00Z'))).toBe(false); // 20:30 SP
    expect(isWithinWindow(new Date('2026-11-07T10:59:00Z'))).toBe(false); // 07:59 SP
    expect(msUntilWindow(new Date('2026-11-07T10:00:00Z'))).toBe(60 * 60_000); // 07:00 -> 08:00
  });
});
