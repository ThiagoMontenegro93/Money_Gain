/**
 * Vigia do servidor (item 6). Roda fora do app (serviço "watchdog" no docker-compose.prod.yml) porque
 * o app não consegue avisar que caiu. A cada WATCH_INTERVAL_S segundos consulta /api/health; depois de
 * 3 falhas seguidas manda e-mail para ALERT_EMAIL (ou OWNER_EMAIL) e outro quando o servidor volta.
 *   node dist/watchdog.js
 */
import * as nodemailer from 'nodemailer';

const URL_ = process.env.WATCH_URL || 'http://app:3000/api/health';
const INTERVAL = Math.max(10, Number(process.env.WATCH_INTERVAL_S) || 60) * 1000;
const FAILS = Math.max(1, Number(process.env.WATCH_FAILS) || 3);
const TO = (process.env.ALERT_EMAIL || process.env.OWNER_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);

let fails = 0;
let down = false;
let downSince: Date | null = null;
const log = (m: string) => console.log(`${new Date().toISOString()} [watchdog] ${m}`);
const when = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function mail(subject: string, text: string) {
  if (!process.env.SMTP_URL || !TO.length) return log(`sem SMTP_URL/ALERT_EMAIL: ${subject}`);
  try {
    await nodemailer.createTransport(process.env.SMTP_URL).sendMail({ from: process.env.SMTP_FROM || 'LendControl <backup@lendcontrol.app>', to: TO.join(', '), subject, text });
    log(`e-mail enviado: ${subject}`);
  } catch (e) {
    log(`falha ao enviar e-mail: ${(e as Error).message}`);
  }
}

export async function check(): Promise<string | null> {
  try {
    const r = await fetch(URL_, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return `respondeu ${r.status}`;
    const j = (await r.json()) as { status?: string; db?: boolean };
    if (j.status !== 'ok') return `banco de dados ${j.db ? 'ok' : 'fora do ar'}`;
    return null;
  } catch (e) {
    return `sem resposta (${(e as Error).message})`;
  }
}

async function tick() {
  const problem = await check();
  if (!problem) {
    if (down) {
      await mail('LendControl - servidor voltou', `O LendControl voltou a responder em ${when(new Date())}. Ficou fora desde ${when(downSince!)}.`);
      log('servidor voltou');
    }
    fails = 0;
    down = false;
    downSince = null;
    return;
  }
  fails++;
  if (fails === 1) downSince = new Date();
  log(`falha ${fails}: ${problem}`);
  if (fails === FAILS && !down) {
    down = true;
    await mail('LendControl - ALERTA: servidor fora do ar', `O LendControl não responde desde ${when(downSince!)} (${problem}).\n\nEndereço verificado: ${URL_}\nVerifique o servidor (docker compose ps / logs). Você recebe outro e-mail quando ele voltar.`);
  }
}

if (require.main === module) {
  log(`vigiando ${URL_} a cada ${INTERVAL / 1000}s; alerta para ${TO.join(', ') || '(ninguém: defina ALERT_EMAIL)'}`);
  void tick();
  setInterval(() => void tick(), INTERVAL);
}
