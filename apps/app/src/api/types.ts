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
  pixKey?: string | null;
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
  whatsappOptOut?: boolean;
  negativadoEm?: string | null;
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
  allowAmortization?: boolean;
  allowLateFee?: boolean;
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
  allowAmortization: boolean;
  allowLateFee: boolean;
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

// ---------------------------------------------------------------------------
// Fase 2: usuários, WhatsApp, documentos e comprovantes
// ---------------------------------------------------------------------------

export interface UpdateMeBody {
  phone?: string | null;
  pixKey?: string | null;
  currentPassword?: string;
  newPassword?: string;
}

export interface UpdateUserBody {
  name?: string;
  phone?: string | null;
  pixKey?: string | null;
  role?: Role;
  isActive?: boolean;
  commissionPercent?: number;
  revolving?: boolean;
}

export type WaProvider = 'EVOLUTION' | 'META' | 'LINK';

export interface WhatsAppConfigDTO {
  enabled: boolean;
  provider: WaProvider;
  baseUrl: string;
  instance: string;
  metaPhoneNumberId: string;
  windowStart: string;
  windowEnd: string;
  sendTime: string;
  autoPaymentOk: boolean;
  notifyGuarantorD7: boolean;
  blacklist: string[];
  hasApiKey: boolean;
  hasMetaToken: boolean;
  queue: 'BULLMQ' | 'MEMORIA';
}

/** Segredos: omitido = mantém; string vazia/null = remove. */
export type WhatsAppConfigBody = Partial<Omit<WhatsAppConfigDTO, 'hasApiKey' | 'hasMetaToken' | 'queue'>> & { apiKey?: string | null; metaToken?: string | null };

export interface MessageTemplateDTO {
  key: string;
  label: string;
  when: string;
  text: string;
  isDefault: boolean;
}

export type MessageStatus = 'PENDENTE' | 'ENVIADO' | 'FALHOU' | 'LINK_GERADO' | 'BLOQUEADO' | 'CANCELADO';

export interface MessageLogDTO {
  id: string;
  template: string;
  toPhone: string;
  toName: string | null;
  body: string;
  channel: string;
  status: MessageStatus | string;
  attempts: number;
  lastError: string | null;
  waLink: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
  client: { id: string; fullName: string } | null;
}

export interface MessagingStatusDTO {
  queue: 'BULLMQ' | 'MEMORIA';
  jobs: Record<string, number> | null;
  byStatus: Partial<Record<MessageStatus, number>>;
}

export interface CollectionMessageResult {
  id: string;
  text: string;
  waLink: string | null;
  phone: string;
}

export type DocumentType = 'RG' | 'CPF' | 'COMPROVANTE_RESIDENCIA' | 'COMPROVANTE_RENDA' | 'SELFIE' | 'CONTRATO' | 'FIADOR_FOTO' | 'COMPROVANTE_PAGAMENTO_CLIENTE';
export type DocumentStatus = 'VERIFICADO' | 'PENDENTE' | 'VENCIDO';

export interface ClientDocumentDTO {
  id: string;
  type: DocumentType;
  label: string;
  fileId: string;
  mimeType: string | null;
  originalName: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  expiryDate: string | null;
  status: DocumentStatus;
  notes: string | null;
  views: number;
  createdAt: string;
}

export interface CreateDocumentBody {
  type: DocumentType;
  fileId: string;
  expiryDate?: string | null;
  notes?: string | null;
}

export interface ClientReceiptDTO {
  id: string;
  fileId: string;
  mimeType: string | null;
  sentAt: string;
  informedValueCents: number | null;
  status: 'PENDENTE_CONFERENCIA' | 'CONFERIDO';
  notes: string | null;
  checkedAt: string | null;
  payment: { id: string; loanCode: number; type: string; status: string; valueCents: number } | null;
  createdAt: string;
  autoLinked?: boolean;
}

export interface CreateReceiptBody {
  fileId: string;
  sentAt: string;
  informedValueCents?: number | null;
  notes?: string | null;
}

// ---------------------------------------------------------------- Fase 3: backup
export interface BackupDTO {
  id: string; fileName: string; sizeBytes: number; totalClientes: number; totalEmprestimos: number; totalParcelas: number;
  isAutomatic: boolean; isRestore: boolean; emailSentTo: string | null; createdAt: string; available: boolean; createdBy?: string | null;
}
export interface BackupList { backups: BackupDTO[]; restores: BackupDTO[]; smtpConfigured: boolean }
export interface BackupEmailConfig { enabled: boolean; email: string; extraEmails: string[] }
export interface RestorePreview {
  token: string | null; valid: boolean; encrypted: boolean; fileName: string; backupCreatedAt: string | null; summary: string | null;
  counts: Record<string, number>; errors: string[]; warnings: string[]; distribution: string[];
  offlinePayments: { row: number; loanCode: number; type: string; amountCents: number; paidAt: string }[];
}
export interface RestoreResult {
  message: string; safetyBackupId: string; counts: Record<string, number>;
  offlinePaymentsCreated: string[]; offlinePaymentsSkipped: string[]; reloginRequired: boolean;
}

/** Padrão geral para novos empréstimos. */
export interface LoanDefaults { allowAmortization: boolean; allowLateFee: boolean; multaDiaPercent: number }
export interface LoanOptionsBody { allowAmortization?: boolean; allowLateFee?: boolean; multaDiaPercent?: number }
