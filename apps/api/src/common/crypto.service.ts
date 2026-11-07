import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Criptografia de dados sensíveis (CPF) com AES-256-GCM e hash HMAC-SHA256
 * para unicidade/busca sem expor o valor. Chave em ENCRYPTION_KEY (64 hex).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly fileSecret: string;

  constructor() {
    const hex = process.env.ENCRYPTION_KEY ?? '';
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes)');
    this.key = Buffer.from(hex, 'hex');
    this.fileSecret = process.env.FILE_SIGNING_SECRET || hex;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [v, ivB, tagB, dataB] = payload.split(':');
    if (v !== 'v1') throw new Error('Formato de criptografia desconhecido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
  }

  hash(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('hex');
  }

  sign(data: string): string {
    return createHmac('sha256', this.fileSecret).update(data).digest('hex');
  }

  verify(data: string, sig: string): boolean {
    const expected = Buffer.from(this.sign(data), 'hex');
    const got = Buffer.from(sig, 'hex');
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
}
