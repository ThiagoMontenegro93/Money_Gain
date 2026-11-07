/**
 * Seed: 3 usuários (dono, gestor, funcionário) + 6 clientes de teste reais com
 * históricos que geram as 4 classificações (BOM, REGULAR, RUIM, PERDA).
 * Usa os próprios serviços da API (mesmas regras do sistema). Idempotente: limpa e recria.
 *
 *   pnpm --filter @lendcontrol/api prisma:seed
 */
import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath))
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }

const PASSWORD = 'Lend@2026';

async function main() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { ClientsService } = await import('../src/clients/clients.service');
  const { LoansService } = await import('../src/loans/loans');
  const { PaymentsService } = await import('../src/payments/payments');
  const { WalletsService } = await import('../src/wallets/wallets');
  const { JobsService } = await import('../src/jobs/jobs');
  const bcrypt = await import('bcryptjs');
  const { addMonthsAnchored, addDays } = await import('@lendcontrol/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const clients = app.get(ClientsService);
  const loans = app.get(LoansService);
  const payments = app.get(PaymentsService);
  const wallets = app.get(WalletsService);

  console.log('Limpando dados...');
  await prisma.$executeRawUnsafe(
    `TRUNCATE "MessageLog","CashLedger","ClientReceipt","Payment","Installment","Loan","CapitalTransfer","DocumentViewLog","Document","CollectionAttempt","ClientHistory","Client","StoredFile","AuditLog","Notification","BackupLog","Setting","User" RESTART IDENTITY CASCADE`,
  );

  const hash = await bcrypt.hash(PASSWORD, 10);
  const thiago = await prisma.user.create({ data: { name: 'Thiago', email: 'thiago@lendcontrol.app', role: 'SUPER_ADMIN', passwordHash: hash, phone: '(21) 99999-0001', pixKey: 'thiago.pix@lendcontrol.app' } });
  const gestor = await prisma.user.create({ data: { name: 'Gestor', email: 'gestor@lendcontrol.app', role: 'ADMIN', passwordHash: hash } });
  const carlos = await prisma.user.create({ data: { name: 'Carlos', email: 'carlos@lendcontrol.app', role: 'OPERATOR', passwordHash: hash, commissionPercent: 30, phone: '(21) 99999-0003', pixKey: '21999990003' } });
  const T = { id: thiago.id, role: thiago.role, name: thiago.name };
  const C = { id: carlos.id, role: carlos.role, name: carlos.name };
  void gestor;

  // Dono repassa R$ 10.000 para o Carlos emprestar
  await wallets.create(T, { type: 'REPASSE_CAPITAL', valueCents: 1_000_000, toUserId: carlos.id, notes: 'Capital inicial' });

  const baseForm = (over: Record<string, unknown>) => ({
    rgIssuer: 'SSP', cep: '20745-000', street: 'Rua das Flores', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ',
    pixType: 'CPF' as const, emergencyRelation: 'MAE' as const, hasGuarantor: false, lgpdConsent: true, residenceTime: 'MAIS_2A' as const,
    ...over,
  });

  const mk = (user: typeof T, over: Record<string, unknown>) => clients.create(user, baseForm(over) as never, false);

  console.log('Criando clientes...');
  const pedro = await mk(T, { fullName: 'Pedro da Silva', cpf: '529.982.247-25', birthDate: '1985-06-10', whatsapp: '(21) 98888-8888', number: '45', pixKey: '52998224725', profession: 'Comerciante', emergencyName: 'Rita da Silva', emergencyPhone1: '(21) 97000-1111', incomeCents: 450_000 });
  const ana = await mk(C, { fullName: 'Ana Paula Ribeiro', cpf: '111.444.777-35', birthDate: '1992-01-20', whatsapp: '(21) 98111-2222', number: '210', pixKey: 'ana.ribeiro@email.com', pixType: 'EMAIL', profession: 'Enfermeira', emergencyName: 'José Ribeiro', emergencyRelation: 'PAI', emergencyPhone1: '(21) 97111-3333', incomeCents: 520_000, referrerName: 'Pedro da Silva', referrerPhone: '(21) 98888-8888', referrerClientId: pedro.id });
  const bruno = await mk(C, { fullName: 'Bruno Costa Lima', cpf: '390.533.447-05', birthDate: '1988-09-02', whatsapp: '(21) 98222-3333', number: '18', complement: 'Apto 302', pixKey: '21982223333', pixType: 'CELULAR', profession: 'Motoboy', emergencyName: 'Carla Lima', emergencyRelation: 'ESPOSA', emergencyPhone1: '(21) 97222-4444', incomeCents: 300_000 });
  const joao = await mk(C, { fullName: 'Joao Silva Santos', cpf: '123.456.789-09', rg: '1234567', birthDate: '1990-03-15', whatsapp: '(21) 99999-9999', number: '123', reference: 'Portão azul', pixKey: '21999999999', pixType: 'CELULAR', profession: 'Motorista', emergencyName: 'Maria Silva', emergencyPhone1: '(21) 97777-7777', hasGuarantor: true, guarantorName: 'Carlos Pereira', guarantorCpf: '987.654.321-00', guarantorPhone: '(21) 96666-6666', guarantorRelation: 'AMIGO', referrerName: 'Pedro da Silva', referrerPhone: '(21) 98888-8888', referrerClientId: pedro.id, source: 'WHATSAPP' });
  const marcos = await mk(C, { fullName: 'Marcos Antonio Souza', cpf: '714.602.380-01', birthDate: '1979-11-30', whatsapp: '(21) 98333-4444', number: '7', reference: 'Casa de esquina, muro verde', pixKey: '71460238001', profession: 'Pedreiro', emergencyName: 'Lucia Souza', emergencyRelation: 'IRMAO', emergencyPhone1: '(21) 97333-5555', hasGuarantor: true, guarantorName: 'Roberto Alves', guarantorCpf: '153.509.460-56', guarantorPhone: '(21) 96333-6666', guarantorRelation: 'PARENTE' });
  const fernanda = await mk(T, { fullName: 'Fernanda Oliveira', cpf: '862.385.310-53', birthDate: '1995-04-08', whatsapp: '(21) 98444-5555', number: '99', pixKey: '86238531053', profession: 'Professora', emergencyName: 'Sonia Oliveira', emergencyPhone1: '(21) 97444-6666', incomeCents: 610_000 });

  // ---------- helpers ----------
  const pay = async (loanId: string, type: 'JUROS' | 'QUITACAO' | 'PARCELA', paidAt: string, by = C) => {
    const q = await loans.quote(T, loanId, paidAt);
    const amount = type === 'JUROS' ? q.interestOnlyCents! : type === 'PARCELA' ? q.installmentCents! : q.payoff!.amountCents;
    const p = await payments.create(by, { loanId, type, amountCents: amount, paidAt, comprovanteFileId: undefined as never });
    return payments.approve(T, p.id, PASSWORD);
  };
  // Seed: operador lança sem comprovante (dados de teste); em produção o comprovante é obrigatório
  const origCreate = payments.create.bind(payments);
  payments.create = ((u: typeof C, b: Parameters<typeof origCreate>[1]) => origCreate({ ...u, role: 'ADMIN' as never }, b)) as typeof payments.create;

  const loan = (user: typeof C, clientId: string, principalCents: number, ratePercent: number, releaseDate: string, extra: Record<string, unknown> = {}) =>
    loans.create(user, { clientId, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents, ratePercent, multaDiaPercent: 1, releaseDate, riskAcknowledged: true, ...extra } as never);

  console.log('Criando empréstimos e históricos de pagamento...');
  // Ana (BOM): R$1.000 a 10% desde 30/04, pagou juros sempre em dia
  const la = await loan(C, ana.id, 100_000, 10, '2026-04-30');
  for (let n = 1; n <= 6; n++) await pay(la.id, 'JUROS', addMonthsAnchored('2026-04-30', n));

  // Fernanda (BOM): empréstimo do dono, juros em dia e quitação; depois novo empréstimo ativo
  const lf = await loan(T, fernanda.id, 200_000, 8, '2026-05-15');
  for (let n = 1; n <= 3; n++) await pay(lf.id, 'JUROS', addMonthsAnchored('2026-05-15', n), T);
  await pay(lf.id, 'QUITACAO', addMonthsAnchored('2026-05-15', 4), T);
  const lf2 = await loan(T, fernanda.id, 150_000, 8, '2026-10-01');
  void lf2;

  // Bruno (REGULAR): semanal 5% com pequenos atrasos
  const lb = await loan(C, bruno.id, 50_000, 5, '2026-09-07', { method: 'WEEKLY' });
  await pay(lb.id, 'JUROS', '2026-09-14');
  await pay(lb.id, 'JUROS', '2026-09-23'); // 2 dias de atraso
  await pay(lb.id, 'JUROS', '2026-09-28');
  await pay(lb.id, 'JUROS', '2026-10-08'); // 3 dias
  await pay(lb.id, 'JUROS', '2026-10-12');
  await pay(lb.id, 'JUROS', '2026-10-19');
  await pay(lb.id, 'JUROS', '2026-10-26');
  await pay(lb.id, 'JUROS', '2026-11-02');

  // João (RUIM): atrasa sempre
  const lj = await loan(C, joao.id, 100_000, 10, '2026-06-30');
  await pay(lj.id, 'JUROS', '2026-08-12'); // 13 dias
  await pay(lj.id, 'JUROS', '2026-09-20'); // 21 dias
  // parcela de 30/09 em aberto

  // Marcos (PERDA): pagou só uma vez em 01/04 e sumiu
  const lm = await loan(C, marcos.id, 250_000, 10, '2026-03-01');
  await pay(lm.id, 'JUROS', '2026-04-01');

  console.log('Rodando rotina diária (multa + score + checkPerda)...');
  const r = await app.get(JobsService).run('seed');
  console.log(r);

  const summary = await prisma.client.findMany({ select: { fullName: true, score: true, classificacao: true, isBlocked: true }, orderBy: { score: 'desc' } });
  console.table(summary);
  const w = await prisma.user.findUniqueOrThrow({ where: { id: carlos.id } });
  console.log('Carteira Carlos:', { disponivel: w.capitalDisponivel.toString(), emprestado: w.capitalEmprestado.toString(), paraRepassar: w.paraRepassar.toString(), comissao: w.comissaoAPagar.toString() });
  console.log(`\nUsuários: thiago@lendcontrol.app / gestor@lendcontrol.app / carlos@lendcontrol.app  (senha ${PASSWORD})`);
  void addDays;
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
