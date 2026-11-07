# LendControl Pro V6.5 — Contrato da API (Fase 1)

Base: `http://localhost:3000/api` · Autenticação: `Authorization: Bearer <accessToken>`.

**Convenções**
- Todo valor monetário é **inteiro em centavos** com sufixo `Cents` (ex.: `principalCents: 100000` = R$ 1.000,00).
- Taxas em % (`ratePercent: 10` = 10% por período do método).
- Datas "de dia" em ISO `YYYY-MM-DD`; carimbos de tempo em ISO completo.
- Erros: `{ statusCode, message, code? }` (HTTP 400 validação/regra, 401, 403, 404, 409 conflito).
- Tipos de domínio (`ClientForm`, `ImportResult`, `InstallmentView`, `LoanQuote`, `CreditLockLevel`...) vêm de `@lendcontrol/core`.

## Auth
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | /auth/login | `{ email, password }` | `{ accessToken, user: UserDTO }` |
| GET | /auth/me | — | `UserDTO` |

```ts
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';
interface UserDTO {
  id: string; name: string; email: string; phone: string | null; role: Role; isActive: boolean;
  commissionPercent: number; revolving: boolean;
  wallet: WalletDTO;
}
interface WalletDTO {
  capitalDisponivelCents: number; capitalEmprestadoCents: number; comissaoAPagarCents: number;
  paraRepassarCents: number; recebidoClientesCents: number;
}
```

## Usuários / Equipe
| GET | /users | (ADMIN+) | `UserDTO[]` |
| POST | /users | (SUPER_ADMIN) `{ name, email, password, role, phone?, commissionPercent?, revolving? }` | `UserDTO` |

## Dashboard
`GET /dashboard` →
```ts
{
  capitalTotalCents: number;          // capital emprestado ativo + disponível nas carteiras
  capitalComFuncionariosCents: number;// disponível + emprestado dos OPERATORs
  totalEmprestadoCents: number;       // soma saldo devedor dos empréstimos ativos
  totalAReceberCents: number;         // soma valores atualizados das parcelas pendentes vencidas + quitação prevista
  totalEmPerdaCents: number;
  jurosRecebidosMesCents: number;
  repassePendenteCents: number;       // soma paraRepassar
  comissaoAPagarCents: number;
  pendingApprovals: { payments: number; transfers: number };
  scoreCounts: { BOM: number; REGULAR: number; RUIM: number; PERDA: number };
  overdueClients: number;
  topBons: ClientListItem[];  // top 5
  topPiores: ClientListItem[];// top 5 (ação urgente)
  upcoming: { loanId: string; clientName: string; dueDate: string; valueCents: number; number: number }[]; // próximos 7 dias
}
```
Para OPERATOR os números são restritos aos seus empréstimos/clientes.

## Clientes
| GET | /clients?search=&classificacao=BOM\|REGULAR\|RUIM\|PERDA&overdue=true&responsibleUserId=&status= | `{ items: ClientListItem[], counts: { all, BOM, REGULAR, RUIM, PERDA, atrasados } }` (ordenado BOM→PERDA, depois nome) |
| GET | /clients/lookup?q= | `{ id, fullName, whatsapp, classificacao, since }[]` (busca para fiador / indicação, máx. 10) |
| GET | /clients/:id | `ClientDetail` |
| POST | /clients | `{ form: ClientForm, draft?: boolean }` → `ClientDetail` |
| PUT | /clients/:id | `{ form: Partial<ClientForm>, draft?: boolean }` → `ClientDetail` |
| GET | /clients/:id/cpf | `{ cpf, guarantorCpf }` (revela CPF completo; registra auditoria LGPD) |
| POST | /clients/import/parse | `{ text }` → `ImportResult` (mesmo resultado de `parseWhatsApp` do core) |
| POST | /clients/:id/unblock | (SUPER_ADMIN) `{ password, reason }` → `ClientDetail` |
| POST | /clients/:id/fidelity | `{ kind: 'DISCOUNT', loanId, newRatePercent }` ou `{ kind: 'LIMIT', newLimitCents }` → `ClientDetail` |
| POST | /clients/:id/collection-attempts | `{ type, result }` → `CollectionAttemptDTO` |
| GET | /cep/:cep | `{ cep, street, district, city, state }` (ViaCEP com fallback mock) |

```ts
interface ClientListItem {
  id: string; fullName: string; cpfMasked: string; whatsapp: string | null; city: string | null;
  status: 'RASCUNHO' | 'ATIVO' | 'INATIVO';
  score: number; classificacao: 'BOM'|'REGULAR'|'RUIM'|'PERDA'; pontualidade: number | null;
  diasSemPagar: number; isBlocked: boolean;
  responsible: { id: string; name: string } | null;
  activeLoans: number; totalEmprestadoCents: number; emAbertoCents: number; overdueCount: number;
  createdAt: string;
}
interface ClientDetail extends ClientListItem {
  form: ClientForm;              // cpf / guarantorCpf vêm MASCARADOS; use /clients/:id/cpf para revelar
  progress: { percent: number; filled: number; total: number };
  whatsappImportedAt: string | null;
  lgpdConsentAt: string | null;
  scoreDetail: ScoreResult;      // de @lendcontrol/core
  creditLock: { level: 'OK'|'WARNING'|'BLOCKED'; title: string; message: string };
  fidelity: null | {             // só para BOM
    limit: { fromCents: number; toCents: number; percent: number };
    discount: { loanId: string; fromRate: number; toRate: number; monthlySavingsCents: number } | null;
    summary: string;             // "Cliente bom há 8 meses, 12 parcelas pagas em dia, 0 atrasos"
  };
  strategies: CollectionStrategy[]; // de @lendcontrol/core (RUIM / PERDA)
  loans: LoanSummary[];
  history: { id: string; type: string; message: string; createdAt: string; userName: string | null }[];
  collectionAttempts: CollectionAttemptDTO[];
  guarantorClient: { id: string; fullName: string } | null;
  referrerClient: { id: string; fullName: string; since: string } | null;
}
interface CollectionAttemptDTO { id: string; date: string; type: string; result: string; userName: string }
```

## Empréstimos
| POST | /loans/preview | `CreateLoanBody` (sem clientId) → `{ installments: InstallmentView[], dueDate }` |
| GET | /loans/credit-check?clientId= | `{ level, title, message }` |
| POST | /loans | `CreateLoanBody` → `LoanDetail` (400 `CREDIT_BLOCKED` se bloqueado; 400 `RISK_NOT_ACKNOWLEDGED` se RUIM sem `riskAcknowledged: true`; 400 `INSUFFICIENT_CAPITAL` se a carteira do funcionário não cobre) |
| GET | /loans?clientId=&status=&lenderUserId= | `LoanSummary[]` |
| GET | /loans/:id | `LoanDetail` |
| GET | /loans/:id/quote?asOf=YYYY-MM-DD | `LoanQuote` (Simular Quitação) |

```ts
interface CreateLoanBody {
  clientId: string; lenderUserId?: string;   // default: usuário logado
  type: 'INTEREST_ONLY' | 'FIXED_INSTALLMENT'; method: 'DAILY'|'WEEKLY'|'BIWEEKLY'|'MONTHLY';
  principalCents: number; ratePercent: number; multaDiaPercent: number; releaseDate: string;
  installmentsCount?: number; riskAcknowledged?: boolean; notes?: string;
}
interface LoanSummary {
  id: string; code: number; clientId: string; clientName: string;
  lender: { id: string; name: string }; funder: { id: string; name: string };
  type: string; method: string; principalCents: number; ratePercent: number; multaDiaPercent: number;
  releaseDate: string; dueDate: string; status: 'ATIVO'|'QUITADO'|'PERDA'|'CANCELADO';
  saldoDevedorCents: number; nextDueDate: string | null; nextValueCents: number | null;
  overdueCount: number; diasSemPagar: number; quitadoEm: string | null;
}
interface LoanDetail extends LoanSummary {
  installments: (InstallmentView & { id: string })[]; // InstallmentView do core + id
  quote: LoanQuote;                                    // asOf = hoje
  payments: PaymentDTO[];
  client: ClientListItem;
}
```

## Pagamentos (trava de aprovação)
| POST | /payments | `{ loanId, type: 'JUROS'\|'QUITACAO'\|'AMORTIZACAO'\|'PARCELA', amountCents, paidAt, installmentNumber?, comprovanteFileId?, notes? }` → `PaymentDTO` com status `AGUARDANDO_APROVACAO` (valida contra o motor; 409 se já existe pagamento pendente no empréstimo) |
| GET | /payments?status=&loanId= | `PaymentDTO[]` |
| POST | /payments/:id/approve | (ADMIN+) `{ password }` → `PaymentDTO` (aplica motor, razão, carteira, comissão, score). Quem lançou não pode aprovar (exceto SUPER_ADMIN). |
| POST | /payments/:id/reject | (ADMIN+) `{ reason }` → `PaymentDTO` |

```ts
interface PaymentDTO {
  id: string; loanId: string; loanCode: number; clientId: string; clientName: string;
  type: string; status: 'AGUARDANDO_APROVACAO'|'APROVADO'|'REJEITADO';
  valueCents: number; expectedValueCents: number | null; paidAt: string;
  installmentNumber: number | null; comprovanteFileId: string | null; notes: string | null;
  createdBy: { id: string; name: string }; approvedBy: { id: string; name: string } | null;
  approvedAt: string | null; rejectionReason: string | null; resultMessage: string | null;
  allocation: { principalCents; interestCents; fineCents; extraCents; commissionCents } | null;
  createdAt: string;
}
```

## Arquivos privados (comprovantes, documentos)
| POST | /files | multipart `file` (imagem/PDF, máx. 10 MB) → `{ id, originalName, mimeType, size }` |
| GET | /files/:id/url | `{ url, expiresAt }` — URL assinada válida por 5 minutos |
| GET | /files/raw/:id?exp=&sig= | conteúdo do arquivo (sem Bearer; só com assinatura válida) |

## Carteiras e repasses (re-empréstimo)
| GET | /wallets | (ADMIN+) `UserDTO[]` dos funcionários; OPERATOR recebe só o próprio |
| GET | /ledger?userId= | `{ id, type, amountCents, description, createdAt, loanId, paymentId, transferId }[]` (últimos 200) |
| POST | /transfers | `{ type, valueCents, toUserId?, notes? }` → `TransferDTO` |
| GET | /transfers?status= | `TransferDTO[]` |
| POST | /transfers/:id/approve | (ADMIN+) `{ password }` |
| POST | /transfers/:id/reject | (ADMIN+) `{ reason }` |

Regras: `REPASSE_CAPITAL` (SUPER_ADMIN → funcionário, aprovado na hora, credita `capitalDisponivel`);
`REPASSE_LUCRO` (funcionário → dono, valor ≤ `paraRepassar`, aguarda aprovação);
`DEVOLUCAO_CAPITAL` (funcionário → dono, valor ≤ `capitalDisponivel`, aguarda aprovação);
`PAGAMENTO_COMISSAO` (SUPER_ADMIN → funcionário, valor ≤ `comissaoAPagar`, aprovado na hora).

```ts
interface TransferDTO {
  id: string; type: string; status: string; valueCents: number; notes: string | null;
  from: { id: string; name: string }; to: { id: string; name: string };
  approvedBy: { id: string; name: string } | null; approvedAt: string | null; rejectionReason: string | null;
  createdAt: string;
}
```

## Notificações
| GET | /notifications | `{ id, title, message, readAt, createdAt }[]` |
| POST | /notifications/:id/read | — |

## Usuários de teste (seed)
| E-mail | Senha | Papel |
|---|---|---|
| thiago@lendcontrol.app | Lend@2026 | SUPER_ADMIN (dono) |
| gestor@lendcontrol.app | Lend@2026 | ADMIN |
| carlos@lendcontrol.app | Lend@2026 | OPERATOR (funcionário, comissão 30%) |
