/**
 * Importador WhatsApp (seção 3): interpreta LINHA ÚNICA (;) ou BLOCO "Chave: valor"
 * e devolve os campos da ficha preenchidos + lista de encontrados/faltantes.
 */
import { brDateToISO } from './dates';
import { CLIENT_FIELDS, ClientForm, ClientFormKey, PixType, Relation } from './clientForm';
import { parseBRL } from './money';
import { formatCEP, formatCPF, formatPhone, isValidCEP, isValidCNPJ, isValidCPF, isValidEmail, isValidPhone, normalizePhone, onlyDigits, RG_ISSUERS, UFS } from './validators';

export interface ImportResult {
  data: Partial<ClientForm>;
  found: { key: ClientFormKey; label: string }[];
  missing: { key: ClientFormKey; label: string }[];
  warnings: string[];
  format: 'LINHA' | 'BLOCO';
}

const LOWER_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

export function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const RELATION_WORDS: Record<string, Relation> = {
  mae: 'MAE', pai: 'PAI', esposa: 'ESPOSA', esposo: 'ESPOSA', marido: 'ESPOSA', irmao: 'IRMAO', irma: 'IRMAO', amigo: 'AMIGO', amiga: 'AMIGO',
};

function detectRelation(text: string): { relation: Relation | null; rest: string } {
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = stripAccents(words[i].replace(/[()]/g, '')).toLowerCase();
    if (RELATION_WORDS[w]) {
      words.splice(i, 1);
      return { relation: RELATION_WORDS[w], rest: words.join(' ') };
    }
  }
  return { relation: null, rest: text };
}

export function detectPixType(value: string, hint?: string): PixType {
  const h = stripAccents(hint ?? '').toLowerCase();
  if (h.includes('cel') || h.includes('tel') || h.includes('fone')) return 'CELULAR';
  if (h.includes('cpf')) return 'CPF';
  if (h.includes('cnpj')) return 'CNPJ';
  if (h.includes('mail')) return 'EMAIL';
  if (h.includes('aleat')) return 'ALEATORIA';
  if (isValidEmail(value)) return 'EMAIL';
  const d = onlyDigits(value);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())) return 'ALEATORIA';
  if (d.length === 14 && isValidCNPJ(d)) return 'CNPJ';
  if (d.length === 11 && isValidPhone(d) && !isValidCPF(d)) return 'CELULAR';
  if (d.length === 11 && isValidCPF(d)) return 'CPF';
  if (isValidPhone(d)) return 'CELULAR';
  return 'ALEATORIA';
}

/** Extrai telefone(s), CPF e nome de um trecho livre: "Carlos Pereira - 987.654.321-00 - 21 96666-6666". */
function extractPersonParts(text: string) {
  let cpf: string | null = null;
  const phones: string[] = [];
  const nameParts: string[] = [];
  const paren = /\(([^)]*)\)/.exec(text);
  const relHint = paren && !/\d{4}/.test(paren[1]) ? paren[1] : '';
  const cleaned = relHint ? text.replace(paren![0], ' ') : text;
  // Separa por " - ", "|", "," e "/" (o hífen sem espaços pertence ao número)
  for (const seg of cleaned.split(/\s[-–|/]\s|,|\|/)) {
    const numMatch = /\+?\(?\d[\d.\-()\s]{7,}\d/.exec(seg);
    if (numMatch) {
      const raw = numMatch[0];
      const d = onlyDigits(raw);
      const looksCpf = /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(raw);
      if (d.length === 11 && isValidCPF(d) && !cpf && (looksCpf || !isValidPhone(d) || phones.length > 0)) cpf = d;
      else if (isValidPhone(d)) phones.push(normalizePhone(d));
      else if (d.length === 11 && isValidCPF(d) && !cpf) cpf = d;
      const rest = seg.replace(raw, ' ').trim();
      if (rest) nameParts.push(rest);
    } else if (seg.trim()) nameParts.push(seg.trim());
  }
  const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  return { name, cpf, phones, relHint };
}

/** "Rua das Flores 123, Centro, Rio - RJ" */
function parseAddress(text: string): Partial<ClientForm> {
  const out: Partial<ClientForm> = {};
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return out;
  const first = parts[0];
  const m = /^(.*?)[\s,]+(?:n[º°o.]?\s*)?(\d+[A-Za-z]?)$/i.exec(first);
  if (m) {
    out.street = m[1].trim();
    out.number = m[2];
  } else out.street = first;
  const rest = parts.slice(1);
  // número pode vir separado: "Rua X, 123, Centro" ou "Rua X, nº 123"
  const numRe = /^(?:n[º°o.]?\s*)?(\d+[A-Za-z]?)$/i;
  if (!out.number && rest.length && numRe.test(rest[0])) out.number = numRe.exec(rest.shift()!)![1];
  if (rest.length) {
    // Último segmento "Cidade - UF" ou "Cidade/UF"
    const last = rest[rest.length - 1];
    const cm = /^(.*?)\s*[-/]\s*([A-Za-z]{2})$/.exec(last);
    if (cm && (UFS as readonly string[]).includes(cm[2].toUpperCase())) {
      out.city = cm[1].trim();
      out.state = cm[2].toUpperCase();
      rest.pop();
    } else if (rest.length >= 2) {
      out.city = rest.pop()!;
    }
    if (rest.length) out.district = rest.shift()!;
    if (rest.length) out.complement = rest.join(', ');
  }
  return out;
}

function parseRG(text: string): Partial<ClientForm> {
  const upper = stripAccents(text).toUpperCase();
  const issuer = RG_ISSUERS.find((i) => upper.includes(stripAccents(i)));
  const num = text.replace(new RegExp(issuer ?? '$^', 'i'), '').replace(/[^\dXx.\-]/g, '').trim();
  const out: Partial<ClientForm> = {};
  if (num) out.rg = num;
  if (issuer) out.rgIssuer = issuer;
  return out;
}

function parsePix(text: string): Partial<ClientForm> {
  const paren = /\(([^)]*)\)/.exec(text);
  let value = text.replace(/\([^)]*\)/g, '').replace(/^\s*pix[:\s]*/i, '').trim();
  const type = detectPixType(value, paren?.[1]);
  if (type === 'CPF' || type === 'CELULAR' || type === 'CNPJ') value = onlyDigits(value);
  return { pixKey: value, pixType: type };
}

function applyEmergency(text: string, out: Partial<ClientForm>) {
  const { name, phones, relHint } = extractPersonParts(text);
  const rel = detectRelation(relHint ? `${name} ${relHint}` : name);
  if (rel.rest.trim()) out.emergencyName = titleCase(rel.rest.replace(/\bpix\b/i, ''));
  out.emergencyRelation = rel.relation ?? 'OUTRO';
  if (phones[0]) out.emergencyPhone1 = formatPhone(phones[0]);
  if (phones[1]) out.emergencyPhone2 = formatPhone(phones[1]);
}

function applyGuarantor(text: string, out: Partial<ClientForm>) {
  const { name, cpf, phones } = extractPersonParts(text);
  const cleanName = name.replace(/\bfiador\b/i, '').trim();
  out.hasGuarantor = true;
  if (cleanName) out.guarantorName = titleCase(cleanName);
  if (cpf) out.guarantorCpf = formatCPF(cpf);
  if (phones[0]) out.guarantorPhone = formatPhone(phones[0]);
}

function applyReferrer(text: string, out: Partial<ClientForm>) {
  const { name, phones } = extractPersonParts(text);
  const cleanName = name.replace(/\bindica[cç][aã]o\b/i, '').trim();
  if (cleanName) out.referrerName = titleCase(cleanName);
  if (phones[0]) out.referrerPhone = formatPhone(phones[0]);
}

function finalize(data: Partial<ClientForm>, format: 'LINHA' | 'BLOCO', warnings: string[]): ImportResult {
  data.source = 'WHATSAPP';
  if (data.hasGuarantor === undefined) data.hasGuarantor = false;
  if (data.cpf && !isValidCPF(data.cpf)) warnings.push('CPF informado é inválido (dígito verificador)');
  if (data.cep && !isValidCEP(data.cep)) warnings.push('CEP informado é inválido');
  if (!data.whatsapp) warnings.push('Telefone (WhatsApp) é obrigatório');
  const has = (k: ClientFormKey) => data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== '';
  const fields = CLIENT_FIELDS.filter((f) => !(f.key.startsWith('guarantor') && !data.hasGuarantor));
  return {
    data,
    format,
    warnings,
    found: fields.filter((f) => has(f.key)).map(({ key, label }) => ({ key, label })),
    missing: fields.filter((f) => !has(f.key)).map(({ key, label }) => ({ key, label })),
  };
}

/**
 * LINHA ÚNICA separada por ";":
 * NOME;CPF;RG ORGAO;NASCIMENTO;WHATSAPP;ENDERECO;CEP;PIX;EMERGENCIA;FIADOR;INDICACAO
 */
export function parseWhatsAppLine(line: string): ImportResult {
  const parts = line.split(';').map((p) => p.trim());
  const data: Partial<ClientForm> = {};
  const warnings: string[] = [];
  const [name, cpf, rg, birth, phone, address, cep, pix, emergency, guarantor, referrer] = parts;
  if (name) data.fullName = titleCase(name);
  if (cpf) data.cpf = formatCPF(cpf);
  if (rg) Object.assign(data, parseRG(rg));
  if (birth) {
    const iso = brDateToISO(birth);
    if (iso) data.birthDate = iso;
    else warnings.push(`Data de nascimento não reconhecida: ${birth}`);
  }
  if (phone) data.whatsapp = formatPhone(phone);
  if (address) Object.assign(data, parseAddress(address));
  if (cep) data.cep = formatCEP(cep);
  if (pix) Object.assign(data, parsePix(pix));
  if (emergency) applyEmergency(emergency, data);
  if (guarantor) applyGuarantor(guarantor, data);
  if (referrer) applyReferrer(referrer, data);
  if (parts.length > 11) warnings.push(`${parts.length - 11} campo(s) extra(s) ignorado(s)`);
  return finalize(data, 'LINHA', warnings);
}

type BlockKey =
  | 'nome' | 'cpf' | 'rg' | 'orgao' | 'nascimento' | 'whatsapp' | 'whatsapp2' | 'endereco' | 'numero' | 'complemento'
  | 'bairro' | 'cidade' | 'estado' | 'cep' | 'referencia' | 'pix' | 'profissao' | 'renda' | 'trabalho' | 'emergencia'
  | 'fiador' | 'indicacao' | 'observacoes';

const BLOCK_SYNONYMS: [RegExp, BlockKey][] = [
  [/^(nome( completo)?|cliente)$/, 'nome'],
  [/^cpf$/, 'cpf'],
  [/^(rg|identidade)$/, 'rg'],
  [/^(orgao( emissor)?|emissor)$/, 'orgao'],
  [/^(nascimento|data( de)? nascimento|nasc|dt nasc)$/, 'nascimento'],
  [/^(whatsapp|whats|zap|telefone|celular|fone|tel)( principal)?$/, 'whatsapp'],
  [/^(whatsapp|telefone|celular) ?(2|secundario)$/, 'whatsapp2'],
  [/^(endereco|end|rua|logradouro)$/, 'endereco'],
  [/^(numero|n|nº|no)$/, 'numero'],
  [/^(complemento|compl)$/, 'complemento'],
  [/^bairro$/, 'bairro'],
  [/^cidade$/, 'cidade'],
  [/^(estado|uf)$/, 'estado'],
  [/^cep$/, 'cep'],
  [/^(ponto( de)? ref(erencia)?|referencia|ref)$/, 'referencia'],
  [/^(pix|chave pix)$/, 'pix'],
  [/^(profissao|ocupacao|trabalho atual)$/, 'profissao'],
  [/^(renda|renda estimada|salario)$/, 'renda'],
  [/^(local( de)? trabalho|empresa|trabalho)$/, 'trabalho'],
  [/^(emergencia|contato( de)? emergencia)$/, 'emergencia'],
  [/^fiador$/, 'fiador'],
  [/^(indicacao|indicado por|quem indicou)$/, 'indicacao'],
  [/^(obs|observacoes|observacao)$/, 'observacoes'],
];

function normalizeKey(k: string): BlockKey | null {
  const n = stripAccents(k).toLowerCase().replace(/[.:]/g, '').replace(/\s+/g, ' ').trim();
  for (const [re, key] of BLOCK_SYNONYMS) if (re.test(n)) return key;
  return null;
}

export function parseWhatsAppBlock(block: string): ImportResult {
  const data: Partial<ClientForm> = {};
  const warnings: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s*•\-_]+/, '').replace(/\*/g, '').trim();
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = normalizeKey(line.slice(0, idx));
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (!key) {
      warnings.push(`Linha ignorada: "${line}"`);
      continue;
    }
    switch (key) {
      case 'nome': data.fullName = titleCase(value); break;
      case 'cpf': data.cpf = formatCPF(value); break;
      case 'rg': Object.assign(data, parseRG(value)); break;
      case 'orgao': data.rgIssuer = value.toUpperCase(); break;
      case 'nascimento': {
        const iso = brDateToISO(value);
        if (iso) data.birthDate = iso;
        else warnings.push(`Data de nascimento não reconhecida: ${value}`);
        break;
      }
      case 'whatsapp': data.whatsapp = formatPhone(value); break;
      case 'whatsapp2': data.whatsapp2 = formatPhone(value); break;
      case 'endereco': Object.assign(data, parseAddress(value)); break;
      case 'numero': data.number = value; break;
      case 'complemento': data.complement = value; break;
      case 'bairro': data.district = value; break;
      case 'cidade': data.city = value; break;
      case 'estado': data.state = value.toUpperCase().slice(0, 2); break;
      case 'cep': data.cep = formatCEP(value); break;
      case 'referencia': data.reference = value; break;
      case 'pix': Object.assign(data, parsePix(value)); break;
      case 'profissao': data.profession = value; break;
      case 'renda': {
        const c = parseBRL(value);
        if (c !== null) data.incomeCents = c;
        break;
      }
      case 'trabalho': data.workplace = value; break;
      case 'emergencia': applyEmergency(value, data); break;
      case 'fiador': applyGuarantor(value, data); break;
      case 'indicacao': applyReferrer(value, data); break;
      case 'observacoes': data.notes = value; break;
    }
  }
  return finalize(data, 'BLOCO', warnings);
}

/** Detecta o formato automaticamente. */
export function parseWhatsApp(text: string): ImportResult {
  const t = text.trim();
  const keyLines = t.split(/\r?\n/).filter((l) => /^[^:]{2,30}:/.test(l.trim())).length;
  return keyLines >= 2 ? parseWhatsAppBlock(t) : parseWhatsAppLine(t);
}
