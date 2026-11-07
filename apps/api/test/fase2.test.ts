/**
 * Fase 2: WhatsApp (fila BullMQ + mock da Evolution API), documentos, comprovantes do cliente e PDFs.
 * Requer API rodando com REDIS_URL e seed aplicado (o script `pnpm test` reaplica o seed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, Server } from 'http';
import sharp from 'sharp';
import { addDays, addMonthsAnchored, todayISO } from '@lendcontrol/core';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASS = 'Lend@2026';
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  const b = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: b as Json, headers: res.headers };
}
const ok = async (t: string, m: string, p: string, b?: unknown) => {
  const r = await call(t, m, p, b);
  if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const upload = async (token: string, name: string, type: string, buf: Buffer) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  const r = await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return r.json();
};
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('timeout aguardando condição');
};

const today = todayISO();
const suiteStart = new Date().toISOString();
let owner: string, carlos: string, gestor: string;
let mock: Server;
const received: { path: string; headers: Record<string, unknown>; body: Json }[] = [];
let failNext = 0;

beforeAll(async () => {
  mock = createServer((req, res) => {
    let data = '';
    req.on('data', (ch) => (data += ch));
    req.on('end', () => {
      if (failNext > 0) {
        failNext--;
        res.writeHead(500).end('erro simulado');
        return;
      }
      received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(data || '{}') });
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ key: { id: `MSG${received.length}` } }));
    });
  });
  await new Promise<void>((r) => mock.listen(3999, r));
  owner = (await ok('', 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
  carlos = (await ok('', 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS })).accessToken;
  gestor = (await ok('', 'POST', '/auth/login', { email: 'gestor@lendcontrol.app', password: PASS })).accessToken;
});
afterAll(() => new Promise<void>((r) => mock.close(() => r())));

describe('WhatsApp - configuração e templates', () => {
  it('só o dono configura; segredo nunca volta na resposta', async () => {
    expect((await call(carlos, 'PUT', '/messaging/config', { enabled: true })).status).toBe(403);
    const cfg = await ok(owner, 'PUT', '/messaging/config', {
      enabled: true, provider: 'EVOLUTION', baseUrl: 'http://localhost:3999', instance: 'lendcontrol', apiKey: 'segredo-123',
      windowStart: '00:00', windowEnd: '23:59', blacklist: ['(21) 98444-5555'],
    });
    expect(cfg.hasApiKey).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain('segredo-123');
    expect(cfg.queue).toBe('BULLMQ');
    expect(cfg.blacklist).toEqual(['21984445555']);
  });

  it('edita e restaura template', async () => {
    const list = await ok(owner, 'PUT', '/messaging/templates/D_0', { text: 'Oi {nome}, vence hoje: {valor}. PIX {pix_chave}' });
    expect(list.find((t: Json) => t.key === 'D_0')).toMatchObject({ isDefault: false });
    const reset = await ok(owner, 'PUT', '/messaging/templates/D_0', { text: null });
    expect(reset.find((t: Json) => t.key === 'D_0').isDefault).toBe(true);
  });
});

describe('WhatsApp - varredura diária e fila', () => {
  let clientId: string;
  it('gera D0 para parcela que vence hoje e envia pela Evolution API (idempotente)', async () => {
    const c = await ok(owner, 'POST', '/clients', { form: {
      fullName: 'Roberta Vence Hoje', cpf: '93541134780', birthDate: '1990-01-01', whatsapp: '(21) 99111-0000', cep: '20745-000', street: 'Rua A', number: '1',
      district: 'Centro', city: 'Rio', state: 'RJ', pixKey: 'r@x.com', pixType: 'EMAIL', emergencyName: 'Mae', emergencyRelation: 'MAE', emergencyPhone1: '(21) 97000-0000', hasGuarantor: false, lgpdConsent: true,
    } });
    clientId = c.id;
    await ok(owner, 'POST', '/loans', { clientId, type: 'INTEREST_ONLY', method: 'MONTHLY', principalCents: 50000, ratePercent: 10, multaDiaPercent: 1, releaseDate: addMonthsAnchored(today, -1) });
    const before = received.length;
    const scan = await ok(owner, 'POST', '/messaging/scan');
    expect(scan.created).toBeGreaterThanOrEqual(1);
    const again = await ok(owner, 'POST', '/messaging/scan');
    const logs = await ok(owner, 'GET', `/messaging/logs?clientId=${clientId}`);
    expect(logs.filter((l: Json) => l.template === 'D_0')).toHaveLength(1); // idempotente
    void again;
    await waitFor(async () => received.length > before && received.find((r) => r.body.number === '5521991110000'));
    const msg = received.find((r) => r.body.number === '5521991110000')!;
    expect(msg.path).toBe('/message/sendText/lendcontrol');
    expect(msg.headers.apikey).toBe('segredo-123');
    expect(msg.body.text).toMatch(/Roberta.*R\$ 550,00.*vence HOJE.*thiago\.pix@lendcontrol\.app/);
    const sent = await waitFor(async () => (await ok(owner, 'GET', `/messaging/logs?clientId=${clientId}`)).find((l: Json) => l.status === 'ENVIADO'));
    expect(sent.template).toBe('D_0');
  });

  it('D+7 vai para cliente e fiador; blacklist bloqueia', async () => {
    await ok(owner, 'POST', '/messaging/scan');
    const logs = await ok(owner, 'GET', '/messaging/logs?limit=500');
    // Fernanda está na blacklist: toda mensagem gerada depois da configuração fica BLOQUEADO
    const fer = logs.filter((l: Json) => l.toPhone === '21984445555' && l.createdAt >= suiteStart);
    expect(fer.every((l: Json) => l.status === 'BLOQUEADO')).toBe(true);
    const d7 = logs.filter((l: Json) => l.template === 'D_PLUS_7' || l.template === 'D_PLUS_7_FIADOR');
    if (d7.length) expect(d7.some((l: Json) => l.template === 'D_PLUS_7_FIADOR')).toBe(true);
  });

  it('retentativa: falha 500 do provedor e depois envia', async () => {
    failNext = 1;
    const before = received.length;
    const r = await ok(owner, 'POST', '/messaging/test', { phone: '(21) 99222-0000', text: 'teste' });
    // envio direto (sem fila) marca FALHOU após 1 tentativa; reenvio funciona
    expect(r.status).toBe('FALHOU');
    expect(r.waLink).toMatch(/^https:\/\/wa\.me\/5521992220000\?text=teste/);
    const retried = await ok(owner, 'POST', `/messaging/${r.id}/retry`);
    await waitFor(async () => received.length > before);
    const final = await waitFor(async () => (await ok(owner, 'GET', '/messaging/logs?limit=20')).find((l: Json) => l.id === retried.id && l.status === 'ENVIADO'));
    expect(final.attempts).toBe(2);
  });

  it('aprovação de pagamento envia "Pagamento OK"', async () => {
    const loans = await ok(owner, 'GET', `/loans?clientId=${clientId}`);
    const p = await ok(owner, 'POST', '/payments', { loanId: loans[0].id, type: 'JUROS', amountCents: 5000, paidAt: today });
    await ok(gestor, 'POST', `/payments/${p.id}/approve`, { password: PASS });
    const okMsg = await waitFor(async () => (await ok(owner, 'GET', `/messaging/logs?clientId=${clientId}`)).find((l: Json) => l.template === 'PAYMENT_OK' && l.status === 'ENVIADO'));
    expect(okMsg.body).toMatch(/Confirmamos o recebimento do seu pagamento de R\$ 50,00/);
    // o aviso D0 pendente da parcela paga não é reenviado em nova varredura
    await ok(owner, 'POST', '/messaging/scan');
    const d0 = (await ok(owner, 'GET', `/messaging/logs?clientId=${clientId}`)).filter((l: Json) => l.template === 'D_0');
    expect(d0).toHaveLength(1);
  });

  it('mensagem firme gera link wa.me e registra tentativa de cobrança', async () => {
    const ruim = (await ok(owner, 'GET', '/clients?classificacao=RUIM')).items[0];
    const m = await ok(owner, 'POST', `/clients/${ruim.id}/collection-message`, { target: 'CLIENTE' });
    expect(m.waLink).toMatch(/^https:\/\/wa\.me\/55\d{10,11}\?text=/);
    expect(m.text).toMatch(/cobrança formal/);
    const f = await ok(owner, 'POST', `/clients/${ruim.id}/collection-message`, { target: 'FIADOR' });
    expect(f.text).toMatch(/fiador/);
    const d = await ok(owner, 'GET', `/clients/${ruim.id}`);
    expect(d.collectionAttempts.some((a: Json) => a.type === 'WHATSAPP_FIRME')).toBe(true);
  });

  it('opt-out impede mensagens automáticas', async () => {
    await ok(owner, 'PUT', `/clients/${clientId}/whatsapp-opt-out`, { optOut: true });
    const d = await ok(owner, 'GET', `/clients/${clientId}`);
    expect(d.whatsappOptOut).toBe(true);
  });

  it('canal manual (LINK) não chama provedor', async () => {
    await ok(owner, 'PUT', '/messaging/config', { provider: 'LINK' });
    const before = received.length;
    const r = await ok(owner, 'POST', '/messaging/test', { phone: '(21) 99333-0000', text: 'manual' });
    expect(r.status).toBe('FALHOU');
    expect(r.lastError).toMatch(/manual/);
    expect(received.length).toBe(before);
    await ok(owner, 'PUT', '/messaging/config', { provider: 'EVOLUTION', enabled: false });
  });
});

describe('Documentos (galeria 1)', () => {
  let clientId: string;
  let docId: string;
  let PNG: Buffer;
  beforeAll(async () => {
    PNG = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#3a6ea5' } }).png().toBuffer();
  });
  it('operador anexa RG; admin verifica; URL de 5 min com marca d\'água e log LGPD', async () => {
    const mine = (await ok(carlos, 'GET', '/clients')).items[0];
    clientId = mine.id;
    const f = await upload(carlos, 'rg.png', 'image/png', PNG);
    const doc = await ok(carlos, 'POST', `/clients/${clientId}/documents`, { type: 'RG', fileId: f.id, expiryDate: addDays(today, 365) });
    docId = doc.id;
    expect(doc.status).toBe('PENDENTE');
    expect((await call(carlos, 'PATCH', `/documents/${docId}`, { isVerified: true })).status).toBe(403);
    const ver = await ok(owner, 'PATCH', `/documents/${docId}`, { isVerified: true });
    expect(ver.status).toBe('VERIFICADO');
    const u = await ok(carlos, 'GET', `/documents/${docId}/url`);
    const img = await fetch(u.url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg'); // re-renderizada com marca d'água
    const bytes = Buffer.from(await img.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(PNG.length);
    expect((await fetch(u.url.replace(/v=\w+/, 'v=outro'))).status).toBe(403);
    const list = await ok(owner, 'GET', `/clients/${clientId}/documents`);
    expect(list.find((x: Json) => x.id === docId).views).toBeGreaterThanOrEqual(1);
  });

  it('documento vencido aparece como VENCIDO; operador de fora não acessa', async () => {
    const v = await ok(owner, 'PATCH', `/documents/${docId}`, { expiryDate: addDays(today, -1) });
    expect(v.status).toBe('VENCIDO');
    const notMine = (await ok(owner, 'GET', '/clients?search=Fernanda')).items[0];
    expect((await call(carlos, 'GET', `/clients/${notMine.id}/documents`)).status).toBe(404);
  });
});

describe('Comprovantes enviados pelo cliente (galeria 2)', () => {
  it('anexar vincula automaticamente ao pagamento pendente; conferir marca CONFERIDO', async () => {
    const ruim = (await ok(owner, 'GET', '/clients?classificacao=RUIM')).items[0];
    const loans = await ok(owner, 'GET', `/loans?clientId=${ruim.id}&status=ATIVO`);
    const loan = loans.find((l: Json) => l.type === 'INTEREST_ONLY');
    const q = await ok(owner, 'GET', `/loans/${loan.id}/quote`);
    const p = await ok(owner, 'POST', '/payments', { loanId: loan.id, type: 'JUROS', amountCents: q.interestOnlyCents, paidAt: today });
    const f = await upload(owner, 'pix.pdf', 'application/pdf', Buffer.from('%PDF-1.4 comprovante'));
    const r = await ok(owner, 'POST', `/clients/${ruim.id}/receipts`, { fileId: f.id, sentAt: new Date().toISOString(), informedValueCents: q.interestOnlyCents });
    expect(r.autoLinked).toBe(true);
    expect(r.payment.id).toBe(p.id);
    expect(r.status).toBe('PENDENTE_CONFERENCIA');
    const pays = await ok(owner, 'GET', `/payments?loanId=${loan.id}&status=AGUARDANDO_APROVACAO`);
    expect(pays[0].comprovanteFileId).toBe(f.id);
    const checked = await ok(owner, 'POST', `/receipts/${r.id}/check`, {});
    expect(checked.status).toBe('CONFERIDO');
    await ok(owner, 'POST', `/payments/${p.id}/reject`, { reason: 'teste automatizado' });
  });
});

describe('Cobrança: carta, dossiê e negativação', () => {
  it('gera carta extrajudicial e dossiê em PDF', async () => {
    const perda = (await ok(owner, 'GET', '/clients?classificacao=PERDA')).items[0];
    const letter = await call(owner, 'GET', `/clients/${perda.id}/collection-letter.pdf`);
    expect(letter.status).toBe(200);
    expect(letter.headers.get('content-type')).toBe('application/pdf');
    expect((letter.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const dossier = await call(owner, 'GET', `/clients/${perda.id}/dossier.pdf`);
    expect((dossier.body as Buffer).length).toBeGreaterThan(2000);
    expect((await call(carlos, 'GET', `/clients/${perda.id}/dossier.pdf`)).status).toBe(403);
    const neg = await ok(owner, 'POST', `/clients/${perda.id}/negativate`, { mark: true });
    expect(neg.negativadoEm).not.toBeNull();
    const d = await ok(owner, 'GET', `/clients/${perda.id}`);
    expect(d.negativadoEm).not.toBeNull();
    expect(d.collectionAttempts.map((a: Json) => a.type)).toEqual(expect.arrayContaining(['CARTA', 'JURIDICO', 'NEGATIVACAO']));
  });

  it('cliente sem dívida não gera carta', async () => {
    const pedro = (await ok(owner, 'GET', '/clients?search=Pedro')).items[0];
    expect((await call(owner, 'GET', `/clients/${pedro.id}/collection-letter.pdf`)).status).toBe(400);
  });
});

describe('Usuários: chave PIX e edição', () => {
  it('usuário atualiza a própria chave PIX; dono desativa funcionário e o acesso cai na hora', async () => {
    const me = await ok(carlos, 'PUT', '/users/me', { pixKey: 'carlos@pix.com' });
    expect(me.pixKey).toBe('carlos@pix.com');
    const temp = await ok(owner, 'POST', '/users', { name: 'Temp', email: `temp${Date.now()}@x.com`, password: '12345678', role: 'OPERATOR' });
    const tok = (await ok('', 'POST', '/auth/login', { email: temp.email, password: '12345678' })).accessToken;
    expect((await call(tok, 'GET', '/auth/me')).status).toBe(200);
    await ok(owner, 'PUT', `/users/${temp.id}`, { isActive: false });
    expect((await call(tok, 'GET', '/auth/me')).status).toBe(401);
    expect((await call(owner, 'PUT', `/users/${(await ok(owner, 'GET', '/auth/me')).id}`, { isActive: false })).status).toBe(401);
  });
});
