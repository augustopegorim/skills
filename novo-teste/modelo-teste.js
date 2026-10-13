'use strict';
// <Assunto>: <uma frase do que o teste garante, em português>
const { req, ok, ca, ct, B, run, wait } = require('./lib');
const fs = require('fs'); fs.mkdirSync('/tmp/shots', { recursive: true });
const puppeteer = require('/app/node_modules/puppeteer-core');
run(async () => {
  const tag = String(Date.now() % 1e6);

  // ---- API ----
  const c = (await req(ca, 'POST', '/api/clients', { name: 'Cliente Modelo ' + tag })).j;
  const r = await req(ca, 'GET', '/api/clients/' + c.id);
  ok(r.s === 200 && r.j.name === c.name, 'o cadastro criado pode ser lido de volta');
  ok((await req(ct, 'GET', '/api/stock/products')).s === 403, 'o técnico (sem Estoque) é barrado');

  // ---- tela ----
  const br = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=pt-BR'] });
  const pg = await br.newPage(); const errs = []; pg.on('pageerror', x => errs.push(x.message));
  await pg.setCookie({ name: 'sid', value: ca.slice(4), url: 'http://localhost:3999' });
  const goto = async h => { await pg.goto('http://localhost:3999/' + h, { waitUntil: 'networkidle0' }); await pg.reload({ waitUntil: 'networkidle0' }); await wait(1200); await pg.evaluate(() => { const d = document.getElementById('dlg'); if (d.open) d.close(); }); };

  await pg.setViewport({ width: 1200, height: 900 });
  await goto('#/client/' + c.id);
  ok(await pg.evaluate(n => document.getElementById('app').innerText.includes(n), c.name), 'computador: a tela mostra o cliente');

  await pg.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
  await goto('#/client/' + c.id);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= 392), 'celular: a tela não rola para o lado');
  await pg.screenshot({ path: '/tmp/shots/modelo-celular.png' });

  ok(errs.length === 0, 'sem erros de script' + (errs.length ? ': ' + errs[0] : ''));
  await br.close();
});
