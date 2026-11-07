import type { ClientForm, ImportResult, LoanQuote } from '@lendcontrol/core';
import { fetchBlob, http } from './http';
import type * as T from './types';

export * from './http';
export type * from './types';

const enc = encodeURIComponent;

export const api = {
  auth: {
    login: (email: string, password: string) => http.post<T.LoginResponse>('/auth/login', { email, password }),
    me: () => http.get<T.UserDTO>('/auth/me'),
  },
  users: {
    list: () => http.get<T.UserDTO[]>('/users'),
    create: (body: T.CreateUserBody) => http.post<T.UserDTO>('/users', body),
    updateMe: (body: T.UpdateMeBody) => http.put<T.UserDTO>('/users/me', body),
    update: (id: string, body: T.UpdateUserBody) => http.put<T.UserDTO>(`/users/${enc(id)}`, body),
  },
  dashboard: () => http.get<T.DashboardDTO>('/dashboard'),
  clients: {
    list: (q: { search?: string; classificacao?: string; overdue?: boolean; responsibleUserId?: string; status?: string } = {}) =>
      http.get<T.ClientListResponse>('/clients', q),
    lookup: (q: string) => http.get<T.ClientLookupItem[]>('/clients/lookup', { q }),
    get: (id: string) => http.get<T.ClientDetail>(`/clients/${enc(id)}`),
    create: (form: ClientForm | Partial<ClientForm>, draft = false) => http.post<T.ClientDetail>('/clients', { form, draft }),
    update: (id: string, form: Partial<ClientForm>, draft = false) => http.put<T.ClientDetail>(`/clients/${enc(id)}`, { form, draft }),
    revealCpf: (id: string) => http.get<{ cpf: string; guarantorCpf: string | null }>(`/clients/${enc(id)}/cpf`),
    parseImport: (text: string) => http.post<ImportResult>('/clients/import/parse', { text }),
    unblock: (id: string, password: string, reason: string) => http.post<T.ClientDetail>(`/clients/${enc(id)}/unblock`, { password, reason }),
    fidelity: (id: string, body: T.FidelityBody) => http.post<T.ClientDetail>(`/clients/${enc(id)}/fidelity`, body),
    addCollectionAttempt: (id: string, type: string, result: string) =>
      http.post<T.CollectionAttemptDTO>(`/clients/${enc(id)}/collection-attempts`, { type, result }),
    collectionMessage: (id: string, target: 'CLIENTE' | 'FIADOR') => http.post<T.CollectionMessageResult>(`/clients/${enc(id)}/collection-message`, { target }),
    letterPdf: (id: string) => fetchBlob(`/clients/${enc(id)}/collection-letter.pdf`),
    dossierPdf: (id: string) => fetchBlob(`/clients/${enc(id)}/dossier.pdf`),
    negativate: (id: string, mark: boolean) => http.post<{ negativadoEm: string | null }>(`/clients/${enc(id)}/negativate`, { mark }),
    optOut: (id: string, optOut: boolean) => http.put<{ whatsappOptOut: boolean }>(`/clients/${enc(id)}/whatsapp-opt-out`, { optOut }),
  },
  documents: {
    list: (clientId: string) => http.get<T.ClientDocumentDTO[]>(`/clients/${enc(clientId)}/documents`),
    create: (clientId: string, body: T.CreateDocumentBody) => http.post<T.ClientDocumentDTO>(`/clients/${enc(clientId)}/documents`, body),
    update: (id: string, body: { isVerified?: boolean; expiryDate?: string | null; notes?: string | null }) => http.patch<T.ClientDocumentDTO>(`/documents/${enc(id)}`, body),
    remove: (id: string) => http.del<{ ok: boolean }>(`/documents/${enc(id)}`),
    url: (id: string) => http.get<T.SignedUrl>(`/documents/${enc(id)}/url`),
  },
  receipts: {
    list: (clientId: string) => http.get<T.ClientReceiptDTO[]>(`/clients/${enc(clientId)}/receipts`),
    create: (clientId: string, body: T.CreateReceiptBody) => http.post<T.ClientReceiptDTO>(`/clients/${enc(clientId)}/receipts`, body),
    check: (id: string, paymentId?: string | null) => http.post<T.ClientReceiptDTO>(`/receipts/${enc(id)}/check`, paymentId ? { paymentId } : {}),
  },
  messaging: {
    config: () => http.get<T.WhatsAppConfigDTO>('/messaging/config'),
    saveConfig: (body: T.WhatsAppConfigBody) => http.put<T.WhatsAppConfigDTO>('/messaging/config', body),
    templates: () => http.get<T.MessageTemplateDTO[]>('/messaging/templates'),
    saveTemplate: (key: string, text: string | null) => http.put<T.MessageTemplateDTO[]>(`/messaging/templates/${enc(key)}`, { text }),
    logs: (q: { clientId?: string; status?: string; limit?: number } = {}) => http.get<T.MessageLogDTO[]>('/messaging/logs', q),
    status: () => http.get<T.MessagingStatusDTO>('/messaging/status'),
    scan: () => http.post<{ asOf: string; created: number }>('/messaging/scan'),
    test: (phone: string, text: string) => http.post<T.MessageLogDTO>('/messaging/test', { phone, text }),
    retry: (id: string) => http.post<T.MessageLogDTO>(`/messaging/${enc(id)}/retry`),
  },
  cep: (cep: string) => http.get<T.CepResult>(`/cep/${enc(cep.replace(/\D/g, ''))}`),
  loans: {
    preview: (body: Omit<T.CreateLoanBody, 'clientId'>) => http.post<T.LoanPreview>('/loans/preview', body),
    creditCheck: (clientId: string) => http.get<T.CreditLock>('/loans/credit-check', { clientId }),
    create: (body: T.CreateLoanBody) => http.post<T.LoanDetail>('/loans', body),
    list: (q: { clientId?: string; status?: string; lenderUserId?: string } = {}) => http.get<T.LoanSummary[]>('/loans', q),
    get: (id: string) => http.get<T.LoanDetail>(`/loans/${enc(id)}`),
    quote: (id: string, asOf?: string) => http.get<LoanQuote>(`/loans/${enc(id)}/quote`, { asOf }),
  },
  payments: {
    create: (body: T.CreatePaymentBody) => http.post<T.PaymentDTO>('/payments', body),
    list: (q: { status?: string; loanId?: string } = {}) => http.get<T.PaymentDTO[]>('/payments', q),
    approve: (id: string, password: string) => http.post<T.PaymentDTO>(`/payments/${enc(id)}/approve`, { password }),
    reject: (id: string, reason: string) => http.post<T.PaymentDTO>(`/payments/${enc(id)}/reject`, { reason }),
  },
  files: {
    upload: (form: FormData) => http.upload<T.FileDTO>('/files', form),
    url: (id: string) => http.get<T.SignedUrl>(`/files/${enc(id)}/url`),
  },
  wallets: () => http.get<T.UserDTO[]>('/wallets'),
  ledger: (userId?: string) => http.get<T.LedgerEntry[]>('/ledger', { userId }),
  transfers: {
    create: (body: T.CreateTransferBody) => http.post<T.TransferDTO>('/transfers', body),
    list: (status?: string) => http.get<T.TransferDTO[]>('/transfers', { status }),
    approve: (id: string, password: string) => http.post<T.TransferDTO>(`/transfers/${enc(id)}/approve`, { password }),
    reject: (id: string, reason: string) => http.post<T.TransferDTO>(`/transfers/${enc(id)}/reject`, { reason }),
  },
  notifications: {
    list: () => http.get<T.NotificationDTO[]>('/notifications'),
    read: (id: string) => http.post<void>(`/notifications/${enc(id)}/read`),
  },
  backups: {
    list: () => http.get<T.BackupList>('/backups'),
    create: () => http.post<T.BackupDTO>('/backups'),
    download: (id: string) => fetchBlob(`/backups/${enc(id)}/download`),
    encrypted: (id: string, password: string) => fetchBlob(`/backups/${enc(id)}/encrypted`, { method: 'POST', body: { password } }),
    email: (id: string) => http.post<T.BackupDTO>(`/backups/${enc(id)}/email`),
    settings: () => http.get<T.BackupEmailConfig>('/backups/settings'),
    saveSettings: (b: T.BackupEmailConfig) => http.put<T.BackupEmailConfig>('/backups/settings', b),
    testEmail: () => http.post<T.BackupDTO>('/backups/settings/test'),
    preview: (form: FormData) => http.upload<T.RestorePreview>('/backups/restore/preview', form),
    restore: (token: string, password: string) => http.post<T.RestoreResult>('/backups/restore', { token, password }),
  },
};
