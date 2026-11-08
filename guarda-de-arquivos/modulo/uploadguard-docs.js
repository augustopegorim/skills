'use strict';
// Guarda de arquivos — documentos e áudio (pedido do Augusto, 08/11/2026: "todo e qualquer documento"). Mesma regra das fotos: o arquivo é LIDO
// byte a byte, nada é executado; qualquer coisa além do esperado = descartado. Roda dentro do processo isolado (uploadguard-worker.js).
// Tipos: PDF, áudio (WAV, MP3, OGG, WebM, MP4/M4A/3GP, FLAC, AAC, AMR), Office (docx/xlsx/pptx e odt/ods/odp), Office antigo (doc/xls/ppt), RTF,
// texto (txt/csv/ofx), certificado (PFX/PEM/CER) e desenho CAD (DXF/DWG). Qualquer outro tipo é RECUSADO (nada passa por "não sei o que é").
const zlib = require('zlib');
const { Bad, bad, scanOrBad, scanSig } = require('./uploadguard-util.js');

const hooks = {}; // o núcleo entrega aqui o leitor de JPEG (para conferir imagens dentro do PDF)
const ascii = (b, s, e) => b.toString('latin1', s, e);
const u24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];

// ============================== PDF ==============================
// Não reconstrói (um PDF assinado digitalmente precisa ficar idêntico): confere e recusa o que executa coisas ou carrega arquivos embutidos.
const PDF_BAD = /\/(JavaScript|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData|GoToR|GoToE|Encrypt|Rendition|Movie|Sound|FileAttachment|3D|JBIG2Decode|JPXDecode)\b/;
const PDF_BAD_SHORT = /\/(?:JS|AA)\s*(?:[(<\[\/]|\d+\s+\d+\s+R)/;
const PDF_NAMES = { JavaScript: 'JavaScript', Launch: 'comando de abrir programa (Launch)', EmbeddedFile: 'arquivo embutido', EmbeddedFiles: 'arquivo embutido', RichMedia: 'mídia ativa', XFA: 'formulário ativo (XFA)', SubmitForm: 'envio de formulário', ImportData: 'importação de dados', GoToR: 'abrir arquivo externo', GoToE: 'abrir arquivo embutido', Encrypt: 'PDF criptografado (não dá para conferir)', Rendition: 'mídia ativa', Movie: 'filme embutido', Sound: 'som embutido', FileAttachment: 'anexo embutido', '3D': 'objeto 3D', JBIG2Decode: 'imagem JBIG2 (decodificador com histórico de falhas graves; reenvie com imagens JPEG)', JPXDecode: 'imagem JPEG2000 (decodificador com histórico de falhas graves; reenvie com imagens JPEG)' };
function pdfScan(text, where) {
  const t = text.replace(/#([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); // /Java#53cript também vale
  let m = PDF_BAD.exec(t); if (m) bad(`PDF com ${PDF_NAMES[m[1]] || m[1]} ${where}`);
  m = PDF_BAD_SHORT.exec(t); if (m) bad(`PDF com ação automática/JavaScript ${where}`);
}
function checkPdf(b) {
  if (!/^%PDF-[12]\.\d/.test(ascii(b, 0, 8))) bad('PDF com dados antes do cabeçalho');
  const eof = b.lastIndexOf('%%EOF'); if (eof < 0 || eof < b.length - 4096) bad('PDF sem o marcador de fim (cortado ou com dados escondidos no fim)');
  for (let i = eof + 5; i < b.length; i++) if (![0x20, 0x09, 0x0a, 0x0d, 0x00].includes(b[i])) bad(`dados escondidos depois do fim do PDF (${b.length - i} bytes)`);
  if (b.lastIndexOf('startxref', eof) < 0) bad('PDF sem tabela de referências (startxref)');
  const text = ascii(b, 0, b.length);
  pdfScan(text, 'no arquivo');
  // objetos comprimidos (/ObjStm) escondem os nomes: descomprime (com limite) e confere de novo
  let total = 0;
  for (let i = text.indexOf('/ObjStm'); i >= 0; i = text.indexOf('/ObjStm', i + 7)) {
    const s = text.indexOf('stream', i); if (s < 0) continue;
    let st = s + 6; if (text[st] === '\r') st++; if (text[st] === '\n') st++;
    const e = text.indexOf('endstream', st); if (e < 0) bad('PDF com fluxo de objetos sem fim');
    let out; try { out = zlib.inflateSync(b.subarray(st, e), { maxOutputLength: 40 * 1024 * 1024 }); } catch { bad('PDF com fluxo de objetos inválido ou grande demais'); }
    if ((total += out.length) > 120 * 1024 * 1024) bad('PDF descomprimido grande demais');
    pdfScan(ascii(out, 0, out.length), 'dentro de objetos comprimidos');
  }
  pdfImages(b, text);
  return { buf: b };
}
// imagens do PDF: cada JPEG (DCTDecode) é conferido byte a byte como foto; imagem comprimida (Flate) não pode expandir além do tamanho possível (bomba)
function pdfImages(b, text) {
  let n = 0, i = 0;
  for (;;) {
    i = text.indexOf('stream', i); if (i < 0) break;
    if (text.slice(Math.max(0, i - 3), i) === 'end') { i += 6; continue; }
    let st = i + 6; if (text[st] === '\r') st++; if (text[st] === '\n') st++;
    const e = text.indexOf('endstream', st); if (e < 0) bad('PDF com fluxo sem fim');
    const dict = text.slice(Math.max(0, text.lastIndexOf('obj', i)), i);
    i = e + 9;
    if (!/\/Subtype\s*\/Image\b/.test(dict)) continue;
    if (++n > 5000) bad('PDF com imagens demais');
    const fm = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict), names = fm ? [...fm[1].matchAll(/\/([A-Za-z0-9]+)/g)].map(x => x[1]) : [];
    let data = b.subarray(st, e); while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) data = data.subarray(0, data.length - 1);
    if (names.includes('DCTDecode')) {
      if (names.length !== 1) bad('imagem do PDF com filtros combinados que não dá para conferir');
      if (!hooks.jpeg) bad('verificador de JPEG indisponível');
      try { hooks.jpeg(data, { motion: false }); } catch (err) { if (err instanceof Bad) bad('imagem JPEG dentro do PDF recusada: ' + err.message); throw err; }
    } else if (names.length === 1 && names[0] === 'FlateDecode') {
      const w = +(/\/Width\s+(\d+)/.exec(dict) || [])[1], h = +(/\/Height\s+(\d+)/.exec(dict) || [])[1];
      const cap = Math.min(256 * 1024 * 1024, w > 0 && h > 0 ? w * h * 8 + 65536 : 64 * 1024 * 1024);
      try { zlib.inflateSync(data, { maxOutputLength: cap }); } catch { bad('imagem do PDF não descomprime ou é maior que o tamanho declarado (bomba de descompressão)'); }
    }
  }
}

// ============================== áudio ==============================
function checkWav(b) {
  if (b.readUInt32LE(4) + 8 !== b.length) bad('WAV com tamanho inconsistente (dados escondidos ou cortado)');
  let p = 12, fmt = null, data = null, fact = null;
  while (p < b.length) {
    if (p + 8 > b.length) bad('WAV cortado');
    const id = ascii(b, p, p + 4), len = b.readUInt32LE(p + 4), end = p + 8 + len + (len & 1);
    if (end > b.length + ((len & 1) ? 1 : 0)) bad('bloco WAV com tamanho inválido');
    const body = b.subarray(p + 8, Math.min(p + 8 + len, b.length));
    if (id === 'fmt ') { if (len < 16) bad('WAV com formato inválido'); fmt = b.subarray(p, p + 8 + len + (len & 1)); }
    else if (id === 'data') { if (!fmt) bad('WAV com dados antes do formato'); data = b.subarray(p, Math.min(end, b.length)); }
    else if (id === 'fact') fact = b.subarray(p, end);
    else scanOrBad(body, `bloco ${id.trim()} do WAV`, id !== 'bext'); // LIST, JUNK, cue... : conferido e DESCARTADO
    p = end;
  }
  if (!fmt || !data) bad('WAV incompleto');
  const parts = [fmt, ...(fact ? [fact] : []), data], body = Buffer.concat([Buffer.from('WAVE'), ...parts]), head = Buffer.alloc(8); head.write('RIFF'); head.writeUInt32LE(body.length, 4);
  return { buf: Buffer.concat([head, body]) };
}
const MP3_BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0], MP3_BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Frame(b, p) { // devolve o tamanho do quadro em p, ou 0 se não for um quadro MPEG camada III válido
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return 0;
  const ver = (b[p + 1] >> 3) & 3, layer = (b[p + 1] >> 1) & 3, br = b[p + 2] >> 4, sr = (b[p + 2] >> 2) & 3, pad = (b[p + 2] >> 1) & 1;
  if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return 0;
  const rate = (ver === 3 ? MP3_BR1 : MP3_BR2)[br] * 1000;
  return Math.floor(((ver === 3 ? 144 : 72) * rate) / MP3_SR[ver][sr]) + pad;
}
function checkMp3(b) {
  let p = 0;
  if (ascii(b, 0, 3) === 'ID3') { // etiqueta ID3v2: conferida e descartada
    const n = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f); if (10 + n > b.length) bad('MP3 com etiqueta inválida');
    scanOrBad(b.subarray(10, 10 + n), 'etiqueta do MP3'); p = 10 + n + ((b[5] & 0x10) ? 10 : 0);
  }
  const start = p; let frames = 0;
  while (p < b.length) {
    if (b.length - p >= 128 && ascii(b, p, p + 3) === 'TAG' && b.length - p === 128) { scanOrBad(b.subarray(p), 'etiqueta ID3v1 do MP3'); break; }
    const n = mp3Frame(b, p); if (!n) bad(`MP3 com dados que não são áudio (posição ${p}): dados escondidos ou arquivo corrompido`);
    if (p + n > b.length) bad('MP3 com último quadro incompleto (cortado ou com dados escondidos no fim)');
    p += n; frames++;
  }
  if (!frames) bad('MP3 sem áudio');
  const end = (b.length - start >= 128 && ascii(b, b.length - 128, b.length - 125) === 'TAG') ? b.length - 128 : b.length;
  return { buf: b.subarray(start, end) };
}
const OGG_T = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
function checkOgg(b) {
  let p = 0, n = 0;
  while (p < b.length) {
    if (p + 27 > b.length || ascii(b, p, p + 4) !== 'OggS' || b[p + 4] !== 0) bad('OGG com dados que não são páginas de áudio (dados escondidos ou corrompido)');
    const ns = b[p + 26]; if (p + 27 + ns > b.length) bad('OGG cortado');
    let pl = 0; for (let i = 0; i < ns; i++) pl += b[p + 27 + i];
    const len = 27 + ns + pl; if (p + len > b.length) bad('OGG cortado');
    const page = Buffer.from(b.subarray(p, p + len)), want = page.readUInt32LE(22); page.writeUInt32LE(0, 22);
    let crc = 0; for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ OGG_T[((crc >>> 24) & 0xff) ^ page[i]]) >>> 0;
    if (crc !== want) bad('OGG com página corrompida (CRC)');
    if (n < 3) scanOrBad(page.subarray(27 + ns), 'cabeçalho do OGG', false);
    p += len; n++;
  }
  if (!n) bad('OGG vazio');
  return { buf: b };
}
const MP4_TOP = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'moof', 'mfra', 'sidx', 'styp', 'pdin', 'meta', 'uuid', 'junk', 'udta']);
function mp4Kids(b, s, e) { const out = []; let p = s; while (p + 8 <= e) { const size = b.readUInt32BE(p); if (size < 8 || p + size > e) break; out.push({ type: ascii(b, p + 4, p + 8), s: p + 8, e: p + size }); p += size; } return out; }
function mp4Handlers(b, moov) { // tipos de faixa (soun = áudio, vide = vídeo) dentro de moov/trak/mdia/hdlr
  const h = []; for (const trak of mp4Kids(b, moov.s, moov.e).filter(k => k.type === 'trak')) for (const mdia of mp4Kids(b, trak.s, trak.e).filter(k => k.type === 'mdia')) for (const hd of mp4Kids(b, mdia.s, mdia.e).filter(k => k.type === 'hdlr')) if (hd.e - hd.s >= 12) h.push(ascii(b, hd.s + 8, hd.s + 12));
  return h;
}
function checkMp4(b, o = {}) {
  let p = 0, i = 0, moov = false;
  while (p < b.length) {
    if (p + 8 > b.length) bad('MP4 cortado');
    let size = b.readUInt32BE(p), hdr = 8; const type = ascii(b, p + 4, p + 8);
    if (size === 1) { if (p + 16 > b.length) bad('MP4 cortado'); const big = b.readBigUInt64BE(p + 8); if (big > BigInt(b.length)) bad('caixa MP4 grande demais'); size = Number(big); hdr = 16; }
    else if (size === 0) size = b.length - p;
    if (size < hdr || p + size > b.length) bad('caixa MP4 com tamanho inválido (dados escondidos ou cortado)');
    if (i === 0 && type !== 'ftyp') bad('MP4 sem cabeçalho no início');
    if (!MP4_TOP.has(type)) bad(`caixa MP4 não esperada (${type})`);
    if (type !== 'mdat') scanOrBad(b.subarray(p + hdr, p + size), `caixa ${type} do MP4`, false);
    if (type === 'moov' && !o.video && mp4Handlers(b, { s: p + hdr, e: p + size }).includes('vide')) bad('MP4 com vídeo (aqui só é aceito áudio)');
    if (type === 'moov' || type === 'moof') moov = true;
    p += size; i++;
  }
  if (!moov) bad('MP4 sem informações de áudio');
  return { buf: b };
}
// WebM/Matroska (gravação de voz do navegador): lê a árvore EBML; "Attachments" (arquivos embutidos) e elementos desconhecidos são recusados
const EB = { EBML: 0x1a45dfa3, SEG: 0x18538067, CLUSTER: 0x1f43b675, ATTACH: 0x1941a469 };
const EB_L1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x1043a770, 0xec, 0xbf]);
const EB_CL = new Set([0xe7, 0x5854, 0xa7, 0xab, 0xa3, 0xa0, 0xec, 0xbf]);
function ebHead(b, p) {
  if (p >= b.length) bad('WebM cortado');
  let l = 1, m = 0x80; while (l <= 4 && !(b[p] & m)) { l++; m >>= 1; } if (l > 4) bad('elemento WebM com identificador inválido');
  if (p + l > b.length) bad('WebM cortado');
  let id = 0; for (let i = 0; i < l; i++) id = id * 256 + b[p + i];
  const q = p + l; if (q >= b.length) bad('WebM cortado');
  let sl = 1, sm = 0x80; while (sl <= 8 && !(b[q] & sm)) { sl++; sm >>= 1; } if (sl > 8) bad('tamanho de elemento WebM inválido');
  if (q + sl > b.length) bad('WebM cortado');
  let v = BigInt(b[q] & (sm - 1)), all = (b[q] & (sm - 1)) === sm - 1;
  for (let i = 1; i < sl; i++) { v = (v << 8n) | BigInt(b[q + i]); if (b[q + i] !== 0xff) all = false; }
  return { id, hdr: l + sl, size: all ? -1 : Number(v), unknown: all };
}
function ebKids(b, s, e) { const out = []; let p = s; while (p < e) { let h; try { h = ebHead(b, p); } catch { break; } if (h.unknown || p + h.hdr + h.size > e) break; out.push({ id: h.id, s: p + h.hdr, e: p + h.hdr + h.size }); p += h.hdr + h.size; } return out; }
function checkWebm(b) {
  let h = ebHead(b, 0); if (h.id !== EB.EBML || h.unknown || h.size > 200 || h.hdr + h.size > b.length) bad('cabeçalho WebM inválido');
  const hd = b.subarray(h.hdr, h.hdr + h.size), at = hd.indexOf(Buffer.from([0x42, 0x82])), dt = at >= 0 ? ascii(hd, at + 3, at + 3 + (hd[at + 2] & 0x7f)) : '';
  if (dt !== 'webm' && dt !== 'matroska') bad('arquivo EBML que não é áudio/vídeo WebM'); // "DocType" precisa ser webm ou matroska
  let p = h.hdr + h.size, seg = false, clusters = 0;
  const cluster = (q, end, open) => { // lê os filhos de um Cluster; se o tamanho é desconhecido, termina no próximo elemento de nível 1
    while (q < end) {
      const c = ebHead(b, q);
      if (open && EB_L1.has(c.id) && c.id !== 0xec && c.id !== 0xbf) return q;
      if (!EB_CL.has(c.id) || c.unknown || q + c.hdr + c.size > end) bad(`elemento WebM não esperado (0x${c.id.toString(16)})`);
      q += c.hdr + c.size;
    }
    if (q > end) bad('WebM cortado'); return q;
  };
  while (p < b.length) {
    h = ebHead(b, p);
    if (h.id !== EB.SEG || seg) bad('elemento WebM não esperado fora do segmento (dados escondidos)');
    seg = true; const end = h.unknown ? b.length : p + h.hdr + h.size; if (end > b.length) bad('WebM cortado');
    let q = p + h.hdr;
    while (q < end) {
      const c = ebHead(b, q);
      if (c.id === EB.ATTACH) bad('WebM com arquivos embutidos (Attachments)');
      if (!EB_L1.has(c.id)) bad(`elemento WebM não esperado (0x${c.id.toString(16)})`);
      if (c.id === EB.CLUSTER) { clusters++; if (c.unknown) q = cluster(q + c.hdr, end, true); else { const ce = q + c.hdr + c.size; if (ce > end) bad('WebM cortado'); cluster(q + c.hdr, ce, false); q = ce; } continue; }
      if (c.unknown || q + c.hdr + c.size > end) bad('elemento WebM com tamanho inválido');
      if (c.id === 0x1654ae6b) for (const te of ebKids(b, q + c.hdr, q + c.hdr + c.size)) if (te.id === 0xae) for (const f of ebKids(b, te.s, te.e)) if (f.id === 0x83 && b[f.s] === 1) bad('WebM com vídeo (aqui só é aceito áudio)');
      if (c.id === 0x1254c367 || c.id === 0x1549a966 || c.id === 0x1043a770) scanOrBad(b.subarray(q + c.hdr, q + c.hdr + c.size), 'metadados do WebM', false);
      q += c.hdr + c.size;
    }
    p = end;
  }
  if (!seg || !clusters) bad('WebM sem áudio');
  return { buf: b };
}
const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c; } return t; })();
const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; } return t; })();
const crc8 = (b, s, e) => { let c = 0; for (let i = s; i < e; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, s, e) => { let c = 0; for (let i = s; i < e; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };
function flacHdr(b, p) { // tamanho do cabeçalho de quadro FLAC válido em p (CRC-8 confere), ou 0
  if (p + 6 > b.length || b[p] !== 0xff || (b[p + 1] & 0xfe) !== 0xf8) return 0;
  const bs = b[p + 2] >> 4, sr = b[p + 2] & 15, ch = b[p + 3] >> 4, ss = (b[p + 3] >> 1) & 7;
  if (bs === 0 || sr === 15 || ch > 10 || ss === 3 || ss === 7 || (b[p + 3] & 1)) return 0;
  const l = b[p + 4], n = l < 0x80 ? 1 : (l & 0xe0) === 0xc0 ? 2 : (l & 0xf0) === 0xe0 ? 3 : (l & 0xf8) === 0xf0 ? 4 : (l & 0xfc) === 0xf8 ? 5 : (l & 0xfe) === 0xfc ? 6 : l === 0xfe ? 7 : 0; if (!n) return 0;
  let q = p + 4 + n; if (bs === 6) q += 1; else if (bs === 7) q += 2; if (sr === 12) q += 1; else if (sr === 13 || sr === 14) q += 2;
  return q < b.length && crc8(b, p, q) === b[q] ? q + 1 - p : 0;
}
function flacFrames(b, p0) {
  let s = p0, n = 0;
  for (;;) {
    const h = flacHdr(b, s); if (!h) bad('FLAC com quadro inválido ou dados escondidos entre os quadros');
    let next = -1;
    for (let t = s + h + 2; t < b.length - 5 && next < 0; t++) if (b[t] === 0xff && flacHdr(b, t) && crc16(b, s, t - 2) === b.readUInt16BE(t - 2)) next = t;
    n++;
    if (next < 0) { if (b.length - s < h + 3 || crc16(b, s, b.length - 2) !== b.readUInt16BE(b.length - 2)) bad('FLAC com dados escondidos depois do último quadro (ou quadro corrompido)'); return n; }
    if (n > 5e6) bad('FLAC com quadros demais'); s = next;
  }
}
function checkFlac(b) {
  let p = 4, first = true, last = false; const keep = [];
  while (!last) {
    if (p + 4 > b.length) bad('FLAC cortado');
    const t = b[p] & 0x7f, len = u24(b, p + 1); last = !!(b[p] & 0x80); if (p + 4 + len > b.length) bad('bloco FLAC com tamanho inválido');
    const body = b.subarray(p + 4, p + 4 + len);
    if (first && (t !== 0 || len !== 34)) bad('FLAC sem o bloco inicial (STREAMINFO)');
    if (t === 0 || t === 3) keep.push([t, body]); else if (t === 1) { /* preenchimento: descartado */ } else if (t === 2 || t === 4 || t === 5 || t === 6) scanOrBad(body.subarray(0, Math.min(body.length, 65536)), `bloco ${t} do FLAC`); else bad(`bloco FLAC desconhecido (${t})`);
    first = false; p += 4 + len;
  }
  if (p + 2 > b.length || b[p] !== 0xff || (b[p + 1] & 0xfe) !== 0xf8) bad('FLAC sem áudio depois dos metadados');
  flacFrames(b, p);
  const out = [Buffer.from('fLaC')];
  keep.forEach(([t, body], i) => { const hd = Buffer.alloc(4); hd[0] = t | (i === keep.length - 1 ? 0x80 : 0); hd.writeUIntBE(body.length, 1, 3); out.push(hd, body); });
  out.push(b.subarray(p)); return { buf: Buffer.concat(out) };
}
function checkAac(b) {
  let p = 0, n = 0;
  if (ascii(b, 0, 3) === 'ID3') { const s = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f); scanOrBad(b.subarray(10, 10 + s), 'etiqueta do AAC'); p = 10 + s; }
  const start = p;
  while (p < b.length) {
    if (p + 7 > b.length || b[p] !== 0xff || (b[p + 1] & 0xf6) !== 0xf0 || ((b[p + 2] >> 2) & 15) > 12) bad('AAC com dados que não são áudio (dados escondidos ou corrompido)');
    const len = ((b[p + 3] & 3) << 11) | (b[p + 4] << 3) | (b[p + 5] >> 5); if (len < 7) bad('AAC com quadro inválido');
    if (p + len > b.length) bad('AAC com último quadro incompleto (cortado ou com dados escondidos no fim)'); p += len; n++;
  }
  if (!n) bad('AAC sem áudio'); return { buf: b.subarray(start) };
}
function checkAmr(b) {
  const wb = ascii(b, 0, 9) === '#!AMR-WB\n', p0 = wb ? 9 : 6, sz = wb ? [17, 23, 32, 36, 40, 46, 50, 58, 60, 5, 5, 0, 0, 0, 0, 0] : [12, 13, 15, 17, 19, 20, 26, 31, 5, 6, 5, 5, 0, 0, 0, 0];
  let p = p0, n = 0;
  while (p < b.length) { const ft = (b[p] >> 3) & 15, len = sz[ft] + 1; if ((b[p] & 0x83) || (wb ? ft >= 11 && ft <= 14 : ft >= 12 && ft <= 14)) bad('AMR com quadro inválido (dados escondidos ou corrompido)'); if (p + len > b.length) bad('AMR com dados escondidos ou cortado'); p += len; n++; }
  if (!n) bad('AMR sem áudio'); return { buf: b };
}

// ============================== ZIP: Office moderno (docx/xlsx/pptx) e OpenDocument ==============================
const ZIP_BADEXT = /\.(exe|dll|bat|cmd|com|scr|pif|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|sh|jar|msi|lnk|hta|php\d?|phtml|jsp|aspx?|cgi|so|dylib|class|apk|reg|iso)$/i;
function checkZip(b, o = {}) {
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) bad('ZIP sem índice (cortado ou corrompido)');
  const clen = b.readUInt16LE(e + 20); if (e + 22 + clen !== b.length) bad(`dados escondidos depois do fim do ZIP (${b.length - (e + 22 + clen)} bytes)`);
  if (b.readUInt16LE(e + 4) || b.readUInt16LE(e + 6)) bad('ZIP em várias partes não é aceito');
  const count = b.readUInt16LE(e + 10), cdSize = b.readUInt32LE(e + 12), cdOff = b.readUInt32LE(e + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdOff + cdSize !== e) bad('índice do ZIP inconsistente (ZIP64 ou dados escondidos)');
  if (count > 10000) bad('ZIP com arquivos demais');
  let p = cdOff, total = 0, names = [], covered = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > e || b.readUInt32LE(p) !== 0x02014b50) bad('índice do ZIP danificado');
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), cs = b.readUInt32LE(p + 20), us = b.readUInt32LE(p + 24), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const raw = b.subarray(p + 46, p + 46 + nl); let name; try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { bad('nome de arquivo inválido dentro do ZIP'); }
    p += 46 + nl + el + cl;
    if (flags & 1) bad('ZIP com arquivo protegido por senha (não dá para conferir)');
    if (method !== 0 && method !== 8) bad('ZIP com compressão não aceita');
    if (/[\x00-\x1f\\]/.test(name) || name.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(name) || /^[A-Za-z]:/.test(name) || name.length > 260) bad(`caminho suspeito dentro do ZIP (${name.slice(0, 60)})`);
    if (cs === 0xffffffff || us === 0xffffffff) bad('ZIP64 não é aceito');
    if (us > 300 * 1024 * 1024 || (total += us) > 400 * 1024 * 1024) bad('ZIP descomprimido grande demais');
    if (us > 1024 * 1024 && us / Math.max(cs, 1) > 250) bad('ZIP com compressão exagerada (bomba de descompressão)');
    if (b.readUInt32LE(off) !== 0x04034b50) bad('ZIP com bloco fora do lugar');
    const ln = b.readUInt16LE(off + 26), le = b.readUInt16LE(off + 28), ds = off + 30 + ln + le;
    if (ascii(b, off + 30, off + 30 + ln) !== ascii(raw, 0, raw.length)) bad('ZIP com nomes diferentes no índice e no bloco');
    if (ds + cs > cdOff) bad('ZIP com bloco invadindo o índice');
    covered.push([off, ds + cs]);
    if (name.endsWith('/')) { if (us) bad('pasta do ZIP com conteúdo'); names.push([name, null]); continue; }
    const data = b.subarray(ds, ds + cs); let out;
    try { out = method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: us + 1 }); } catch { bad(`arquivo do ZIP corrompido ou maior que o declarado (${name.slice(0, 40)})`); }
    if (out.length !== us || zlib.crc32(out) !== crc) bad(`arquivo do ZIP não confere com o índice (${name.slice(0, 40)})`);
    names.push([name, out]);
  }
  covered.sort((x, y) => x[0] - y[0]); let at = 0;
  for (const [s, en] of covered) { if (s - at > 0 && s !== at) bad('dados escondidos entre os arquivos do ZIP'); at = en + (b.readUInt16LE(s + 6) & 8 ? 16 : 0); if (at > cdOff) at = cdOff; }
  if (cdOff - at > 0 && covered.length) bad('dados escondidos antes do índice do ZIP');
  const list = names.map(n => n[0]), has = f => names.find(n => n[0] === f);
  let kind = 'zip';
  if (has('[Content_Types].xml')) kind = 'ooxml'; else if (list[0] === 'mimetype' && has('META-INF/manifest.xml')) kind = 'odf';
  for (const nm of list) {
    if (ZIP_BADEXT.test(nm)) bad(`programa/script dentro do arquivo (${nm.slice(0, 50)})`);
    if (kind === 'ooxml' && (/vbaProject|vbaData|\/macros\/|macrosheets\/|dialogsheets\/|activeX|\/embeddings\/|oleObject|\.bin$/i.test(nm) && !/printerSettings\d*\.bin$/i.test(nm))) bad(`macro ou objeto embutido no documento (${nm.slice(0, 50)})`);
    if (kind === 'odf' && /^(Scripts|Basic)\/|\.(class|bin)$/i.test(nm)) bad(`macro dentro do documento (${nm.slice(0, 50)})`);
  }
  if (kind === 'ooxml') {
    const ct = has('[Content_Types].xml')[1].toString('utf8');
    if (/macroEnabled|vbaProject|oleObject|activeX/i.test(ct)) bad('documento com macro (macroEnabled)');
    for (const [nm, d] of names) if (d && /\.rels$/i.test(nm)) for (const m of d.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
      const t = m[0]; if (!/TargetMode\s*=\s*["']External["']/i.test(t)) continue;
      if (/Type\s*=\s*["'][^"']*\/(oleObject|attachedTemplate|frame|subDocument|externalLink|package|image|audio|video)["']/i.test(t) || /Target\s*=\s*["'](?:file:|\\\\|[A-Za-z]:)/i.test(t)) bad('documento que carrega arquivo de fora (modelo/objeto externo)');
    }
  }
  if (kind === 'odf') { const mt = has('mimetype')[1].toString('utf8'); if (!/^application\/vnd\.oasis\.opendocument\./.test(mt)) bad('OpenDocument com tipo inválido'); }
  return { buf: b, kind };
}

// ============================== Office antigo (doc/xls/ppt): estrutura CFB + recusa macros/objetos embutidos ==============================
const OLE_BAD = new Set(['vba', '_vba_project', '_vba_project_cur', 'project', 'projectwm', 'macros', 'objectpool', '\x01ole10native', 'ole10native', 'encryptedpackage', 'encryptioninfo', 'dataspaces', '\x01compobj_x', 'xlmacrosheet']);
function checkOle(b) {
  if (b.length < 1024) bad('arquivo do Office antigo cortado');
  const ss = 1 << b.readUInt16LE(30); if (![512, 4096].includes(ss)) bad('arquivo do Office antigo com setor inválido');
  if ((b.length - ss) % ss) bad('arquivo do Office antigo com dados escondidos no fim (tamanho fora do padrão)');
  const nSec = (b.length - ss) / ss, sec = i => { const o = ss + i * ss; if (i < 0 || i >= nSec) bad('arquivo do Office antigo com setor fora do arquivo'); return b.subarray(o, o + ss); };
  const nFat = b.readUInt32LE(44), firstDir = b.readUInt32LE(48); let fatIds = []; for (let i = 0; i < 109 && fatIds.length < nFat; i++) { const v = b.readUInt32LE(76 + i * 4); if (v < 0xfffffffa) fatIds.push(v); }
  let difat = b.readUInt32LE(68), dn = b.readUInt32LE(72);
  while (fatIds.length < nFat && dn-- > 0 && difat < 0xfffffffa) { const s = sec(difat); for (let i = 0; i < ss / 4 - 1 && fatIds.length < nFat; i++) { const v = s.readUInt32LE(i * 4); if (v < 0xfffffffa) fatIds.push(v); } difat = s.readUInt32LE(ss - 4); }
  const fat = []; for (const f of fatIds) { const s = sec(f); for (let i = 0; i < ss / 4; i++) fat.push(s.readUInt32LE(i * 4)); }
  const dir = []; let s = firstDir, guard = 0;
  while (s < 0xfffffffa && guard++ < 100000) { dir.push(sec(s)); s = fat[s]; if (s === undefined) bad('arquivo do Office antigo com cadeia inválida'); }
  if (!dir.length) bad('arquivo do Office antigo sem diretório');
  const d = Buffer.concat(dir), names = [], ents = [];
  for (let o = 0; o + 128 <= d.length; o += 128) { const nl = d.readUInt16LE(o + 64), ty = d[o + 66]; if (!ty) continue; if (nl < 2 || nl > 64) bad('arquivo do Office antigo com nome inválido'); const nm = d.toString('utf16le', o, o + nl - 2).toLowerCase(); names.push(nm); ents.push({ nm, ty, start: d.readUInt32LE(o + 116), size: d.readUInt32LE(o + 120) }); }
  for (const n of names) if (OLE_BAD.has(n) || /^_vba|^vba|macro|ole10native|objectpool/.test(n)) bad(`macro ou objeto embutido no documento (${n.replace(/[\x00-\x1f]/g, '').slice(0, 30)})`);
  if (!names.length) bad('arquivo do Office antigo vazio');
  // planilha antiga (xls): lê o fluxo "Workbook" e recusa folha de macro do Excel 4 (XLM), módulo VBA e planilha protegida por senha
  const wb = ents.find(e => e.ty === 2 && (e.nm === 'workbook' || e.nm === 'book'));
  if (wb) {
    if (wb.size > 80 * 1024 * 1024) bad('planilha antiga grande demais');
    let data;
    const chain = (start, size, fatArr, secOf) => { const parts = []; let s = start, g = 0; while (s < 0xfffffffa && g++ < 400000) { parts.push(secOf(s)); s = fatArr[s]; if (s === undefined) bad('planilha antiga com cadeia inválida'); } return Buffer.concat(parts).subarray(0, size); };
    if (wb.size >= b.readUInt32LE(56)) data = chain(wb.start, wb.size, fat, sec);
    else { // fluxo pequeno: fica no "mini fluxo"
      const root = ents.find(e => e.ty === 5); if (!root) bad('planilha antiga sem raiz');
      const mfat = []; let ms = b.readUInt32LE(60), mg = 0; while (ms < 0xfffffffa && mg++ < 100000) { const x = sec(ms); for (let i = 0; i < ss / 4; i++) mfat.push(x.readUInt32LE(i * 4)); ms = fat[ms]; if (ms === undefined) bad('planilha antiga com cadeia inválida'); }
      const mini = chain(root.start, root.size, fat, sec), msz = 1 << b.readUInt16LE(32); data = chain(wb.start, wb.size, mfat, s => mini.subarray(s * msz, s * msz + msz));
    }
    let p = 0, n = 0;
    while (p + 4 <= data.length && n++ < 3e6) {
      const id = data.readUInt16LE(p), len = data.readUInt16LE(p + 2); if (p + 4 + len > data.length) break;
      if (id === 0x002f) bad('planilha antiga protegida por senha (não dá para conferir)');
      if (id === 0x0085 && len >= 6 && (data[p + 4 + 5] === 1 || data[p + 4 + 5] === 6)) bad('planilha antiga com folha de macro (Excel 4/VBA)');
      if (id === 0x0809 && len >= 4 && (data.readUInt16LE(p + 4 + 2) === 0x0040)) bad('planilha antiga com folha de macro (Excel 4)');
      p += 4 + len;
    }
  }
  return { buf: b };
}

// ============================== RTF ==============================
function checkRtf(b) {
  const t = ascii(b, 0, b.length); if (!/^\s*\{\\rtf1/.test(t)) bad('RTF inválido');
  const m = /\\(objdata|objemb|objautlink|objlink|objupdate|objclass|objocx)\b|\\\*\\(template|datastore|passwordhash|ddeservice)\b|\\\*\\objdata/i.exec(t); if (m) bad(`RTF com objeto/modelo embutido (${(m[1] || m[2] || m[0].replace(/[^a-z]/gi, '')).toLowerCase()})`);
  let depth = 0, end = -1; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '\\') { i++; continue; } if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } if (depth < 0) bad('RTF mal formado'); } }
  if (end < 0) bad('RTF mal formado (chaves sem fechar)'); if (t.slice(end + 1).trim()) bad('dados escondidos depois do fim do RTF');
  scanOrBad(t, 'RTF', false); return { buf: b };
}

// ============================== texto (txt/csv/ofx/log) ==============================
function checkText(b) {
  for (let i = 0; i < b.length; i++) { const c = b[i]; if (c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12) bad('texto com caracteres de controle (arquivo binário disfarçado)'); if (c === 0x7f) bad('texto com caractere inválido'); }
  let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { s = ascii(b, 0, b.length); if (/[\x80-\x9f]/.test(s) && /[\x80-\x9f]{2}/.test(s)) bad('texto com codificação inválida'); }
  // arquivo de texto é dado (nunca executado aqui): scripts de terminal (.sh/.ps1/.bat) são texto comum e passam; PHP/HTML/JavaScript embutido não
  scanOrBad(s, 'texto', true, new Set(['script de terminal', 'comando de sistema', 'chamada de comando'])); return { buf: b };
}

// ============================== certificado digital (PFX/P12, PEM, CER) ==============================
function berWalk(b, p, end, depth, st) {
  while (p < end) {
    if (++st.n > 200000 || depth > 14) bad('certificado com estrutura grande ou profunda demais');
    const t = b[p++]; if (p >= end + 0 && p > b.length) bad('certificado cortado');
    if ((t & 0x1f) === 0x1f) { while (p < end && b[p] & 0x80) p++; p++; }
    if (p >= b.length) bad('certificado cortado');
    let len = b[p++], indef = false;
    if (len & 0x80) { const k = len & 0x7f; if (k === 0) { if (!(t & 0x20)) bad('certificado com tamanho indefinido em campo simples'); indef = true; } else { if (k > 4 || p + k > end) bad('certificado com tamanho inválido'); len = 0; for (let i = 0; i < k; i++) len = len * 256 + b[p++]; } }
    if (indef) { let q = p; for (;;) { if (q + 2 > end) bad('certificado cortado'); if (b[q] === 0 && b[q + 1] === 0) break; q = berOne(b, q, end, depth + 1, st); } p = q + 2; }
    else { if (p + len > end) bad('certificado com tamanho maior que o arquivo'); if (t & 0x20) berWalk(b, p, p + len, depth + 1, st); p += len; }
  }
  if (p !== end) bad('certificado com bytes sobrando');
}
function berOne(b, p, end, depth, st) { // um elemento só; devolve a posição seguinte
  const t = b[p]; let q = p + 1; if ((t & 0x1f) === 0x1f) { while (q < end && b[q] & 0x80) q++; q++; }
  let len = b[q++], indef = false;
  if (len & 0x80) { const k = len & 0x7f; if (!k) indef = true; else { if (k > 4) bad('certificado com tamanho inválido'); len = 0; for (let i = 0; i < k; i++) len = len * 256 + b[q++]; } }
  if (indef) { let r = q; for (;;) { if (r + 2 > end) bad('certificado cortado'); if (b[r] === 0 && b[r + 1] === 0) break; r = berOne(b, r, end, depth + 1, st); } return r + 2; }
  if (q + len > end) bad('certificado com tamanho maior que o arquivo'); if (t & 0x20) berWalk(b, q, q + len, depth + 1, st); return q + len;
}
function checkDer(b) {
  if (b[0] !== 0x30) bad('certificado sem a estrutura esperada'); berWalk(b, 0, b.length, 0, { n: 0 });
  return { buf: b, kind: b[1] > 0x80 && b[2 + (b[1] & 0x7f)] === 0x02 && b[3 + (b[1] & 0x7f)] === 1 && b[4 + (b[1] & 0x7f)] === 3 ? 'pfx' : 'der' };
}
function checkPem(b) {
  const t = ascii(b, 0, b.length).replace(/\r/g, ''); let rest = t, n = 0;
  const re = /^\s*-----BEGIN ([A-Z0-9 ]{3,40})-----\n([A-Za-z0-9+\/=\n]+?)\n?-----END \1-----\s*/;
  while (rest.trim()) { const m = re.exec(rest); if (!m) bad('PEM com texto fora dos blocos do certificado (dados escondidos)'); if (!/^(CERTIFICATE|PRIVATE KEY|ENCRYPTED PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY|PUBLIC KEY|PKCS7|TRUSTED CERTIFICATE|X509 CRL)$/.test(m[1])) bad(`bloco PEM não esperado (${m[1]})`); checkDer(Buffer.from(m[2].replace(/\n/g, ''), 'base64')); rest = rest.slice(m[0].length); if (++n > 20) bad('PEM com blocos demais'); }
  if (!n) bad('PEM vazio'); return { buf: b };
}

// ============================== desenho CAD (DXF/DWG) ==============================
function checkDxf(b) {
  if (ascii(b, 0, 22) === 'AutoCAD Binary DXF\r\n\x1a\0') { if (b.length > 100 * 1024 * 1024) bad('DXF grande demais'); return { buf: b, kind: 'dxf' }; }
  const t = ascii(b, 0, b.length).replace(/\r/g, ''); const L = t.split('\n'); while (L.length && L[L.length - 1].trim() === '') L.pop();
  if (L.length < 6 || L.length % 2) bad('DXF com linhas fora do par código/valor'); if (!/^\s*0$/.test(L[0]) || L[1].trim() !== 'SECTION') bad('DXF sem a seção inicial');
  for (let i = 0; i < L.length; i += 2) { if (!/^\s*-?\d{1,4}$/.test(L[i])) bad(`DXF com código inválido na linha ${i + 1}`); if (L[i + 1].length > 4096) bad('DXF com valor grande demais'); }
  if (L[L.length - 1].trim() !== 'EOF') bad('DXF sem o fim (EOF): cortado ou com dados escondidos');
  scanOrBad(t, 'DXF', false); return { buf: b, kind: 'dxf' };
}
function checkDwg(b) {
  if (!/^AC10\d\d$/.test(ascii(b, 0, 6)) || b.length < 100) bad('DWG inválido'); if (b.length > 100 * 1024 * 1024) bad('DWG grande demais');
  scanOrBad(b, 'DWG', 'long'); // o interior do DWG é comprimido e não é lido; procura só assinaturas longas de programa/PDF/arquivo compactado embutidos
  return { buf: b, kind: 'dwg' };
}

// ============================== reconhecer o tipo pelo CONTEÚDO ==============================
const HEIC = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif']);
function detectDoc(b, allow) {
  const has = k => allow.has(k);
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return 'wav';
  if (b.length >= 4 && ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (b.length >= 4 && b.readUInt32BE(0) === EB.EBML) return 'webm';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && !HEIC.has(ascii(b, 8, 12))) return 'mp4';
  if (b.length >= 4 && ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (b.length >= 6 && (ascii(b, 0, 6) === '#!AMR\n' || ascii(b, 0, 9) === '#!AMR-WB\n')) return 'amr';
  if (b.length >= 10 && ascii(b, 0, 3) === 'ID3') { let i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)); return b[i] === 0xff && (b[i + 1] & 0xf6) === 0xf0 ? 'aac' : 'mp3'; }
  if (b.length >= 4 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return ((b[1] >> 1) & 3) === 0 ? 'aac' : 'mp3';
  if (b.length >= 4 && ascii(b, 0, 4) === 'PK\x03\x04') return 'zip';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'ole';
  if (b.length >= 5 && /^\s*\{\\rtf/.test(ascii(b, 0, 12))) return 'rtf';
  if (/^-----BEGIN [A-Z0-9 ]{3,40}-----/.test(ascii(b, 0, 60).trimStart())) return 'pem';
  if (b.length >= 6 && /^AC10\d\d/.test(ascii(b, 0, 6))) return 'dwg';
  if (b.length >= 22 && ascii(b, 0, 18) === 'AutoCAD Binary DXF') return 'dxf';
  if (has('dxf') && /^\s*0\r?\nSECTION\r?\n/.test(ascii(b, 0, 40))) return 'dxf';
  if ((has('der') || has('pfx')) && b[0] === 0x30 && b.length > 4) return 'der';
  if (has('text')) return 'text'; // o que sobrou é lido como texto; se não for texto de verdade, a leitura recusa dizendo o motivo
  return 'other';
}
const CHECKERS = { pdf: checkPdf, wav: checkWav, mp3: checkMp3, ogg: checkOgg, webm: checkWebm, mp4: checkMp4, flac: checkFlac, aac: checkAac, amr: checkAmr, zip: checkZip, ole: checkOle, rtf: checkRtf, text: checkText, der: checkDer, pem: checkPem, dxf: checkDxf, dwg: checkDwg };
const MIME = { pdf: ['application/pdf', '.pdf'], wav: ['audio/wav', '.wav'], mp3: ['audio/mpeg', '.mp3'], ogg: ['audio/ogg', '.ogg'], webm: ['audio/webm', '.webm'], mp4: ['audio/mp4', '.m4a'], flac: ['audio/flac', '.flac'], aac: ['audio/aac', '.aac'], amr: ['audio/amr', '.amr'],
  ooxml: ['application/vnd.openxmlformats-officedocument', '.docx'], odf: ['application/vnd.oasis.opendocument', '.odt'], zip: ['application/zip', '.zip'], ole: ['application/x-ole-storage', '.doc'], rtf: ['application/rtf', '.rtf'], text: ['text/plain', '.txt'],
  pfx: ['application/x-pkcs12', '.pfx'], der: ['application/pkix-cert', '.cer'], pem: ['application/x-pem-file', '.pem'], dxf: ['application/dxf', '.dxf'], dwg: ['application/acad', '.dwg'] };
// Foto em movimento (Samsung/Google): JPEG + vídeo MP4 colado no fim (e, no Samsung, um bloco SEFH…SEFT). O vídeo é conferido e DESCARTADO:
// só a foto é guardada. Qualquer outra coisa depois do fim do JPEG continua sendo recusada.
function motionTrailer(rest) {
  let mp4 = rest;
  if (rest.length > 16 && ascii(rest, rest.length - 4, rest.length) === 'SEFT') {
    const len = rest.readUInt32LE(rest.length - 8), at = rest.length - 8 - len;
    if (len < 8 || at <= 8 || ascii(rest, at, at + 4) !== 'SEFH') bad('foto com dados escondidos depois do fim da imagem');
    scanOrBad(rest.subarray(at), 'bloco SEF da foto em movimento', false); mp4 = rest.subarray(0, at);
  }
  if (mp4.length < 32 || ascii(mp4, 4, 8) !== 'ftyp') bad(`dados escondidos depois do fim da imagem (${rest.length} bytes)`);
  checkMp4(mp4, { video: true });
}
module.exports = { detectDoc, CHECKERS, MIME, checkText, hooks, motionTrailer };
