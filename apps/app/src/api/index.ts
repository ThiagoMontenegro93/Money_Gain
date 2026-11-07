import type { ClientForm, ImportResult, LoanQuote } from '@lendcontrol/core';
import { http } from './http';
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
};
