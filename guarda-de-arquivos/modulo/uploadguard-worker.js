'use strict';
// Processo isolado (sandbox) da guarda de arquivos: nasce com `node --permission` (sem gravar em disco, sem abrir processos, sem ler nada além
// dos próprios arquivos da guarda) e SEM variáveis de ambiente (sem senhas). Recebe os bytes do arquivo, devolve só o veredito e, se passou, os bytes
// reconstruídos. Um processo novo para cada arquivo: nada fica guardado entre um arquivo e outro. Quem chama (uploadguard.js) mata o processo se demorar.
const { check } = require('./uploadguard-core.js');

function selftest() { // prova, de dentro, que o isolamento está valendo
  const r = {}, tryIt = (k, fn) => { try { fn(); r[k] = false; } catch (e) { r[k] = e && e.code === 'ERR_ACCESS_DENIED'; } };
  const fs = require('fs');
  tryIt('gravar', () => fs.writeFileSync('/tmp/uploadguard-selftest', 'x'));
  tryIt('ler_fora', () => fs.readFileSync('/etc/passwd'));
  tryIt('processo', () => require('child_process').execSync('id'));
  tryIt('thread', () => new (require('worker_threads').Worker)('1', { eval: true }));
  r.sem_ambiente = Object.keys(process.env).length === 0;
  r.ok = r.gravar && r.ler_fora && r.processo && r.thread && r.sem_ambiente;
  return r;
}

process.once('message', m => {
  let out;
  try { out = m && m.op === 'selftest' ? selftest() : check(Buffer.from(m.buf), { profile: m.profile, allow: m.allow }); }
  catch (e) { out = { ok: false, reason: 'falha ao ler o arquivo com segurança' }; }
  process.send(out, () => process.exit(0));
});
