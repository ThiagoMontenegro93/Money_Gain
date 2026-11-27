/**
 * Backup fora do servidor (S3 compatível) e alertas de falha.
 * Sobe um "S3 de mentira" na porta 9555 que confere a assinatura AWS V4 de cada envio.
 */
import { createServer, IncomingMessage, Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptFile } from '../src/backups/backups';
import { s3SignatureFor } from '../src/backups/s3';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const PASS = 'Lend@2026';
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: (ct.includes('json') ? await res.json() : await res.text()) as Json };
}
const ok = async (t: string | null, m: string, p: string, b?: unknown) => {
  const r = await call(t, m, p, b);
  if (r.status >= 300) throw new Error(`${m} ${p} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

const SECRET = 'segredo-do-bucket-de-teste';
const PASSWORD = 'SenhaNuvem@2026';
const puts: { path: string; body: Buffer }[] = [];
let s3: Server;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((r) => {
    const parts: Buffer[] = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => r(Buffer.concat(parts)));
  });
}

let owner: string;
let carlos: string;
beforeAll(async () => {
  s3 = createServer(async (req, res) => {
    const body = await readBody(req);
    const auth = String(req.headers.authorization ?? '');
    const m = /Credential=([^/]+)\/\d{8}\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})/.exec(auth);
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    const expected = m ? s3SignatureFor(SECRET, m[2], req.method!, req.url!, headers, m[3].split(';')) : '';
    const hashOk = require('crypto').createHash('sha256').update(body).digest('hex') === headers['x-amz-content-sha256'];
    if (!m || m[4] !== expected || !hashOk) {
      res.writeHead(403, { 'content-type': 'application/xml' }).end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
      return;
    }
    if (req.method === 'PUT') puts.push({ path: decodeURIComponent(req.url!), body });
    res.writeHead(200).end();
  });
  await new Promise<void>((r) => s3.listen(9555, r));
  owner = (await ok(null, 'POST', '/auth/login', { email: 'thiago@lendcontrol.app', password: PASS })).accessToken;
  carlos = (await ok(null, 'POST', '/auth/login', { email: 'carlos@lendcontrol.app', password: PASS })).accessToken;
});
afterAll(async () => {
  await call(owner, 'PUT', '/backups/offsite', { enabled: false, endpoint: '', region: 'auto', bucket: '', accessKeyId: '', prefix: 'lendcontrol/' });
  await new Promise<void>((r) => s3.close(() => r()));
});

const cfg = (over: Record<string, unknown> = {}) => ({ enabled: true, endpoint: 'http://localhost:9555', region: 'auto', bucket: 'lend-teste', accessKeyId: 'AKIATESTE', secretAccessKey: SECRET, prefix: 'lendcontrol', password: PASSWORD, ...over });

describe('Backup na nuvem', () => {
  it('só o dono configura; exige tudo preenchido e nunca devolve as chaves', async () => {
    expect((await call(carlos, 'GET', '/backups/offsite')).status).toBe(403);
    await call(owner, 'PUT', '/backups/offsite', { enabled: false, endpoint: '', region: 'auto', bucket: '', accessKeyId: '', prefix: '', secretAccessKey: '', password: '' });
    const bad = await call(owner, 'PUT', '/backups/offsite', cfg({ password: '' }));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/senha do backup/);
    const v = await ok(owner, 'PUT', '/backups/offsite', cfg());
    expect(v).toMatchObject({ enabled: true, prefix: 'lendcontrol/', hasSecret: true, hasPassword: true });
    expect(JSON.stringify(v)).not.toContain(SECRET);
    expect(JSON.stringify(v)).not.toContain(PASSWORD);
    // salvar de novo sem as chaves mantém as atuais
    const again = await ok(owner, 'PUT', '/backups/offsite', cfg({ secretAccessKey: '', password: '' }));
    expect(again).toMatchObject({ hasSecret: true, hasPassword: true });
  });

  it('testar conexão grava um arquivo no bucket com assinatura válida', async () => {
    const r = await ok(owner, 'POST', '/backups/offsite/test');
    expect(r.key).toBe('lendcontrol/teste-conexao.txt');
    expect(puts.at(-1)!.path).toBe('/lend-teste/lendcontrol/teste-conexao.txt');
  });

  it('envia o backup e as fotos/comprovantes criptografados, sem repetir o que já foi', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001', 'hex');
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'comprovante.png');
    const up = await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${carlos}` }, body: fd });
    expect(up.status).toBe(201);
    const before = puts.length;
    const r = await ok(owner, 'POST', '/backups/offsite/run');
    expect(r.last.ok).toBe(true);
    expect(r.last.filesSent).toBeGreaterThanOrEqual(1);
    expect(r.filesPending).toBe(0);
    const sent = puts.slice(before);
    const bk = sent.find((p) => p.path.startsWith('/lend-teste/lendcontrol/backups/'))!;
    expect(bk.path).toMatch(/lendcontrol-backup-nuvem-.*\.lcbak$/);
    expect(bk.body.subarray(0, 6).toString()).toBe('LCBAK1');
    expect(decryptFile(bk.body, 'senha-errada')).toBeNull();
    expect(decryptFile(bk.body, PASSWORD)!.subarray(0, 2).toString()).toBe('PK');
    const files = sent.filter((p) => p.path.startsWith('/lend-teste/lendcontrol/arquivos/'));
    expect(files.some((f) => decryptFile(f.body, PASSWORD)!.equals(png))).toBe(true);

    const second = await ok(owner, 'POST', '/backups/offsite/run');
    expect(second.last.filesSent).toBe(0);
  });

  it('se a nuvem recusar, avisa o erro na tela e cria alerta para o dono', async () => {
    await ok(owner, 'PUT', '/backups/offsite', cfg({ secretAccessKey: 'chave-errada' }));
    const r = await call(owner, 'POST', '/backups/offsite/run');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('OFFSITE_FAILED');
    expect(r.body.message).toMatch(/403.*SignatureDoesNotMatch/);
    const v = await ok(owner, 'GET', '/backups/offsite');
    expect(v.last).toMatchObject({ ok: false });
    const notes = (await ok(owner, 'GET', '/notifications')) as Json[];
    expect(notes.some((n) => n.title === 'Envio do backup para a nuvem falhou')).toBe(true);
    const t = await call(owner, 'POST', '/backups/offsite/test');
    expect(t.status).toBe(400);
    expect(t.body.message).toMatch(/Não consegui gravar/);
  });
});
