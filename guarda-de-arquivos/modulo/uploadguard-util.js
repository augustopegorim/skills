'use strict';
// Peças comuns da guarda de arquivos (erro padrão e procura por "código escondido"). Sem disco, rede nem processos.
class Bad extends Error {}
const bad = m => { throw new Bad(m); };

// ---------- assinaturas de "código escondido" ----------
const TEXT_SIGS = [
  [/<\?php|<\?=|<%@|<%=/i, 'código de servidor (PHP/ASP)'], [/<script\b|<\/script/i, 'script (HTML/JavaScript)'], [/<svg\b|<html\b|<iframe\b|<object\b|<embed\b/i, 'página/SVG embutido'],
  [/javascript:|vbscript:|data:text\/html/i, 'endereço de script'], [/\bon(?:error|load|click|mouseover)\s*=/i, 'evento de script'],
  [/<!doctype|<!entity/i, 'declaração de documento/entidade'], [/#!\s*\/(?:bin|usr)\//, 'script de terminal'],
  [/\b(?:eval|base64_decode|system|exec|passthru|shell_exec|assert)\s*\(\s*(?:\$|["'])/i, 'chamada de comando'], [/powershell(?:\.exe)?\s+-|cmd(?:\.exe)?\s+\/c|\/bin\/(?:sh|bash)\b/i, 'comando de sistema'],
  [/\$\{\s*jndi:/i, 'injeção JNDI'],
];
const BIN_SIGS = [
  [/This program cannot be run in DOS mode/, 'programa do Windows (EXE)'], [/\x7fELF/, 'programa Linux (ELF)'], [/PK\x03\x04/, 'arquivo compactado (ZIP)'],
  [/Rar!\x1a\x07/, 'arquivo compactado (RAR)'], [/\x1f\x8b\x08/, 'arquivo compactado (GZIP)'], [/%PDF-/, 'PDF embutido'], [/7z\xbc\xaf\x27\x1c/, 'arquivo compactado (7z)'],
];
const BIN_LONG = [[/This program cannot be run in DOS mode/, 'programa do Windows (EXE)'], [/Rar!\x1a\x07[\x00\x01]/, 'arquivo compactado (RAR)'], [/7z\xbc\xaf\x27\x1c/, 'arquivo compactado (7z)'], [/%PDF-[12]\.\d/, 'PDF embutido'], [/\x7fELF[\x01\x02][\x01\x02]\x01/, 'programa Linux (ELF)']];
// binary: true = todas as assinaturas; 'long' = só as longas (para arquivo binário/comprimido, onde as curtas dariam falso alarme); false = só texto
function scanSig(buf, binary = true, skip = null) {
  const t = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf);
  for (const [re, name] of TEXT_SIGS) if (!(skip && skip.has(name)) && re.test(t)) return name;
  if (binary === 'long') { for (const [re, name] of BIN_LONG) if (re.test(t)) return name; } else if (binary) for (const [re, name] of BIN_SIGS) if (re.test(t)) return name;
  return null;
}
const scanOrBad = (buf, where, binary = true, skip = null) => { const s = scanSig(buf, binary, skip); if (s) bad(`${s} escondido em ${where}`); };


module.exports = { Bad, bad, scanSig, scanOrBad };
