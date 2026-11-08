'use strict';
// Guarda de fotos e XML enviados ao sistema (pedido do Augusto, 08/11/2026). Todo arquivo que é FOTO ou XML é lido num processo isolado (sandbox:
// `node --permission`, sem ambiente, sem gravar, sem abrir processos — ver uploadguard-worker.js) e conferido por uploadguard-core.js. Se tiver
// qualquer coisa além do esperado, o arquivo é DESCARTADO (nada é gravado) e a recusa fica registrada; se passar, o que se guarda é a versão
// reconstruída só com as partes esperadas. PDF, áudio e outros tipos passam como antes (fora deste pedido).
// Uso: `const UG = require('./uploadguard').get()` — upload = UG.wrapMulter(multer({...})); UG.cleanDataUrl(); UG.checkXmlText().
const { fork } = require('child_process'), path = require('path'), fs = require('fs'), crypto = require('crypto');
const core = require('./uploadguard-core.js');

const WORKER = path.join(__dirname, 'uploadguard-worker.js');
const MAX_PAR = 3, MAX_QUEUE = 40, TIMEOUT_MS = 20000, MAX_BYTES = 110 * 1024 * 1024;
let current = null;

const FAMILY = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/pjpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
  'image/svg+xml': 'svg', 'text/xml': 'xml', 'application/xml': 'xml', 'application/pdf': 'pdf' };
// o que o navegador/aparelho DIZ que é (só vale como conferência: o tipo de verdade vem do conteúdo). Áudio é uma família só (aparelhos rotulam errado).
const declaredOf = m => { m = String(m || '').split(';')[0].trim().toLowerCase(); if (!m) return ''; if (FAMILY[m]) return FAMILY[m]; if (/^audio\//.test(m) || /^video\/(webm|mp4|3gpp|ogg)$/.test(m)) return 'audio'; if (/^image\//.test(m)) return 'imagem-desconhecida'; return ''; };
const allowOf = (a, req, f) => { a = typeof a === 'function' ? a(req, f) : a; return typeof a === 'string' ? core.PRESETS[a] : a || core.PRESETS.fotos; };

// db, filecrypt e audit são opcionais: sem db a recusa só vai para o log; sem filecrypt os arquivos em disco são lidos/gravados em claro.
function init({ db = null, UPLOADS = '', filecrypt = { readFile: p => fs.readFileSync(p), writeFile: (p, b) => fs.writeFileSync(p, b) }, audit = null, log = console.warn } = {}) {
  if (db) db.exec(`CREATE TABLE IF NOT EXISTS upload_rejects (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user TEXT NOT NULL DEFAULT '', route TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '');`);
  const stats = { checked: 0, rejected: 0, sandbox: 'não testado', selftest: null };
  let running = 0; const queue = [];

  // ---- um arquivo = um processo isolado ----
  function runWorker(msg) {
    return new Promise(resolve => {
      let done = false, child;
      const fin = r => { if (done) return; done = true; clearTimeout(timer); try { child.kill('SIGKILL'); } catch {} resolve(r); };
      const timer = setTimeout(() => fin({ ok: false, reason: 'a leitura demorou demais e foi cancelada (arquivo suspeito ou muito pesado)' }), TIMEOUT_MS);
      try {
        child = fork(WORKER, [], {
          execArgv: ['--permission', `--allow-fs-read=${WORKER}`, `--allow-fs-read=${path.join(__dirname, 'uploadguard-core.js')}`, `--allow-fs-read=${path.join(__dirname, 'uploadguard-docs.js')}`, `--allow-fs-read=${path.join(__dirname, 'uploadguard-util.js')}`, `--allow-fs-read=${path.join(__dirname, 'uploadguard-nfe-tags.js')}`,
            '--max-old-space-size=512', '--no-experimental-fetch', '--disable-proto=delete'],
          env: {}, cwd: __dirname, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
        });
      } catch (e) { return fin({ ok: false, reason: 'verificador de segurança indisponível' }); }
      let err = ''; child.stderr.on('data', d => { if (err.length < 400) err += d; });
      child.once('message', r => { if (r && r.buf && !Buffer.isBuffer(r.buf)) r.buf = Buffer.from(r.buf.buffer, r.buf.byteOffset, r.buf.byteLength); fin(r); });
      child.once('error', () => fin({ ok: false, reason: 'verificador de segurança indisponível' }));
      child.once('exit', () => setTimeout(() => fin({ ok: false, reason: 'o verificador terminou sem resposta' + (/heap|memory/i.test(err) ? ' (memória estourada)' : '') }), 50));
      try { child.send(msg); } catch { fin({ ok: false, reason: 'verificador de segurança indisponível' }); }
    });
  }
  function slot() {
    if (running < MAX_PAR) { running++; return Promise.resolve(); }
    if (queue.length >= MAX_QUEUE) return Promise.reject(new Error('cheio'));
    return new Promise((ok, no) => queue.push(ok));
  }
  const release = () => { const nx = queue.shift(); if (nx) nx(); else running--; };

  async function inspect(buf, o = {}) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || '');
    if (buf.length > MAX_BYTES) return { ok: false, kind: 'other', reason: 'arquivo grande demais' };
    try { await slot(); } catch { return { ok: false, kind: 'other', reason: 'o sistema está verificando muitos arquivos ao mesmo tempo; tente de novo em instantes' }; }
    try {
      const r = await runWorker({ buf, profile: o.profile || 'xml', allow: allowOf(o.allow) });
      stats.checked++;
      return r;
    } finally { release(); }
  }
  async function selftest() {
    const r = await runWorker({ op: 'selftest' });
    stats.selftest = r; stats.sandbox = r && r.ok ? 'ok' : 'FALHOU';
    if (!(r && r.ok)) log('uploadguard: o isolamento (sandbox) NÃO está valendo:', JSON.stringify(r));
    return r;
  }
  // na partida o servidor está ocupado (migrações, criptografia de arquivos) e pode demorar a ouvir o verificador: tenta de novo em 30 s, 60 s e 90 s antes de acusar problema
  const boot = n => selftest().then(r => { if (!(r && r.ok) && n < 3) setTimeout(() => boot(n + 1), 30000 * (n + 1)).unref(); }).catch(() => {});
  setTimeout(() => boot(0), 4000).unref();

  function logReject(req, f, kind, reason, buf) {
    stats.rejected++;
    let sha = ''; try { sha = crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex'); } catch {}
    const who = req && req.user ? (req.user.name || req.user.username || '') : 'link público';
    try {
      if (db) db.prepare('INSERT INTO upload_rejects (user, route, filename, kind, reason, size, sha256, ip) VALUES (?,?,?,?,?,?,?,?)')
        .run(String(who).slice(0, 80), String(req ? (req.baseUrl || '') + (req.path || '') : '').slice(0, 160), String(f.originalname || f.name || '').slice(0, 160), kind || '', String(reason).slice(0, 300), (buf || f.buffer || {}).length || f.size || 0, sha, String((req && req.ip) || '').slice(0, 60));
    } catch {}
    log(`uploadguard: RECUSADO "${f.originalname || f.name || ''}" (${kind || '?'}): ${reason}`);
    try { if (req && req.user && audit) audit(req, { entity: 'security', action: 'reject', summary: `Arquivo recusado por segurança: "${String(f.originalname || f.name || '').slice(0, 60)}" — ${String(reason).slice(0, 120)}` }); } catch {}
  }

  // ---- middleware: confere cada arquivo enviado por multer (em memória ou em disco criptografado) ----
  const bytesOf = f => (f.buffer ? f.buffer : f.path ? filecrypt.readFile(f.path) : Buffer.alloc(0));
  const discard = list => list.forEach(f => { if (f.path) fs.rm(f.path, { force: true }, () => {}); });
  const allFiles = req => (req.file ? [req.file] : Array.isArray(req.files) ? req.files : req.files ? Object.values(req.files).flat() : []);
  function guardMw(opt = {}) {
    return async (req, res, next) => {
      const files = allFiles(req);
      try {
        for (const f of files) {
          const buf = bytesOf(f), allow = allowOf(opt.allow, req, f), kind = core.detectAny(buf, allow), declared = declaredOf(f.mimetype);
          let reason = '';
          if (declared && kind === 'other') reason = 'o arquivo diz ser ' + (declared === 'audio' ? 'áudio' : declared === 'imagem-desconhecida' ? 'imagem' : declared) + ', mas o conteúdo não é';
          else if (declared === 'audio' ? !core.AUDIO.includes(kind) : declared && declared !== 'imagem-desconhecida' && declared !== kind && !(declared === 'xml' && kind === 'svg') && !(declared === 'svg' && kind === 'xml')) reason = `o tipo informado (${f.mimetype}) não bate com o conteúdo (${core.LABEL[kind] || kind})`;
          else if (declared === 'imagem-desconhecida') reason = `o tipo informado (${f.mimetype}) não é aceito`;
          let r = null;
          if (!reason) {
            const profile = typeof opt.profile === 'function' ? opt.profile(req, f) : (opt.profile || 'xml');
            r = await inspect(buf, { profile, allow }); if (!r.ok) reason = r.reason;
          }
          if (reason) {
            logReject(req, f, kind, reason, buf); discard(files);
            return res.status(422).json({ error: `Arquivo "${String(f.originalname || 'arquivo').slice(0, 80)}" recusado por segurança: ${reason}. Nada foi gravado.`, rejected: true });
          }
          // passou: o que fica é só a versão reconstruída
          if (f.buffer) { f.buffer = r.buf; f.size = r.buf.length; } else if (f.path) { filecrypt.writeFile(f.path, r.buf); f.size = r.buf.length; }
          if (core.IMAGE_KINDS.has(r.kind) || r.kind === 'svg') f.mimetype = r.mime;
        }
      } catch (e) { discard(files); console.error('uploadguard:', e); return res.status(500).json({ error: 'Não consegui verificar o arquivo com segurança. Nada foi gravado.' }); }
      next();
    };
  }
  // multer com a guarda logo depois: upload.array('files', 10) etc. continuam iguais para quem usa
  function wrapMulter(m, opt = {}) {
    const guard = guardMw(opt);
    return new Proxy(m, { get(t, k) {
      if (['single', 'array', 'fields', 'any'].includes(k)) return (...a) => { const mw = t[k](...a); return (req, res, next) => mw(req, res, err => (err ? next(err) : guard(req, res, next))); };
      return t[k];
    } });
  }

  // ---- imagem recebida como texto (assinatura desenhada, logo): "data:image/png;base64,..." ----
  async function cleanDataUrl(dataUrl, { kinds = ['png'], req = null, name = 'imagem' } = {}) {
    const m = /^data:(image\/(?:png|jpeg|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) return { ok: false, reason: 'imagem em formato inválido' };
    const buf = Buffer.from(m[2], 'base64'), kind = core.detectAny(buf, kinds), want = FAMILY[m[1]];
    let reason = kind !== want ? `o tipo informado (${m[1]}) não bate com o conteúdo (${kind})` : !kinds.includes(kind) ? 'tipo de imagem não aceito aqui' : '';
    let r = null;
    if (!reason) { r = await inspect(buf, { allow: kinds }); if (!r.ok) reason = r.reason; }
    if (reason) { logReject(req, { name }, kind, reason, buf); return { ok: false, reason }; }
    return { ok: true, kind, buf: r.buf, dataUrl: `data:${r.mime};base64,${r.buf.toString('base64')}` };
  }
  // ---- XML recebido como texto (corpo JSON) ----
  async function checkXmlText(text, profile = 'xml', req = null, name = 'xml') {
    const buf = Buffer.from(String(text || ''), 'utf8'), kind = core.detectAny(buf, ['xml']);
    let reason = kind !== 'xml' ? 'o conteúdo não é um XML' : '', r = null;
    if (!reason) { r = await inspect(buf, { profile, allow: ['xml'] }); if (!r.ok) reason = r.reason; }
    if (reason) { logReject(req, { name }, kind, reason, buf); return { ok: false, reason }; }
    return { ok: true, root: r.root };
  }
  const recent = (n = 100) => (db ? db.prepare('SELECT * FROM upload_rejects ORDER BY id DESC LIMIT ?').all(n) : []);
  const api = { inspect, PRESETS: core.PRESETS, wrapMulter, guardMw, cleanDataUrl, checkXmlText, selftest, recent, stats, core };
  current = api;
  return api;
}
module.exports = init;
module.exports.get = () => { if (!current) throw new Error('uploadguard ainda não foi iniciado (server.js)'); return current; };
