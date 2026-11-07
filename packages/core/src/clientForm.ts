/**
 * Ficha completa do cliente (5 abas) - modelo compartilhado entre app e API.
 */
import { isValidCEP, isValidCPF, isValidPhone } from './validators';

export type PixType = 'CPF' | 'CELULAR' | 'EMAIL' | 'ALEATORIA' | 'CNPJ';
export type Relation = 'MAE' | 'PAI' | 'ESPOSA' | 'IRMAO' | 'AMIGO' | 'OUTRO';
export type GuarantorRelation = 'AMIGO' | 'PARENTE' | 'PATRAO';
export type ResidenceTime = 'MENOS_6M' | 'DE_6_A_12M' | 'DE_1_A_2A' | 'MAIS_2A';

export const PIX_TYPES: PixType[] = ['CPF', 'CELULAR', 'EMAIL', 'ALEATORIA', 'CNPJ'];
export const RELATIONS: { value: Relation; label: string }[] = [
  { value: 'MAE', label: 'Mãe' },
  { value: 'PAI', label: 'Pai' },
  { value: 'ESPOSA', label: 'Esposa' },
  { value: 'IRMAO', label: 'Irmão' },
  { value: 'AMIGO', label: 'Amigo' },
  { value: 'OUTRO', label: 'Outro' },
];
export const GUARANTOR_RELATIONS: { value: GuarantorRelation; label: string }[] = [
  { value: 'AMIGO', label: 'Amigo' },
  { value: 'PARENTE', label: 'Parente' },
  { value: 'PATRAO', label: 'Patrão' },
];
export const RESIDENCE_TIMES: { value: ResidenceTime; label: string }[] = [
  { value: 'MENOS_6M', label: '< 6 meses' },
  { value: 'DE_6_A_12M', label: '6-12 meses' },
  { value: 'DE_1_A_2A', label: '1-2 anos' },
  { value: 'MAIS_2A', label: '2+ anos' },
];

export interface ClientForm {
  // Aba 1 - Dados pessoais
  fullName: string;
  cpf: string;
  rg?: string | null;
  rgIssuer?: string | null;
  birthDate: string; // ISO
  selfieFileId?: string | null;
  notes?: string | null;
  // Aba 2 - Contato e endereço
  whatsapp: string;
  whatsapp2?: string | null;
  cep: string;
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  city: string;
  state: string;
  reference?: string | null;
  residenceTime?: ResidenceTime | null;
  // Aba 3 - Financeiro
  pixKey: string;
  pixType: PixType;
  profession?: string | null;
  incomeCents?: number | null;
  workplace?: string | null;
  internalScore?: number | null;
  creditLimitCents?: number | null;
  // Aba 4 - Vínculos
  emergencyName: string;
  emergencyRelation: Relation;
  emergencyPhone1: string;
  emergencyPhone2?: string | null;
  hasGuarantor: boolean;
  guarantorName?: string | null;
  guarantorCpf?: string | null;
  guarantorPhone?: string | null;
  guarantorRelation?: GuarantorRelation | null;
  guarantorClientId?: string | null;
  guarantorDocFileId?: string | null;
  referrerName?: string | null;
  referrerPhone?: string | null;
  referrerClientId?: string | null;
  // Meta
  source?: 'MANUAL' | 'WHATSAPP';
  whatsappImportedAt?: string | null;
  lgpdConsent?: boolean;
  responsibleUserId?: string | null;
}

export type ClientFormKey = keyof ClientForm;

export interface FieldDef {
  key: ClientFormKey;
  label: string;
  tab: 1 | 2 | 3 | 4 | 5;
  required: boolean;
}

/** Campos considerados para o progresso "Ficha X% completa" e para o importador. */
export const CLIENT_FIELDS: FieldDef[] = [
  { key: 'fullName', label: 'Nome Completo', tab: 1, required: true },
  { key: 'cpf', label: 'CPF', tab: 1, required: true },
  { key: 'rg', label: 'RG', tab: 1, required: false },
  { key: 'rgIssuer', label: 'Órgão Emissor', tab: 1, required: false },
  { key: 'birthDate', label: 'Data Nascimento', tab: 1, required: true },
  { key: 'whatsapp', label: 'WhatsApp Principal', tab: 2, required: true },
  { key: 'cep', label: 'CEP', tab: 2, required: true },
  { key: 'street', label: 'Rua/Avenida', tab: 2, required: true },
  { key: 'number', label: 'Número', tab: 2, required: true },
  { key: 'complement', label: 'Complemento', tab: 2, required: false },
  { key: 'district', label: 'Bairro', tab: 2, required: true },
  { key: 'city', label: 'Cidade', tab: 2, required: true },
  { key: 'state', label: 'Estado', tab: 2, required: true },
  { key: 'reference', label: 'Ponto Referência', tab: 2, required: false },
  { key: 'pixKey', label: 'Chave PIX', tab: 3, required: true },
  { key: 'profession', label: 'Profissão', tab: 3, required: false },
  { key: 'incomeCents', label: 'Renda', tab: 3, required: false },
  { key: 'emergencyName', label: 'Contato Emergência', tab: 4, required: true },
  { key: 'emergencyPhone1', label: 'Telefone Emergência', tab: 4, required: true },
  { key: 'guarantorName', label: 'Fiador', tab: 4, required: false },
  { key: 'referrerName', label: 'Indicação', tab: 4, required: false },
];

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

export function formProgress(form: Partial<ClientForm>): { percent: number; filled: number; total: number } {
  const relevant = CLIENT_FIELDS.filter((f) => !(f.key.startsWith('guarantor') && form.hasGuarantor === false));
  const count = relevant.filter((f) => filled(form[f.key])).length;
  return { percent: Math.round((count / relevant.length) * 100), filled: count, total: relevant.length };
}

export interface ValidationIssue {
  key: ClientFormKey;
  tab: number;
  message: string;
}

/** Validação completa (Salvar Cliente Completo). Rascunho ignora obrigatórios. */
export function validateClientForm(form: Partial<ClientForm>, opts: { draft?: boolean } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (key: ClientFormKey, tab: number, message: string) => issues.push({ key, tab, message });
  if (!opts.draft) {
    for (const f of CLIENT_FIELDS.filter((x) => x.required))
      if (!filled(form[f.key])) add(f.key, f.tab, `${f.label} é obrigatório`);
    if (!filled(form.pixType)) add('pixType', 3, 'Tipo PIX é obrigatório');
    if (!filled(form.emergencyRelation)) add('emergencyRelation', 4, 'Parentesco é obrigatório');
    if (form.hasGuarantor) {
      if (!filled(form.guarantorName)) add('guarantorName', 4, 'Nome do fiador é obrigatório');
      if (!filled(form.guarantorCpf)) add('guarantorCpf', 4, 'CPF do fiador é obrigatório');
      if (!filled(form.guarantorPhone)) add('guarantorPhone', 4, 'Telefone do fiador é obrigatório');
    }
  } else if (!filled(form.fullName)) add('fullName', 1, 'Informe ao menos o nome para salvar rascunho');
  if (filled(form.cpf) && !isValidCPF(form.cpf!)) add('cpf', 1, 'CPF inválido (dígito verificador)');
  if (filled(form.guarantorCpf) && !isValidCPF(form.guarantorCpf!)) add('guarantorCpf', 4, 'CPF do fiador inválido');
  if (filled(form.cep) && !isValidCEP(form.cep!)) add('cep', 2, 'CEP inválido');
  for (const k of ['whatsapp', 'whatsapp2', 'emergencyPhone1', 'emergencyPhone2', 'guarantorPhone', 'referrerPhone'] as const) {
    const tab = k.startsWith('whats') ? 2 : 4;
    if (filled(form[k]) && !isValidPhone(String(form[k]))) add(k, tab, 'Telefone inválido');
  }
  if (form.internalScore != null && (form.internalScore < 0 || form.internalScore > 10))
    add('internalScore', 3, 'Score interno deve ser entre 0 e 10');
  return issues;
}
