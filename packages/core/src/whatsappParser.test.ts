import { describe, expect, it } from 'vitest';
import { parseWhatsApp, parseWhatsAppBlock, parseWhatsAppLine } from './whatsappParser';
import { formatPhone, isValidCPF, isValidPhone } from './validators';
import { formProgress, validateClientForm } from './clientForm';

const LINE =
  'JOAO SILVA SANTOS;12345678909;1234567 SSP;15/03/1990;21999999999;Rua das Flores 123;20745-000;PIX 21999999999;MARIA MAE 21977777777;CARLOS FIADOR 98765432100;PEDRO INDICACAO';

const BLOCK = `Nome: Joao Silva Santos
CPF: 123.456.789-09
RG: 1234567 SSP
Nascimento: 15/03/1990
WhatsApp: 21 99999-9999
Endereço: Rua das Flores 123, Centro, Rio - RJ
CEP: 20745-000
Ponto Ref: Portão azul
PIX: 21999999999 (celular)
Profissão: Motorista
Emergência: Maria Silva (Mãe) - 21 97777-7777
Fiador: Carlos Pereira - 987.654.321-00 - 21 96666-6666
Indicação: Pedro da Silva - 21 98888-8888`;

describe('validadores', () => {
  it('CPF', () => {
    expect(isValidCPF('123.456.789-09')).toBe(true);
    expect(isValidCPF('987.654.321-00')).toBe(true);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('123.456.789-00')).toBe(false);
  });
  it('telefone', () => {
    expect(formatPhone('21999999999')).toBe('(21) 99999-9999');
    expect(isValidPhone('+55 21 99999-9999')).toBe(true);
    expect(isValidPhone('2199999')).toBe(false);
  });
});

describe('importador WhatsApp - linha única', () => {
  it('interpreta o exemplo da especificação', () => {
    const r = parseWhatsAppLine(LINE);
    expect(r.data).toMatchObject({
      fullName: 'Joao Silva Santos',
      cpf: '123.456.789-09',
      rg: '1234567',
      rgIssuer: 'SSP',
      birthDate: '1990-03-15',
      whatsapp: '(21) 99999-9999',
      street: 'Rua das Flores',
      number: '123',
      cep: '20745-000',
      pixKey: '21999999999',
      pixType: 'CELULAR',
      emergencyName: 'Maria',
      emergencyRelation: 'MAE',
      emergencyPhone1: '(21) 97777-7777',
      hasGuarantor: true,
      guarantorName: 'Carlos',
      guarantorCpf: '987.654.321-00',
      referrerName: 'Pedro',
      source: 'WHATSAPP',
    });
    expect(r.warnings).toEqual([]);
  });
});

describe('importador WhatsApp - bloco', () => {
  it('interpreta o exemplo da especificação', () => {
    const r = parseWhatsAppBlock(BLOCK);
    expect(r.data).toMatchObject({
      fullName: 'Joao Silva Santos',
      cpf: '123.456.789-09',
      birthDate: '1990-03-15',
      whatsapp: '(21) 99999-9999',
      street: 'Rua das Flores',
      number: '123',
      district: 'Centro',
      city: 'Rio',
      state: 'RJ',
      cep: '20745-000',
      reference: 'Portão azul',
      pixKey: '21999999999',
      pixType: 'CELULAR',
      profession: 'Motorista',
      emergencyName: 'Maria Silva',
      emergencyRelation: 'MAE',
      emergencyPhone1: '(21) 97777-7777',
      guarantorName: 'Carlos Pereira',
      guarantorCpf: '987.654.321-00',
      guarantorPhone: '(21) 96666-6666',
      referrerName: 'Pedro da Silva',
      referrerPhone: '(21) 98888-8888',
    });
    expect(r.missing.map((m) => m.key)).toEqual(['complement', 'incomeCents']);
  });

  it('detecta formato automaticamente', () => {
    expect(parseWhatsApp(BLOCK).format).toBe('BLOCO');
    expect(parseWhatsApp(LINE).format).toBe('LINHA');
  });

  it('ficha importada passa na validação e mostra progresso', () => {
    const r = parseWhatsAppBlock(BLOCK);
    const issues = validateClientForm(r.data);
    expect(issues).toEqual([]);
    expect(formProgress(r.data).percent).toBeGreaterThanOrEqual(90);
  });

  it('CPF inválido gera aviso', () => {
    expect(parseWhatsAppBlock('Nome: Ana\nCPF: 123.456.789-00').warnings).toContain('CPF informado é inválido (dígito verificador)');
  });
});
