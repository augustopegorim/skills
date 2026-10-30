#!/usr/bin/env node
'use strict';
// Passeio por TODAS as rotas do app (checkup de segurança, seção 2b).
// Uso:  node rotas.js <URL-de-TESTE> <raiz-do-código> [--baixo="sid=..."] [--logado="sid=..."] [--publicas=/a,/b] [--pausa=60]
//  1. lê o código e monta a lista de rotas (app.get/post/put/delete/patch, router.*, api.*);
//  2. chama cada uma SEM login  → tudo que não for 401/403 e não estiver na lista de públicas é FALHA;
//  3. com --baixo (usuário de poucas permissões): mostra rotas que ele alcança (2xx) para você conferir se devia;
//  4. com --logado (admin): acusa rota que dá erro 5xx (quebra / vaza erro).
// SÓ rode contra uma cópia de teste (banco descartável): POST/PUT/DELETE são enviados de verdade.
const fs = require('fs'), path = require('path');
const [base, root = '.'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
if (!base || !/^https?:\/\/(localhost|127\.|\[::1\])/.test(base)) { console.error('Informe uma URL local de TESTE (localhost). Não rode contra produção.'); process.exit(2); }
const publicas = new Set(opt('publicas').split(',').filter(Boolean)), pausa = Number(opt('pausa') || 60);
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  if (['node_modules', '.git', 'dist', 'public', 'zima', 'docs'].includes(f.name)) continue;
  const p = path.join(d, f.name); f.isDirectory() ? walk(p) : /\.js$/.test(f.name) && !/\.test\.js$/.test(f.name) && files.push(p); } })(root);
const rx = /\b(?:app|router|r|api|docs|a)\.(get|post|put|delete|patch)\(\s*(['"`])(\/[^'"`]*)\2/g, rotas = new Map();
for (const f of files) { const t = fs.readFileSync(f, 'utf8'); let m; while ((m = rx.exec(t))) {
  if (m[3].includes('${')) continue; rotas.set(m[1].toUpperCase() + ' ' + m[3], path.basename(f)); } }
const url = p => p.replace(/:(\w+)(\([^)]*\))?\??/g, (_, n) => (/id$|^n$|num/i.test(n) ? '1' : 'x1'));
const call = async (m, p, cookie) => { try { const r = await fetch(base + url(p), { method: m, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: /POST|PUT|PATCH/.test(m) ? '{}' : undefined }); return r.status; } catch { return 0; } };
(async () => {
  const sem = [], baixo = [], erro = []; let n = 0;
  for (const [k, f] of rotas) {
    const [m, p] = k.split(' '); n++;
    let s = await call(m, p); if (s === 429) { await new Promise(r => setTimeout(r, 1500)); s = await call(m, p); }
    if (!(s === 401 || s === 403 || s === 404 || s === 405) && !publicas.has(p)) sem.push(`${s} ${m} ${p}  (${f})`);
    if (opt('baixo')) { const b = await call(m, p, opt('baixo')); if (b >= 200 && b < 300) baixo.push(`${b} ${m} ${p}  (${f})`); }
    if (opt('logado')) { const l = await call(m, p, opt('logado')); if (l >= 500) erro.push(`${l} ${m} ${p}  (${f})`); }
    await new Promise(r => setTimeout(r, pausa));
  }
  console.log(`Rotas encontradas: ${n}`);
  console.log(`\n== SEM LOGIN respondeu algo diferente de 401/403 (cada uma precisa ser pública DE PROPÓSITO): ${sem.length}`); sem.forEach(x => console.log('  ' + x));
  if (opt('baixo')) { console.log(`\n== Usuário de poucas permissões alcançou (2xx) — conferir se devia: ${baixo.length}`); baixo.forEach(x => console.log('  ' + x)); }
  if (opt('logado')) { console.log(`\n== Logado deu erro 5xx com corpo vazio: ${erro.length}`); erro.forEach(x => console.log('  ' + x)); }
})();
