import { Body, Controller, Get, Ip, Param, Post, Put, Query } from '@nestjs/common';
import { ClientForm, formatCEP, onlyDigits, parseWhatsApp } from '@lendcontrol/core';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/auth';
import { ZodPipe } from '../common/util';
import { ClientsService } from './clients.service';

const opt = z.string().nullable().optional();
const formSchema = z
  .object({
    fullName: z.string().max(200),
    cpf: z.string().max(20),
    rg: opt, rgIssuer: opt, birthDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Data inválida').nullable().optional(),
    selfieFileId: opt, notes: z.string().max(5000).nullable().optional(),
    whatsapp: z.string(), whatsapp2: opt, cep: z.string(), street: z.string(), number: z.string(), complement: opt,
    district: z.string(), city: z.string(), state: z.string(), reference: opt, residenceTime: opt,
    pixKey: z.string(), pixType: z.enum(['CPF', 'CELULAR', 'EMAIL', 'ALEATORIA', 'CNPJ']),
    profession: opt, incomeCents: z.number().int().min(0).nullable().optional(), workplace: opt,
    internalScore: z.number().int().min(0).max(10).nullable().optional(),
    creditLimitCents: z.number().int().min(0).nullable().optional(),
    emergencyName: z.string(), emergencyRelation: z.enum(['MAE', 'PAI', 'ESPOSA', 'IRMAO', 'AMIGO', 'OUTRO']),
    emergencyPhone1: z.string(), emergencyPhone2: opt,
    hasGuarantor: z.boolean(), guarantorName: opt, guarantorCpf: opt, guarantorPhone: opt,
    guarantorRelation: z.enum(['AMIGO', 'PARENTE', 'PATRAO']).nullable().optional(),
    guarantorClientId: opt, guarantorDocFileId: opt, referrerName: opt, referrerPhone: opt, referrerClientId: opt,
    source: z.enum(['MANUAL', 'WHATSAPP']).optional(), whatsappImportedAt: opt, lgpdConsent: z.boolean().optional(),
    responsibleUserId: opt,
  })
  .partial();

const saveSchema = z.object({ form: formSchema, draft: z.boolean().optional() });
const unblockSchema = z.object({ password: z.string(), reason: z.string() });
const fidelitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DISCOUNT'), loanId: z.string(), newRatePercent: z.number().min(0).max(1000) }),
  z.object({ kind: z.literal('LIMIT'), newLimitCents: z.number().int().min(0) }),
]);
const attemptSchema = z.object({ type: z.string().min(2).max(40), result: z.string().min(2).max(2000) });

@Controller()
export class ClientsController {
  constructor(private clients: ClientsService) {}

  @Get('clients')
  list(
    @CurrentUser() u: AuthUser,
    @Query('search') search?: string,
    @Query('classificacao') classificacao?: 'BOM' | 'REGULAR' | 'RUIM' | 'PERDA',
    @Query('overdue') overdue?: string,
    @Query('responsibleUserId') responsibleUserId?: string,
    @Query('status') status?: 'RASCUNHO' | 'ATIVO' | 'INATIVO',
  ) {
    return this.clients.list(u, { search, classificacao: classificacao || undefined, overdue: overdue === 'true', responsibleUserId: responsibleUserId || undefined, status: status || undefined });
  }

  @Get('clients/lookup')
  lookup(@CurrentUser() u: AuthUser, @Query('q') q: string) {
    return this.clients.lookup(u, q ?? '');
  }

  @Post('clients/import/parse')
  parse(@Body(new ZodPipe(z.object({ text: z.string().max(10000) }))) b: { text: string }) {
    return parseWhatsApp(b.text);
  }

  @Get('clients/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.clients.detail(u, id);
  }

  @Post('clients')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(saveSchema)) b: z.infer<typeof saveSchema>) {
    return this.clients.create(u, b.form as ClientForm, !!b.draft);
  }

  @Put('clients/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(saveSchema)) b: z.infer<typeof saveSchema>) {
    return this.clients.update(u, id, b.form as Partial<ClientForm>, !!b.draft);
  }

  @Get('clients/:id/cpf')
  cpf(@CurrentUser() u: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.clients.revealCpf(u, id, ip);
  }

  @Post('clients/:id/unblock')
  unblock(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(unblockSchema)) b: z.infer<typeof unblockSchema>) {
    return this.clients.unblock(u, id, b.password, b.reason);
  }

  @Post('clients/:id/fidelity')
  fidelity(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(fidelitySchema)) b: z.infer<typeof fidelitySchema>) {
    return this.clients.fidelity(u, id, b);
  }

  @Post('clients/:id/collection-attempts')
  attempt(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(attemptSchema)) b: z.infer<typeof attemptSchema>) {
    return this.clients.addAttempt(u, id, b.type, b.result);
  }

  /** CEP: ViaCEP com timeout e fallback mock (offline / sem rede). */
  @Get('cep/:cep')
  async cep(@Param('cep') raw: string) {
    const cep = onlyDigits(raw);
    if (cep.length !== 8) return { cep: raw, street: '', district: '', city: '', state: '', found: false };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!j.erro) return { cep: formatCEP(cep), street: j.logradouro ?? '', district: j.bairro ?? '', city: j.localidade ?? '', state: j.uf ?? '', found: true, source: 'viacep' };
    } catch {
      /* cai no mock */
    }
    const mock: Record<string, [string, string, string, string]> = {
      '20745000': ['Rua das Flores', 'Centro', 'Rio de Janeiro', 'RJ'],
      '01001000': ['Praça da Sé', 'Sé', 'São Paulo', 'SP'],
    };
    const m = mock[cep];
    return m
      ? { cep: formatCEP(cep), street: m[0], district: m[1], city: m[2], state: m[3], found: true, source: 'mock' }
      : { cep: formatCEP(cep), street: '', district: '', city: '', state: '', found: false, source: 'mock' };
  }
}
