import { createHash, createHmac } from 'crypto';

/** Cliente mínimo S3 (AWS Signature V4, endereço "path-style"). Serve para AWS S3, Cloudflare R2, Backblaze B2, Wasabi e MinIO. */
export interface S3Config {
  endpoint: string; // ex.: https://s3.sa-east-1.amazonaws.com  ou  https://<conta>.r2.cloudflarestorage.com
  region: string; // ex.: sa-east-1 (R2 usa "auto")
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export async function s3Request(cfg: S3Config, method: 'PUT' | 'GET' | 'HEAD' | 'DELETE', key: string, body?: Buffer, contentType = 'application/octet-stream') {
  const base = new URL(cfg.endpoint.replace(/\/$/, ''));
  const path = `${base.pathname.replace(/\/$/, '')}/${enc(cfg.bucket)}/${key.split('/').map(enc).join('/')}`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256(payload);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, day), cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSign).update(toSign).digest('hex');
  const res = await fetch(`${base.origin}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': contentType } : {}),
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
    },
    body: body && method === 'PUT' ? new Uint8Array(payload) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok && !(method === 'HEAD' && res.status === 404)) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new Error(`Armazenamento respondeu ${res.status}${code ? ` (${code})` : ''}`);
  }
  return res;
}

/** Para os testes: confere a assinatura de uma requisição recebida (mesmo algoritmo). */
export function s3SignatureFor(secret: string, region: string, method: string, path: string, headers: Record<string, string>, signedHeaders: string[]) {
  const amzDate = headers['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const canonical = [method, path, '', ...signedHeaders.map((h) => `${h}:${headers[h]}`), '', signedHeaders.join(';'), headers['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  return createHmac('sha256', kSign).update(toSign).digest('hex');
}
