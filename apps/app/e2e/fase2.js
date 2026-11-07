// Fluxo Fase 2: WhatsApp (provedor LINK + template), cobrança firme, documentos e comprovantes.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000', API = BASE + '/api', OUT = process.argv[2];
const step = (m) => console.log('✓ ' + m);
// PNG 2x2 válido (sharp precisa decodificar para aplicar a marca d'água)
let PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

(async () => {
  try {
    // imagem maior para a marca d'água ficar visível na captura
    const sharp = require('sharp');
    const svg = `<svg width="900" height="560" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="560" fill="#E0F2FE"/><rect x="30" y="30" width="840" height="500" rx="24" fill="#FFFFFF" stroke="#0EA5E9" stroke-width="6"/><text x="70" y="120" font-size="44" font-family="Arial" font-weight="700" fill="#0F172A">REPÚBLICA FEDERATIVA DO BRASIL</text><text x="70" y="200" font-size="36" font-family="Arial" fill="#334155">CARTEIRA DE IDENTIDADE (TESTE)</text><text x="70" y="300" font-size="32" font-family="Arial" fill="#334155">Nome: ANA PAULA RIBEIRO</text><text x="70" y="360" font-size="32" font-family="Arial" fill="#334155">RG: 00.000.000-0</text></svg>`;
    PNG = await sharp(Buffer.from(svg)).png().toBuffer();
  } catch { /* usa o PNG 2x2 */ }
  const browser = await chromium.launch();
  const tid = (p, id) => p.locator(`[data-testid="${id}"]`).first();
  const fill = async (p, id, v) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); if (tag === 'INPUT' || tag === 'TEXTAREA') await l.fill(v); else await l.locator('input,textarea').first().fill(v); };
  const val = async (p, id) => { const l = tid(p, id); const tag = await l.evaluate((e) => e.tagName); return tag === 'INPUT' || tag === 'TEXTAREA' ? l.inputValue() : l.locator('input,textarea').first().inputValue(); };
  const login = async (p, email) => { await p.goto(BASE + '/login'); await fill(p, 'login-email', email); await fill(p, 'login-password', 'Lend@2026'); await tid(p, 'login-submit').click(); await p.waitForURL((u) => !u.pathname.includes('login')); };
  const apiLogin = async (email) => (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Lend@2026' }) }).then((r) => r.json())).accessToken;
  const H = { authorization: 'Bearer ' + (await apiLogin('thiago@lendcontrol.app')) };
  const get = (path) => fetch(API + path, { headers: H }).then((r) => r.json());
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    p.on('dialog', (d) => d.dismiss());
  };
  const ctxOpts = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });

  // Cliente do Carlos com WhatsApp e dívida em aberto
  const clients = (await get('/clients')).items;
  const target = clients.find((c) => c.responsible?.name?.startsWith('Carlos') && c.whatsapp && c.status === 'ATIVO' && c.emAbertoCents > 0)
    ?? clients.find((c) => c.responsible?.name?.startsWith('Carlos') && c.whatsapp && c.status === 'ATIVO');
  if (!target) throw new Error('nenhum cliente do Carlos com WhatsApp no seed');
  step(`Cliente alvo: ${target.fullName} (${target.id})`);

  // ---------- Dono no desktop: configura provedor LINK e edita template ----------
  const dctx = await browser.newContext(ctxOpts(1440, 900));
  // links wa.me abertos em nova aba não precisam de internet
  await dctx.route(/wa\.me|api\.whatsapp\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>wa.me stub</body></html>' }));
  const d = await dctx.newPage();
  watch(d);
  await login(d, 'thiago@lendcontrol.app');
  step('Dono fez login no desktop');
  const originalCfg = await get('/messaging/config');

  await d.goto(BASE + '/settings?tab=whatsapp');
  await tid(d, 'wa-config').waitFor();
  await tid(d, 'wa-provider').selectOption('LINK');
  await tid(d, 'wa-save').click();
  await d.waitForTimeout(1200);
  let cfg = await get('/messaging/config');
  if (cfg.provider !== 'LINK') throw new Error('provedor não foi salvo como LINK: ' + cfg.provider);
  await d.screenshot({ path: `${OUT}/fase2-01-whatsapp-config.png`, fullPage: true });
  step('Dono configurou o provedor "Só link wa.me" (LINK) na tela de Configurações');

  await tid(d, 'tab-templates').click();
  await tid(d, 'tpl-COBRANCA_FIRME').waitFor();
  const marker = `E2E-${Date.now().toString().slice(-6)}`;
  const tplText = `{nome}, ${marker}: sua dívida de {valor_atualizado} está em atraso há {dias_atraso} dias. Regularize hoje. PIX: {pix_chave}.`;
  await fill(d, 'tpl-COBRANCA_FIRME', tplText);
  await tid(d, 'tpl-save-COBRANCA_FIRME').click();
  await d.waitForTimeout(1000);
  const tpls = await get('/messaging/templates');
  const firm = tpls.find((t) => t.key === 'COBRANCA_FIRME');
  if (!firm || !firm.text.includes(marker) || firm.isDefault) throw new Error('template não salvo');
  await tid(d, 'tpl-card-COBRANCA_FIRME').scrollIntoViewIfNeeded();
  await d.screenshot({ path: `${OUT}/fase2-02-template.png` });
  step('Dono editou o template "Cobrança firme"');

  // ---------- Mensagem firme pela página do cliente ----------
  await d.goto(`${BASE}/clients/${target.id}`);
  await tid(d, 'tab-2').click();
  await tid(d, 'wa-firm').waitFor();
  const popupP = d.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await tid(d, 'wa-firm').click();
  await tid(d, 'wa-modal').waitFor();
  const link = await val(d, 'wa-link');
  if (!/^https:\/\/wa\.me\/55\d{10,11}\?text=/.test(link)) throw new Error('link wa.me não gerado: ' + link);
  if (!decodeURIComponent(link).includes(marker)) throw new Error('link não usa o template editado');
  const popup = await popupP;
  if (popup) { await popup.close().catch(() => {}); }
  await d.screenshot({ path: `${OUT}/fase2-03-firm-message.png` });
  step(`Mensagem firme gerada com link wa.me${popup ? ' (aberto em nova aba)' : ''}: ${link.slice(0, 42)}...`);
  await d.locator('[aria-label="Fechar"]').first().click();
  await d.waitForTimeout(800);
  await tid(d, 'client-wa-history').getByText(marker).first().waitFor({ timeout: 8000 });
  const logs = await get(`/messaging/logs?clientId=${target.id}&limit=5`);
  if (!logs.some((l) => l.template === 'COBRANCA_FIRME' && l.status === 'LINK_GERADO' && l.body.includes(marker))) throw new Error('log LINK_GERADO não registrado');
  step('Mensagem aparece no histórico de WhatsApp do cliente (LINK_GERADO)');

  // ---------- Funcionário no celular: envia documento na aba 5 ----------
  const mctx = await browser.newContext(ctxOpts(390, 844));
  const m = await mctx.newPage();
  watch(m);
  await login(m, 'carlos@lendcontrol.app');
  await m.goto(`${BASE}/clients/${target.id}?tab=5`);
  await tid(m, 'client-documents').waitFor();
  const docsBefore = await get(`/clients/${target.id}/documents`);
  await tid(m, 'doc-add').click();
  await tid(m, 'doc-modal').waitFor();
  await tid(m, 'doc-type').selectOption('RG');
  let [chooser] = await Promise.all([m.waitForEvent('filechooser'), tid(m, 'doc-file').locator('[role=button]').first().click()]);
  await chooser.setFiles({ name: 'rg-frente.png', mimeType: 'image/png', buffer: PNG });
  await tid(m, 'doc-file').getByText('rg-frente.png').waitFor({ timeout: 8000 });
  const nextYear = new Date().getFullYear() + 1;
  await fill(m, 'doc-expiry', `3112${nextYear}`);
  await fill(m, 'doc-notes', 'RG frente - enviado pelo celular');
  await m.screenshot({ path: `${OUT}/fase2-04-doc-upload-mobile.png` });
  await tid(m, 'doc-submit').click();
  await tid(m, 'doc-modal').waitFor({ state: 'hidden', timeout: 8000 });
  const docsAfter = await get(`/clients/${target.id}/documents`);
  const doc = docsAfter.find((x) => !docsBefore.some((b) => b.id === x.id));
  if (!doc || doc.type !== 'RG' || doc.status !== 'PENDENTE' || doc.expiryDate !== `${nextYear}-12-31`) throw new Error('documento não criado corretamente: ' + JSON.stringify(doc));
  await tid(m, `doc-${doc.id}`).waitFor();
  if (await tid(m, `doc-verify-${doc.id}`).count()) throw new Error('funcionário não deveria ver "Verificar"');
  await m.screenshot({ path: `${OUT}/fase2-05-doc-pending-mobile.png`, fullPage: true });
  step('Funcionário enviou o RG na aba Documentos (PENDENTE, validade 31/12, sem botão Verificar)');

  // ---------- Dono verifica e abre a visualização com marca d'água ----------
  await d.goto(`${BASE}/clients/${target.id}?tab=5`);
  await tid(d, `doc-${doc.id}`).waitFor();
  await tid(d, `doc-verify-${doc.id}`).click();
  await tid(d, `doc-status-${doc.id}`).getByText('Verificado').waitFor({ timeout: 8000 });
  const imgResp = d.waitForResponse((r) => r.url().includes(`/api/documents/raw/${doc.id}`), { timeout: 10000 });
  await tid(d, `doc-view-${doc.id}`).click();
  await tid(d, 'doc-viewer').waitFor();
  const resp = await imgResp;
  const ct = resp.headers()['content-type'];
  if (resp.status() !== 200 || ct !== 'image/jpeg') throw new Error(`visualização com marca d'água falhou: ${resp.status()} ${ct}`);
  await d.waitForTimeout(800);
  await d.screenshot({ path: `${OUT}/fase2-06-doc-watermark.png` });
  const verified = (await get(`/clients/${target.id}/documents`)).find((x) => x.id === doc.id);
  if (verified.status !== 'VERIFICADO' || verified.views < 1) throw new Error('documento não verificado / sem log de visualização');
  step(`Dono verificou o documento e abriu a imagem com marca d'água (JPEG, ${verified.views} visualização registrada)`);
  await d.locator('[aria-label="Fechar"]').first().click();

  // ---------- Funcionário anexa comprovante enviado pelo cliente ----------
  const recBefore = await get(`/clients/${target.id}/receipts`);
  await m.reload();
  await tid(m, 'creceipt-add').waitFor();
  await tid(m, 'creceipt-add').click();
  await tid(m, 'creceipt-modal').waitFor();
  [chooser] = await Promise.all([m.waitForEvent('filechooser'), tid(m, 'creceipt-file').locator('[role=button]').first().click()]);
  await chooser.setFiles({ name: 'pix-cliente.png', mimeType: 'image/png', buffer: PNG });
  await tid(m, 'creceipt-file').getByText('pix-cliente.png').waitFor({ timeout: 8000 });
  await fill(m, 'creceipt-value', '25000');
  await m.screenshot({ path: `${OUT}/fase2-07-client-receipt-mobile.png` });
  await tid(m, 'creceipt-submit').click();
  await tid(m, 'creceipt-modal').waitFor({ state: 'hidden', timeout: 8000 });
  const recAfter = await get(`/clients/${target.id}/receipts`);
  const rec = recAfter.find((x) => !recBefore.some((b) => b.id === x.id));
  if (!rec || rec.informedValueCents !== 25000 || rec.status !== 'PENDENTE_CONFERENCIA') throw new Error('comprovante não criado: ' + JSON.stringify(rec));
  await tid(m, `receipt-${rec.id}`).waitFor();
  await m.screenshot({ path: `${OUT}/fase2-08-client-receipt-list-mobile.png`, fullPage: true });
  step(`Funcionário anexou o comprovante do cliente (R$ 250,00${rec.payment ? `, vinculado ao pagamento do #${rec.payment.loanCode}` : ''})`);

  // ---------- Dono confere; log de mensagens ----------
  await d.reload();
  await tid(d, `receipt-check-${rec.id}`).click();
  await tid(d, `receipt-${rec.id}`).getByText('Conferido').first().waitFor({ timeout: 8000 });
  step('Dono conferiu o comprovante');
  await d.goto(BASE + '/settings?tab=mensagens');
  await tid(d, 'message-log').getByText(marker).first().waitFor({ timeout: 8000 });
  await d.screenshot({ path: `${OUT}/fase2-09-messages-log.png` });
  step('Histórico geral de mensagens lista a cobrança firme com botão wa.me');

  // ---------- Cobrança: PDF, negativação e opt-out ----------
  await d.goto(`${BASE}/clients/${target.id}?tab=2`);
  await tid(d, 'letter-pdf').waitFor();
  const pdfResp = d.waitForResponse((r) => r.url().includes(`/clients/${target.id}/collection-letter.pdf`), { timeout: 15000 });
  const pdfPopup = d.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await tid(d, 'letter-pdf').click();
  const pr = await pdfResp;
  if (pr.status() === 200) {
    if (pr.headers()['content-type'] !== 'application/pdf') throw new Error('carta não retornou PDF');
    const pp = await pdfPopup; if (pp) await pp.close().catch(() => {});
    step('Carta de cobrança (PDF) gerada e aberta');
  } else {
    step(`Carta de cobrança: API respondeu ${pr.status()} (cliente sem dívida em aberto) - erro exibido em toast`);
  }
  const dosResp = d.waitForResponse((r) => r.url().includes(`/clients/${target.id}/dossier.pdf`), { timeout: 15000 });
  await tid(d, 'dossier-pdf').click();
  const dr = await dosResp;
  if (dr.status() !== 200 || dr.headers()['content-type'] !== 'application/pdf') throw new Error('dossiê não retornou PDF: ' + dr.status());
  step('Dossiê jurídico (PDF) gerado');
  await tid(d, 'negativate-btn').click();
  await tid(d, 'prompt-confirm').click();
  await tid(d, 'negativado-badge').waitFor({ timeout: 8000 });
  await d.screenshot({ path: `${OUT}/fase2-10-negativado.png` });
  await tid(d, 'negativate-btn').click();
  await tid(d, 'prompt-confirm').click();
  await tid(d, 'negativado-badge').waitFor({ state: 'detached', timeout: 8000 });
  step('Dono negativou e removeu a negativação (badge exibido/removido)');
  await tid(d, 'wa-optout').click();
  await d.waitForTimeout(1000);
  if (!(await get(`/clients/${target.id}`)).whatsappOptOut) throw new Error('opt-out não salvo');
  await tid(d, 'wa-optout').click();
  await d.waitForTimeout(1000);
  if ((await get(`/clients/${target.id}`)).whatsappOptOut) throw new Error('opt-out não removido');
  step('Opt-out "Não enviar WhatsApp automático" ligado e desligado');

  // ---------- Equipe: dono tenta se desativar (API recusa, sessão continua) ----------
  await d.goto(BASE + '/team');
  const me = await get('/auth/me');
  await tid(d, `user-row-edit-${me.id}`).click();
  await tid(d, 'edit-user-modal').waitFor();
  await tid(d, 'eu-active').click();
  await tid(d, 'edit-user-submit').click();
  await d.getByText('não pode desativar').first().waitFor({ timeout: 8000 });
  await d.screenshot({ path: `${OUT}/fase2-11-team-self-deactivate.png` });
  await d.waitForTimeout(1500);
  if (d.url().includes('/login')) throw new Error('dono foi deslogado ao receber o erro');
  if (!(await get('/auth/me')).isActive) throw new Error('dono ficou inativo');
  await d.locator('[aria-label="Fechar"]').first().click();
  step('Dono não consegue se desativar: erro exibido em toast e sessão mantida');

  // ---------- Restaura configuração / template ----------
  await fetch(API + '/messaging/templates/COBRANCA_FIRME', { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ text: null }) });
  await fetch(API + '/messaging/config', { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ provider: originalCfg.provider }) });
  cfg = await get('/messaging/config');
  step(`Configuração restaurada (provedor ${cfg.provider}, template padrão)`);

  await browser.close();
  if (errors.length) { console.log('ERROS:', errors); process.exit(1); }
  console.log('\nFLUXO FASE 2 OK');
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
