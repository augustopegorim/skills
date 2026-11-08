'use strict';
// Processo isolado (sandbox) da guarda de arquivos: nasce com `node --permission` (sem gravar em disco, sem ler nada além dos arquivos da guarda,
// sem processos nem threads), SEM variáveis de ambiente (sem senhas), sem eval de texto e sem fetch/WebSocket. Recebe os bytes do arquivo, devolve
// só o veredito e, se passou, os bytes reconstruídos. Um processo novo para cada arquivo: nada fica guardado entre um arquivo e outro.
// Quem chama (uploadguard.js) mata o processo se demorar.
//
// REDE: o Node 22 não tem permissão de rede e o contêiner não deixa criar um espaço de rede vazio (unshare é bloqueado). Por isso o bloqueio é
// feito aqui dentro, em camadas: os módulos de rede/processo/vm não carregam, e os atalhos internos (process.binding, dlopen) são removidos ANTES
// de carregar qualquer código da guarda. É defesa em camadas, não uma parede: para isolamento de rede de verdade, rode este worker num
// contêiner com `network_mode: none`.
const Module = require('module');
const DENY = new Set(['net', 'tls', 'http', 'https', 'http2', 'dgram', 'dns', 'dns/promises', 'child_process', 'cluster', 'worker_threads', 'vm', 'inspector', 'repl', 'v8', 'wasi', 'trace_events', 'diagnostics_channel']);
const realRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  const n = String(id).replace(/^node:/, '');
  if (DENY.has(n)) throw Object.assign(new Error('módulo bloqueado no verificador: ' + n), { code: 'ERR_GUARD_BLOCKED' });
  return realRequire.apply(this, arguments);
};
for (const k of ['binding', '_linkedBinding', 'dlopen', 'openStdin', 'kill', 'abort', 'chdir']) { try { Object.defineProperty(process, k, { value: undefined, writable: false, configurable: false }); } catch {} }
const { check } = require('./uploadguard-core.js');

function selftest() { // prova, de dentro, que o isolamento está valendo
  const r = {}, blocked = e => !!e && (e.code === 'ERR_ACCESS_DENIED' || e.code === 'ERR_GUARD_BLOCKED'), tryIt = (k, fn) => { try { fn(); r[k] = false; } catch (e) { r[k] = blocked(e); } };
  const fs = require('fs');
  tryIt('gravar', () => fs.writeFileSync('/tmp/uploadguard-selftest', 'x'));
  tryIt('ler_fora', () => fs.readFileSync('/etc/passwd'));
  tryIt('processo', () => require('child_process').execSync('id'));
  tryIt('thread', () => new (require('worker_threads').Worker)('1', { eval: true }));
  tryIt('rede', () => require('net').connect(9, '127.0.0.1'));
  tryIt('rede_http', () => require('http').get('http://127.0.0.1:9/'));
  tryIt('dns', () => require('dns').lookup('example.com', () => {}));
  try { new Function('return 1')(); r.eval = false; } catch (e) { r.eval = e instanceof EvalError; }
  r.sem_ambiente = Object.keys(process.env).length === 0;
  r.sem_atalhos = typeof process.binding === 'undefined' && typeof process.dlopen === 'undefined' && typeof fetch === 'undefined' && typeof WebSocket === 'undefined';
  r.ok = ['gravar', 'ler_fora', 'processo', 'thread', 'rede', 'rede_http', 'dns', 'eval', 'sem_ambiente', 'sem_atalhos'].every(k => r[k] === true);
  return r;
}

process.once('message', m => {
  let out;
  try { out = m && m.op === 'selftest' ? selftest() : check(Buffer.from(m.buf), { profile: m.profile, allow: m.allow }); }
  catch (e) { out = { ok: false, reason: 'falha ao ler o arquivo com segurança' }; }
  process.send(out, () => process.exit(0));
});
