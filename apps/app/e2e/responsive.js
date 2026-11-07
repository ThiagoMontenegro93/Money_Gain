const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const API = BASE + '/api';
const OUT = process.argv[2];
(async () => {
  const j = (r) => r.json();
  const login = async (email) => (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Lend@2026' }) }).then(j));
  const t = await login('thiago@lendcontrol.app');
  const h = { authorization: 'Bearer ' + t.accessToken };
  const clients = (await fetch(API + '/clients', { headers: h }).then(j)).items;
  const loans = await fetch(API + '/loans', { headers: h }).then(j);
  const byCls = (c) => clients.find((x) => x.classificacao === c).id;
  const routes = [
    ['dashboard', '/'], ['clients', '/clients'], ['client-new', '/clients/new'],
    ['client-bom', `/clients/${byCls('BOM')}`], ['client-ruim', `/clients/${byCls('RUIM')}`], ['client-perda', `/clients/${byCls('PERDA')}`],
    ['client-edit', `/clients/${byCls('BOM')}/edit`], ['loans', '/loans'], ['loan-new', '/loans/new'],
    ['loan-detail', `/loans/${loans.find((l) => l.overdueCount > 0).id}`], ['approvals', '/approvals'], ['team', '/team'], ['settings', '/settings'],
  ];
  const vps = [['desktop', 1440, 900], ['laptop', 1280, 800], ['tablet', 768, 1024], ['mobile', 390, 844]];
  const browser = await chromium.launch();
  const failures = [];
  for (const role of ['thiago@lendcontrol.app', 'carlos@lendcontrol.app']) {
    const auth = await login(role);
    for (const [vname, w, hgt] of vps) {
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
      await page.goto(BASE + '/login');
      await page.evaluate((a) => { try { localStorage.setItem('lendcontrol.token', a); } catch {} }, auth.accessToken);
      // login pela UI (independe da chave de storage)
      await page.goto(BASE + '/login');
      await page.waitForTimeout(800);
      if (page.url().includes('/login')) {
        const inputs = page.locator('input');
        await inputs.nth(0).fill(role);
        await inputs.nth(1).fill('Lend@2026');
        await page.keyboard.press('Enter');
        await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 10000 }).catch(() => {});
      }
      for (const [name, path] of routes) {
        if (role.startsWith('carlos') && /client-(bom|ruim|perda|edit)|loan-detail/.test(name)) continue;
        errors.length = 0;
        await page.goto(BASE + path);
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(600);
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const docOverflow = document.documentElement.scrollWidth - vw;
          const offenders = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // ignora conteúdo dentro de scroll horizontal intencional
            let p = el.parentElement, inScroll = false;
            while (p) { const cs = getComputedStyle(p); if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { inScroll = true; break; } p = p.parentElement; }
            if (!inScroll && (r.right > vw + 1 || r.left < -1)) offenders.push((el.innerText || el.tagName).slice(0, 40));
          }
          const scrollers = [...document.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 2; }).length;
          const text = document.body.innerText;
          return { docOverflow, offenders: offenders.slice(0, 3), scrollers, len: text.length, err: /Erro|Não encontrado|Sem permissão/.test(text.slice(0, 400)) };
        });
        const problems = [];
        if (m.docOverflow > 1) problems.push(`overflow da página ${m.docOverflow}px`);
        if (m.offenders.length) problems.push(`fora da tela: ${JSON.stringify(m.offenders)}`);
        if (w >= 1280 && m.scrollers) problems.push(`${m.scrollers} área(s) com rolagem horizontal no desktop`);
        if (m.len < 80) problems.push('tela vazia');
        if (errors.length) problems.push('console: ' + errors.slice(0, 2).join(' | '));
        const tag = `${role.split('@')[0]}/${name}/${vname}`;
        if (problems.length) failures.push(`${tag}: ${problems.join('; ')}`);
        if (role.startsWith('thiago')) await page.screenshot({ path: `${OUT}/${name}-${vname}.png`, fullPage: false });
        console.log((problems.length ? '✗ ' : '✓ ') + tag + (problems.length ? '  ' + problems.join('; ') : ''));
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${failures.length} falha(s)`);
  process.exit(failures.length ? 1 : 0);
})();
