# LendControl Pro V6.5 — Contrato da API (Fases 1, 2 e 3)

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
  upcoming: { loanId: string; clientName: string; dueDate: string; valueCents: number; number: number }[]; // parcelas em aberto até hoje+7 dias (inclui atrasadas), ordenadas por vencimento
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
  activeLoans: number; totalEmprestadoCents: number; emAbertoCents: number /* dívida atualizada (soma payoffCents) */; overdueCount: number;
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
  saldoDevedorCents: number; payoffCents: number /* dívida atualizada p/ quitar hoje */; nextDueDate: string | null; nextValueCents: number | null;
  overdueCount: number; diasSemPagar: number; quitadoEm: string | null;
}
interface LoanDetail extends LoanSummary {
  installments: (InstallmentView & { id: string })[]; // InstallmentView do core + id
  quote: LoanQuote;                                    // asOf = hoje
  payments: PaymentDTO[];
  client: ClientListItem;
}
```

### Opções do empréstimo (amortização e multa diária)
| GET | /loans/settings | padrão geral `{ allowAmortization, allowLateFee, multaDiaPercent }` |
| PUT | /loans/settings | (SUPER_ADMIN) salva o padrão |
| PATCH | /loans/:id/options | (ADMIN+) `{ allowAmortization?, allowLateFee?, multaDiaPercent? }` — ex.: perdoar a multa; recalcula as parcelas em aberto |

`POST /loans` e `/loans/preview` aceitam `allowAmortization` e `allowLateFee` (opcionais, padrão geral). Sem multa, `multaDiaPercent` vira 0
e o atraso só conta para o score. `AMORTIZACAO` em empréstimo que não aceita é recusado (400 `AMORTIZATION_DISABLED`).

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

## Usuários (Fase 2)
| PUT | /users/me | `{ phone?, pixKey?, currentPassword?, newPassword? }` — trocar senha exige a senha atual |
| PUT | /users/:id | (SUPER_ADMIN) `{ name?, phone?, pixKey?, role?, isActive?, commissionPercent?, revolving? }` — não pode desativar nem rebaixar a si mesmo |

A chave PIX do credor entra em `{pix_chave}` nas mensagens de cobrança.

## WhatsApp (Fase 2)
| GET | /messaging/config | (ADMIN+) configuração sem segredos: `hasApiKey`, `hasMetaToken`, `queue` (`BULLMQ` ou `MEMORIA`) |
| PUT | /messaging/config | (SUPER_ADMIN) `{ enabled, provider: EVOLUTION\|META\|LINK, baseUrl, instance, apiKey, metaPhoneNumberId, metaToken, windowStart, windowEnd, sendTime, autoPaymentOk, notifyGuarantorD7, blacklist[] }` (parcial). Segredo vazio/omitido mantém o atual; `null` apaga |
| GET | /messaging/templates | `{ key, label, text, isDefault, placeholders }[]` |
| PUT | /messaging/templates/:key | (SUPER_ADMIN) `{ text }`; `text: null` restaura o padrão |
| GET | /messaging/logs?clientId=&status=&limit= | histórico (operador vê só os próprios clientes) |
| GET | /messaging/status | contagem por status e modo da fila |
| POST | /messaging/scan | (SUPER_ADMIN) roda a varredura do dia agora (normalmente às 09:00) |
| POST | /messaging/test | (SUPER_ADMIN) `{ phone, text }` envio direto |
| POST | /messaging/:id/retry | (ADMIN+) reenvia mensagem com `FALHOU` |
| POST | /clients/:id/collection-message | `{ target: CLIENTE\|FIADOR }` → log com `waLink` (cobrança firme manual) |

Status: `PENDENTE`, `ENVIADO`, `FALHOU`, `LINK_GERADO` (canal manual wa.me), `BLOQUEADO` (blacklist/opt-out/telefone inválido), `CANCELADO` (parcela já paga).
Gatilhos: D-2, D0, D+1, D+3, D+7 (+ fiador), Pagamento OK na aprovação. Chave de deduplicação por parcela + gatilho + dia.
Fora da janela (padrão 08:00–20:00, America/Sao_Paulo) a mensagem é adiada para a próxima abertura. 3 tentativas com espera exponencial (60 s).

## Documentos, comprovantes do cliente e cobrança (Fase 2)
| GET/POST | /clients/:id/documents | POST `{ type, fileId, expiryDate?, notes? }` |
| PATCH | /documents/:id | `{ isVerified?, expiryDate?, notes? }` (verificar: ADMIN+) |
| DELETE | /documents/:id | (ADMIN+) |
| GET | /documents/:id/url | URL assinada de 5 min; registra visualização (LGPD) |
| GET | /documents/raw/:id?… | imagem com marca d'água (nome de quem viu + data) e selo VERIFICADO, em JPEG; PDF sem alteração |
| GET/POST | /clients/:id/receipts | POST `{ fileId, sentAt, informedValueCents?, notes? }`; se houver exatamente 1 pagamento pendente, vincula automaticamente |
| POST | /receipts/:id/check | (ADMIN+) `{ paymentId? }` marca como conferido |
| GET | /clients/:id/collection-letter.pdf | carta de cobrança (registra tentativa CARTA) |
| GET | /clients/:id/dossier.pdf | (ADMIN+) dossiê jurídico (registra tentativa JURIDICO) |
| POST | /clients/:id/negativate | (ADMIN+) `{ mark }` |
| PUT | /clients/:id/whatsapp-opt-out | `{ optOut }` |

Status do documento: `VERIFICADO`, `PENDENTE`, `VENCIDO` (validade passou).

## Backup e restauração (Fase 3, só SUPER_ADMIN)
| GET | /backups | `{ backups: últimos 10, restores: últimas 10 restaurações, smtpConfigured }` |
| POST | /backups | gera backup agora |
| GET | /backups/:id/download | planilha `.xlsx` |
| POST | /backups/:id/encrypted | `{ password }` (mín. 8) → arquivo `.lcbak` (AES-256-GCM, chave derivada com scrypt) |
| POST | /backups/:id/email | envia o backup para os e-mails configurados |
| GET/PUT | /backups/settings | `{ enabled, email, extraEmails[] }` |
| POST | /backups/settings/test | gera um backup e envia agora ("Testar envio agora") |
| POST | /backups/restore/preview | multipart `file` (+ `filePassword` se `.lcbak`) → `{ valid, token, summary, counts, distribution[], errors[], warnings[], offlinePayments[] }` |
| POST | /backups/restore | `{ token, password }` (senha do Super Admin) → `{ message, safetyBackupId, counts, offlinePaymentsCreated[], offlinePaymentsSkipped[] }` |

Automático toda segunda 08:00 (America/Sao_Paulo); se o e-mail estiver ativo, envia em seguida. O token da validação vale 30 minutos e é de uso único.

## Notificações
| GET | /notifications | `{ id, title, message, readAt, createdAt }[]` |
| POST | /notifications/:id/read | — |

## Usuários de teste (seed)
| E-mail | Senha | Papel |
|---|---|---|
| thiago@lendcontrol.app | Lend@2026 | SUPER_ADMIN (dono) |
| gestor@lendcontrol.app | Lend@2026 | ADMIN |
| carlos@lendcontrol.app | Lend@2026 | OPERATOR (funcionário, comissão 30%) |
