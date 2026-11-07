import type {
  ClientForm,
  ClientScoreClass,
  CollectionStrategy,
  CreditLockLevel,
  InstallmentView,
  LoanMethod,
  LoanQuote,
  LoanType,
  ScoreResult,
} from '@lendcontrol/core';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR';

export interface WalletDTO {
  capitalDisponivelCents: number;
  capitalEmprestadoCents: number;
  comissaoAPagarCents: number;
  paraRepassarCents: number;
  recebidoClientesCents: number;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  commissionPercent: number;
  revolving: boolean;
  wallet: WalletDTO;
}

export interface LoginResponse {
  accessToken: string;
  user: UserDTO;
}

export interface CreateUserBody {
  name: string;
  email: string;
  password: string;
  role: Role;
  phone?: string;
  commissionPercent?: number;
  revolving?: boolean;
}

export interface Ref {
  id: string;
  name: string;
}

export type ClientStatus = 'RASCUNHO' | 'ATIVO' | 'INATIVO';

export interface ClientListItem {
  id: string;
  fullName: string;
  cpfMasked: string;
  whatsapp: string | null;
  city: string | null;
  status: ClientStatus;
  score: number;
  classificacao: ClientScoreClass;
  pontualidade: number | null;
  diasSemPagar: number;
  isBlocked: boolean;
  responsible: Ref | null;
  activeLoans: number;
  totalEmprestadoCents: number;
  emAbertoCents: number;
  overdueCount: number;
  createdAt: string;
}

export interface ClientCounts {
  all: number;
  BOM: number;
  REGULAR: number;
  RUIM: number;
  PERDA: number;
  atrasados: number;
}

export interface ClientListResponse {
  items: ClientListItem[];
  counts: ClientCounts;
}

export interface ClientLookupItem {
  id: string;
  fullName: string;
  whatsapp: string | null;
  classificacao: ClientScoreClass;
  since: string;
}

export interface CollectionAttemptDTO {
  id: string;
  date: string;
  type: string;
  result: string;
  userName: string;
}

export interface CreditLock {
  level: CreditLockLevel;
  title: string;
  message: string;
}

export interface FidelityInfo {
  limit: { fromCents: number; toCents: number; percent: number };
  discount: { loanId: string; fromRate: number; toRate: number; monthlySavingsCents: number } | null;
  summary: string;
}

export interface HistoryItem {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  userName: string | null;
}

export interface ClientDetail extends ClientListItem {
  form: ClientForm;
  progress: { percent: number; filled: number; total: number };
  whatsappImportedAt: string | null;
  lgpdConsentAt: string | null;
  scoreDetail: ScoreResult;
  creditLock: CreditLock;
  fidelity: FidelityInfo | null;
  strategies: CollectionStrategy[];
  loans: LoanSummary[];
  history: HistoryItem[];
  collectionAttempts: CollectionAttemptDTO[];
  guarantorClient: { id: string; fullName: string } | null;
  referrerClient: { id: string; fullName: string; since: string } | null;
}

export interface CepResult {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
  found?: boolean;
  source?: string;
}

export type FidelityBody = { kind: 'DISCOUNT'; loanId: string; newRatePercent: number } | { kind: 'LIMIT'; newLimitCents: number };

export type LoanStatus = 'ATIVO' | 'QUITADO' | 'PERDA' | 'CANCELADO';

export interface CreateLoanBody {
  clientId: string;
  lenderUserId?: string;
  type: LoanType;
  method: LoanMethod;
  principalCents: number;
  ratePercent: number;
  multaDiaPercent: number;
  releaseDate: string;
  installmentsCount?: number;
  riskAcknowledged?: boolean;
  notes?: string;
}

export interface LoanPreview {
  installments: InstallmentView[];
  dueDate: string;
  totalInterestCents?: number;
}

export interface LoanSummary {
  id: string;
  code: number;
  clientId: string;
  clientName: string;
  lender: Ref;
  funder: Ref;
  type: LoanType | string;
  method: LoanMethod | string;
  principalCents: number;
  ratePercent: number;
  multaDiaPercent: number;
  releaseDate: string;
  dueDate: string;
  status: LoanStatus;
  saldoDevedorCents: number;
  nextDueDate: string | null;
  nextValueCents: number | null;
  overdueCount: number;
  diasSemPagar: number;
  quitadoEm: string | null;
  installmentsCount?: number | null;
  riskAcknowledged?: boolean;
  notes?: string | null;
  createdAt?: string;
}

export type PaymentType = 'JUROS' | 'QUITACAO' | 'AMORTIZACAO' | 'PARCELA';
export type ApprovalStatus = 'AGUARDANDO_APROVACAO' | 'APROVADO' | 'REJEITADO';

export interface PaymentDTO {
  id: string;
  loanId: string;
  loanCode: number;
  clientId: string;
  clientName: string;
  type: PaymentType | string;
  status: ApprovalStatus;
  valueCents: number;
  expectedValueCents: number | null;
  paidAt: string;
  installmentNumber: number | null;
  comprovanteFileId: string | null;
  notes: string | null;
  createdBy: Ref;
  approvedBy: Ref | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  resultMessage: string | null;
  allocation: {
    principalCents: number;
    interestCents: number;
    fineCents: number;
    extraCents: number;
    commissionCents: number;
  } | null;
  createdAt: string;
}

export interface LoanDetail extends LoanSummary {
  installments: (InstallmentView & { id: string })[];
  quote: LoanQuote;
  payments: PaymentDTO[];
  client: ClientListItem;
}

export interface CreatePaymentBody {
  loanId: string;
  type: PaymentType;
  amountCents: number;
  paidAt: string;
  installmentNumber?: number;
  comprovanteFileId?: string;
  notes?: string;
}

export interface FileDTO {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface SignedUrl {
  url: string;
  expiresAt: string;
}

export interface LedgerEntry {
  id: string;
  type: string;
  amountCents: number;
  description: string;
  createdAt: string;
  loanId: string | null;
  paymentId: string | null;
  transferId: string | null;
}

export type TransferType = 'REPASSE_CAPITAL' | 'REPASSE_LUCRO' | 'DEVOLUCAO_CAPITAL' | 'PAGAMENTO_COMISSAO';

export interface TransferDTO {
  id: string;
  type: TransferType | string;
  status: ApprovalStatus | string;
  valueCents: number;
  notes: string | null;
  from: Ref;
  to: Ref;
  approvedBy: Ref | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface CreateTransferBody {
  type: TransferType;
  valueCents: number;
  toUserId?: string;
  notes?: string;
}

export interface NotificationDTO {
  id: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface DashboardDTO {
  asOf?: string;
  totalClients?: number;
  activeLoans?: number;
  capitalTotalCents: number;
  capitalComFuncionariosCents: number;
  totalEmprestadoCents: number;
  totalAReceberCents: number;
  totalEmPerdaCents: number;
  jurosRecebidosMesCents: number;
  repassePendenteCents: number;
  comissaoAPagarCents: number;
  pendingApprovals: { payments: number; transfers: number };
  scoreCounts: { BOM: number; REGULAR: number; RUIM: number; PERDA: number };
  overdueClients: number;
  topBons: ClientListItem[];
  topPiores: ClientListItem[];
  upcoming: { loanId: string; clientName: string; dueDate: string; valueCents: number; number: number }[];
}
