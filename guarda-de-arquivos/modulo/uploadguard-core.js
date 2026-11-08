'use strict';
// Guarda de arquivos enviados (pedido do Augusto, 08/11/2026): foto ou XML que chega ao sistema é LIDO e conferido byte a byte, sem executar nada;
// se tiver qualquer coisa além do que se espera (dados depois do fim da imagem, bloco desconhecido, código escondido nos metadados, DOCTYPE/entidade
// no XML, elemento que a nota fiscal não tem...) o arquivo é DESCARTADO. O que passa é reconstruído só com as partes esperadas (a foto sai sem EXIF/GPS
// e comentários, mantendo só a rotação; o XML é conferido e guardado como veio).
// Este arquivo é puro (sem disco, rede nem processos): roda dentro do processo isolado uploadguard-worker.js (sandbox) e também nos testes.
const zlib = require('zlib');
let NFE = { elements: [], attributes: [] }; try { NFE = require('./uploadguard-nfe-tags.js'); } catch {} // lista de NF-e brasileira: opcional (outros sistemas podem não ter)

const { Bad, bad, scanSig, scanOrBad } = require('./uploadguard-util.js');
const docs = require('./uploadguard-docs.js');
const ascii = (b, s, e) => b.toString('latin1', s, e);

const MAX_PIXELS = 100e6, MAX_SIDE = 30000;
const dimsOk = (w, h) => { if (!(w > 0 && h > 0)) bad('imagem sem tamanho'); if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) bad(`imagem grande demais (${w}×${h})`); };

// ---------- reconhecer o tipo pelo CONTEÚDO (nunca pelo nome ou pelo tipo informado) ----------
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif']);
function detect(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(b, 8, 12))) return 'heic';
  if (b.length >= 4 && ascii(b, 0, 4) === '%PDF') return 'pdf';
  const head = b.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head[0] === '<') return /<svg[\s>]/i.test(head) ? 'svg' : 'xml'; // <svg em qualquer lugar do começo: é tratado com o rigor de SVG (mesmo com DOCTYPE na frente)
  return 'other';
}
const KINDS = { jpeg: ['image/jpeg', '.jpg'], png: ['image/png', '.png'], gif: ['image/gif', '.gif'], webp: ['image/webp', '.webp'], heic: ['image/heic', '.heic'], svg: ['image/svg+xml', '.svg'], xml: ['application/xml', '.xml'] };
const IMAGE_KINDS = new Set(['jpeg', 'png', 'gif', 'webp', 'heic']);

// ---------- JPEG ----------
function exifOrientation(t) { // t = TIFF depois de "Exif\0\0"; qualquer defeito = orientação 1 (os metadados são descartados de qualquer jeito)
  try {
    if (t.length < 14) return 1;
    const le = ascii(t, 0, 2) === 'II'; if (!le && ascii(t, 0, 2) !== 'MM') return 1;
    const u16 = o => (le ? t.readUInt16LE(o) : t.readUInt16BE(o)), u32 = o => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
    if (u16(2) !== 42) return 1;
    const ifd = u32(4); if (ifd < 8 || ifd + 2 > t.length) return 1;
    const n = Math.min(u16(ifd), 200);
    for (let i = 0; i < n; i++) { const o = ifd + 2 + i * 12; if (o + 12 > t.length) return 1; if (u16(o) === 0x0112 && u16(o + 2) === 3) { const v = u16(o + 8); return v >= 1 && v <= 8 ? v : 1; } }
  } catch {}
  return 1;
}
function orientationSegment(o) {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]), len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), len, body]);
}
function checkJpeg(b, o = {}) {
  let p = 2, sof = null, sawSos = false, orient = 1;
  let jfif = null, adobe = null, icc = [];
  const rest = [];
  for (;;) {
    if (p >= b.length) bad('JPEG cortado: falta o marcador de fim');
    if (b[p] !== 0xff) bad('JPEG com bytes soltos entre os blocos');
    while (p < b.length && b[p] === 0xff) p++;
    const m = b[p++];
    if (m === undefined) bad('JPEG cortado');
    if (m === 0xd9) { if (!sawSos || !sof) bad('JPEG sem imagem'); if (p !== b.length) { if (o.motion) docs.motionTrailer(b.subarray(p)); else bad(`dados escondidos depois do fim da imagem (${b.length - p} bytes)`); } break; }
    if (m === 0x00 || m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) bad('marcador JPEG fora do lugar');
    if (p + 2 > b.length) bad('JPEG cortado');
    const len = b.readUInt16BE(p); if (len < 2 || p + len > b.length) bad('bloco JPEG com tamanho inválido');
    const seg = b.subarray(p + 2, p + len), full = b.subarray(p - 2, p + len), start = p - 2; p += len;
    if (m === 0xe0) { if (!jfif && ascii(seg, 0, 5) === 'JFIF\0' && seg.length >= 14 && !sof) jfif = full; else scanOrBad(seg, 'bloco APP0 do JPEG'); }
    else if (m === 0xe1) { if (ascii(seg, 0, 6) === 'Exif\0\0') orient = Math.max(orient, exifOrientation(seg.subarray(6))); scanOrBad(seg, 'metadados (EXIF/XMP) do JPEG'); }
    else if (m === 0xe2) { if (ascii(seg, 0, 12) === 'ICC_PROFILE\0' && seg.length < 70000) { scanOrBad(seg, 'perfil de cor', false); icc.push(full); } else scanOrBad(seg, 'bloco APP2 do JPEG'); }
    else if (m === 0xee && ascii(seg, 0, 5) === 'Adobe' && seg.length === 12) adobe = full;
    else if ((m >= 0xe3 && m <= 0xef) || m === 0xfe) scanOrBad(seg, m === 0xfe ? 'comentário do JPEG' : 'metadados do JPEG');
    else if (m === 0xdb || m === 0xc4 || m === 0xdd) rest.push(full);
    else if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (seg.length < 6) bad('JPEG com cabeçalho inválido');
      if (seg[0] !== 8) bad('JPEG com precisão não suportada');
      const h = seg.readUInt16BE(1), w = seg.readUInt16BE(3), nc = seg[5]; dimsOk(w, h);
      if (![1, 3, 4].includes(nc) || seg.length !== 6 + nc * 3) bad('JPEG com componentes inválidos');
      sof = { w, h }; rest.push(full);
    } else if (m === 0xda) {
      if (!sof) bad('JPEG com dados antes do cabeçalho da imagem');
      let q = p;
      for (;;) { // dados da imagem até o próximo marcador
        if (q + 1 >= b.length) bad('JPEG cortado dentro da imagem');
        if (b[q] === 0xff) { const n = b[q + 1]; if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { q += 2; continue; } if (n === 0xff) { q++; continue; } break; }
        q++;
      }
      rest.push(b.subarray(start, q)); sawSos = true; p = q;
    } else bad(`bloco JPEG desconhecido (FF${m.toString(16).toUpperCase()})`);
  }
  const out = [Buffer.from([0xff, 0xd8])];
  if (jfif) out.push(jfif);
  if (orient > 1) out.push(orientationSegment(orient));
  out.push(...icc, ...(adobe ? [adobe] : []), ...rest, Buffer.from([0xff, 0xd9]));
  return { buf: Buffer.concat(out), width: sof.w, height: sof.h };
}

// ---------- PNG ----------
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs']);
function checkPng(b) {
  const crc = zlib.crc32;
  if (typeof crc !== 'function') bad('verificador de PNG indisponível neste Node');
  let p = 8, first = true, w = 0, h = 0, ct = 0, bd = 0, il = 0, sawIend = false, sawIdat = false, idatDone = false, sawPlte = false;
  const out = [b.subarray(0, 8)], idat = [];
  while (p < b.length) {
    if (sawIend) bad(`dados escondidos depois do fim do PNG (${b.length - p} bytes)`);
    if (p + 12 > b.length) bad('PNG cortado');
    const len = b.readUInt32BE(p); if (len > 0x7fffffff || p + 12 + len > b.length) bad('bloco PNG com tamanho inválido');
    const type = ascii(b, p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len), cr = b.readUInt32BE(p + 8 + len);
    if (!/^[A-Za-z]{4}$/.test(type)) bad('bloco PNG com nome inválido');
    if (crc(b.subarray(p + 4, p + 8 + len)) !== cr) bad(`bloco PNG ${type} corrompido (CRC)`);
    if (first && type !== 'IHDR') bad('PNG sem cabeçalho IHDR no início');
    const chunk = b.subarray(p, p + 12 + len); p += 12 + len;
    if (type === 'IHDR') {
      if (!first || len !== 13) bad('cabeçalho PNG inválido');
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; dimsOk(w, h);
      const okBd = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[ct];
      if (!okBd || !okBd.includes(bd) || data[10] !== 0 || data[11] !== 0 || il > 1) bad('cabeçalho PNG com valores inválidos');
      out.push(chunk); first = false; continue;
    }
    if (type === 'IDAT') { if (idatDone) bad('blocos de imagem PNG fora de ordem'); sawIdat = true; idat.push(data); out.push(chunk); continue; }
    if (sawIdat) idatDone = true;
    if (type === 'IEND') { if (len !== 0 || !sawIdat) bad('fim de PNG inválido'); sawIend = true; out.push(chunk); continue; }
    if (type === 'PLTE') { if (sawIdat || sawPlte || len % 3 || len === 0 || len > 768) bad('paleta PNG inválida'); sawPlte = true; out.push(chunk); continue; }
    if (PNG_KEEP.has(type)) { if (sawIdat && type !== 'tRNS') { /* ancilares depois de IDAT são raros; aceitos só se esperados */ } out.push(chunk); continue; }
    if (type === 'iCCP' || type === 'eXIf' || type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'tIME' || type === 'hIST' || type === 'sPLT' || type === 'oFFs' || type === 'pCAL' || type === 'sCAL' || type === 'gIFg' || type === 'gIFx') {
      let txt = data; if (type === 'zTXt' || type === 'iCCP') { try { txt = zlib.inflateSync(data.subarray(data.indexOf(0) + 2), { maxOutputLength: 1 << 20 }); } catch { bad(`bloco PNG ${type} não descomprime`); } }
      scanOrBad(Buffer.concat([data.subarray(0, 120), txt]), `bloco ${type} do PNG`, type !== 'iCCP'); continue; // lido, conferido e DESCARTADO
    }
    if (!(type.charCodeAt(0) & 0x20)) bad(`bloco PNG obrigatório desconhecido (${type})`);
    bad(`bloco PNG desconhecido (${type})`);
  }
  if (!sawIend) bad('PNG cortado: falta o bloco de fim');
  if (ct === 3 && !sawPlte) bad('PNG indexado sem paleta');
  // a imagem tem que descomprimir exatamente no tamanho que o cabeçalho promete (nem mais, nem menos)
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], rowBytes = x => Math.ceil((x * ch * bd) / 8);
  let expected = 0;
  if (!il) expected = h * (1 + rowBytes(w));
  else for (const [xs, ys, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) { const pw = w > xs ? Math.ceil((w - xs) / dx) : 0, ph = h > ys ? Math.ceil((h - ys) / dy) : 0; if (pw && ph) expected += ph * (1 + rowBytes(pw)); }
  if (expected > 160 * 1024 * 1024) bad('PNG descomprimido grande demais');
  let raw; try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }); } catch (e) { bad('dados da imagem PNG inválidos ou maiores que o declarado'); }
  if (raw.length !== expected) bad('dados da imagem PNG com tamanho diferente do declarado');
  return { buf: Buffer.concat(out), width: w, height: h };
}

// ---------- GIF ----------
function checkGif(b) {
  let p = 6; if (b.length < 14) bad('GIF cortado');
  const w = b.readUInt16LE(6), h = b.readUInt16LE(8), pk = b[10]; dimsOk(w, h);
  p = 13; if (pk & 0x80) p += 3 * (1 << ((pk & 7) + 1));
  if (p > b.length) bad('GIF cortado');
  const out = [b.subarray(0, p)];
  const subs = (from, keep) => { // lê blocos de dados até o terminador
    let q = from; for (;;) { if (q >= b.length) bad('GIF cortado'); const n = b[q++]; if (n === 0) break; q += n; if (q > b.length) bad('GIF cortado'); }
    return q;
  };
  let frames = 0, ended = false;
  while (p < b.length) {
    if (ended) bad(`dados escondidos depois do fim do GIF (${b.length - p} bytes)`);
    const t = b[p];
    if (t === 0x3b) { out.push(b.subarray(p, p + 1)); p++; ended = true; continue; }
    if (t === 0x21) {
      const lab = b[p + 1]; if (p + 2 >= b.length) bad('GIF cortado');
      if (lab === 0xf9) { if (b[p + 2] !== 4) bad('GIF com bloco de controle inválido'); const e = subs(p + 2); out.push(b.subarray(p, e)); p = e; }
      else if (lab === 0xfe) { const e = subs(p + 2); scanOrBad(b.subarray(p + 2, e), 'comentário do GIF'); p = e; }
      else if (lab === 0xff) { const e = subs(p + 2), app = ascii(b, p + 3, p + 14); if (b[p + 2] === 11 && /^NETSCAPE2\.0$/.test(app)) out.push(b.subarray(p, e)); else scanOrBad(b.subarray(p + 2, e), 'bloco de aplicação do GIF'); p = e; }
      else bad(`bloco de extensão do GIF não esperado (0x${(lab || 0).toString(16)})`);
      continue;
    }
    if (t === 0x2c) {
      if (p + 10 > b.length) bad('GIF cortado');
      const lp = b[p + 9]; let q = p + 10; if (lp & 0x80) q += 3 * (1 << ((lp & 7) + 1));
      if (q >= b.length) bad('GIF cortado');
      const mcs = b[q]; if (mcs < 2 || mcs > 8) bad('GIF com compressão inválida');
      const e = subs(q + 1); if (++frames > 3000) bad('GIF com quadros demais');
      out.push(b.subarray(p, e)); p = e; continue;
    }
    bad(`bloco GIF desconhecido (0x${t.toString(16)})`);
  }
  if (!ended || !frames) bad('GIF incompleto');
  return { buf: Buffer.concat(out), width: w, height: h };
}

// ---------- WebP ----------
function checkWebp(b) {
  if (b.readUInt32LE(4) + 8 !== b.length) bad('WebP com tamanho inconsistente (dados escondidos ou cortado)');
  let p = 12, w = 0, h = 0, n = 0, vp8x = null, drop = 0;
  const chunks = [];
  while (p < b.length) {
    if (p + 8 > b.length) bad('WebP cortado');
    const id = ascii(b, p, p + 4), len = b.readUInt32LE(p + 4), end = p + 8 + len + (len & 1);
    if (end > b.length) bad('bloco WebP com tamanho inválido');
    const data = b.subarray(p + 8, p + 8 + len);
    if (n === 0 && !['VP8X', 'VP8 ', 'VP8L'].includes(id)) bad('WebP sem cabeçalho de imagem no início');
    if (id === 'VP8X') { if (n !== 0 || len !== 10) bad('cabeçalho WebP inválido'); w = 1 + data.readUIntLE(4, 3); h = 1 + data.readUIntLE(7, 3); dimsOk(w, h); vp8x = chunks.length; chunks.push(b.subarray(p, end)); }
    else if (id === 'VP8 ') { if (len < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) bad('imagem WebP (VP8) inválida'); if (!w) { w = data.readUInt16LE(6) & 0x3fff; h = data.readUInt16LE(8) & 0x3fff; dimsOk(w, h); } chunks.push(b.subarray(p, end)); }
    else if (id === 'VP8L') { if (len < 5 || data[0] !== 0x2f) bad('imagem WebP (VP8L) inválida'); if (!w) { const v = data.readUInt32LE(1); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1; dimsOk(w, h); } chunks.push(b.subarray(p, end)); }
    else if (id === 'ALPH' || id === 'ANIM' || id === 'ANMF') chunks.push(b.subarray(p, end));
    else if (id === 'ICCP') { scanOrBad(data, 'perfil de cor do WebP', false); chunks.push(b.subarray(p, end)); }
    else if (id === 'EXIF' || id === 'XMP ') { scanOrBad(data, `metadados (${id.trim()}) do WebP`); drop |= id === 'EXIF' ? 0x08 : 0x04; }
    else bad(`bloco WebP desconhecido (${id})`);
    p = end; n++;
  }
  if (!w || chunks.length < 1) bad('WebP sem imagem');
  if (drop && vp8x !== null) { const c = Buffer.from(chunks[vp8x]); c[8] &= ~drop; chunks[vp8x] = c; }
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]), head = Buffer.alloc(8); head.write('RIFF'); head.writeUInt32LE(body.length, 4);
  return { buf: Buffer.concat([head, body]), width: w, height: h };
}

// ---------- HEIC/HEIF (foto de iPhone): só confere a estrutura de caixas e procura código nas partes pequenas ----------
function checkHeic(b) {
  let p = 0, i = 0; const seen = new Set();
  while (p < b.length) {
    if (p + 8 > b.length) bad('HEIC cortado');
    let size = b.readUInt32BE(p), hdr = 8; const type = ascii(b, p + 4, p + 8);
    if (size === 1) { if (p + 16 > b.length) bad('HEIC cortado'); const big = b.readBigUInt64BE(p + 8); if (big > BigInt(b.length)) bad('caixa HEIC grande demais'); size = Number(big); hdr = 16; }
    else if (size === 0) size = b.length - p;
    if (size < hdr || p + size > b.length) bad('caixa HEIC com tamanho inválido');
    if (i === 0 && type !== 'ftyp') bad('HEIC sem cabeçalho no início');
    if (!['ftyp', 'meta', 'mdat', 'free', 'skip'].includes(type)) bad(`caixa HEIC não esperada (${type})`);
    if (type !== 'mdat') scanOrBad(b.subarray(p + hdr, p + size), `caixa ${type} do HEIC`);
    seen.add(type); p += size; i++;
  }
  if (!seen.has('meta') || !seen.has('mdat')) bad('HEIC incompleto');
  return { buf: b, width: 0, height: 0 };
}

// ---------- XML (Elétrica/NF-e/NFS-e/SVG): leitor estrito, sem DTD, sem entidades, sem CDATA, sem comentários ----------
const NS_NFE = 'http://www.portalfiscal.inf.br/nfe', NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#', NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
const NS_SVG = 'http://www.w3.org/2000/svg', NS_XLINK = 'http://www.w3.org/1999/xlink';
const NFE_EL = new Set(NFE.elements), NFE_AT = new Set(NFE.attributes);
const SVG_EL = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'title', 'desc', 'text', 'tspan', 'use', 'symbol']);
const SVG_AT = new Set('id class x y x1 y1 x2 y2 cx cy r rx ry fx fy width height d points fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity transform viewBox preserveAspectRatio version offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod clip-path clip-rule mask font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing dx dy style href xlink:href patternUnits patternTransform maskUnits clipPathUnits'.split(' '));
const svgValueOk = (name, v) => {
  if (/javascript:|vbscript:|data:|expression\(|@import|<|&#/i.test(v)) return false;
  if (name === 'href' || name === 'xlink:href') return /^#[\w.-]+$/.test(v);
  for (const m of v.matchAll(/url\(\s*([^)]*)\)/gi)) if (!/^["']?#[\w.-]+["']?$/.test(m[1].trim())) return false;
  return true;
};
const PROFILES = {
  xml: { max: 3e6, roots: null, el: null, at: null, ns: new Set([NS_NFE, NS_DSIG, NS_NFSE]), requireNs: false },
  nfe: { max: 3e6, roots: new Set(['nfeProc', 'NFe', 'procEventoNFe', 'procInutNFe', 'procCancNFe']), el: NFE_EL, at: n => NFE_AT.has(n), ns: new Set([NS_NFE, NS_DSIG]), requireNs: false },
  nfse: { max: 3e6, roots: null, el: null, at: null, ns: new Set([NS_NFSE, NS_DSIG, NS_NFE]), requireNs: false },
  ofx: { max: 8e6, roots: new Set(['OFX']), el: null, at: null, ns: new Set(), requireNs: false, pi: /^<\?OFX\s[^?>]*\?>/ },
  svg: { max: 512 * 1024, roots: new Set(['svg']), el: SVG_EL, at: (n, v) => SVG_AT.has(n) && svgValueOk(n, v), ns: new Set([NS_SVG, NS_XLINK]), requireNs: true, prefixes: new Set(['xlink']), rebuild: true },
};
const NAME_RE = /[A-Za-z_][A-Za-z0-9_.-]{0,63}/y;
const esc = (v, attr) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(attr ? /"/g : /(?!)/g, '&quot;');
function entityOk(t, where) {
  for (let i = t.indexOf('&'); i >= 0; i = t.indexOf('&', i + 1)) {
    const m = /^&(?:(?:amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/.exec(t.slice(i, i + 12));
    if (!m) bad(`referência de entidade não permitida em ${where} (entidades externas/definidas no arquivo são recusadas)`);
    const cp = m[1] ? +m[1] : m[2] ? parseInt(m[2], 16) : 0x20;
    if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff))) bad(`caractere inválido em ${where}`);
  }
}
const unescXml = t => t.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] || String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))));
function checkXml(buf, o = {}) {
  const prof = PROFILES[o.profile || 'xml']; if (!prof) bad('perfil de XML desconhecido');
  if (buf.length > (o.maxBytes || prof.max)) bad('XML grande demais');
  let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { bad('o XML não está em UTF-8 válido'); }
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(s)) bad('caracteres de controle dentro do XML');
  const n = s.length; let i = 0;
  const ws = () => { while (i < n && (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++; };
  ws();
  if (s.startsWith('<?xml', i)) {
    const m = /^<\?xml\s+version\s*=\s*["']1\.[01]["'](?:\s+encoding\s*=\s*["'](?:UTF-8|utf-8)["'])?(?:\s+standalone\s*=\s*["'](?:yes|no)["'])?\s*\?>/.exec(s.slice(i, i + 300));
    if (!m) bad('declaração <?xml ... ?> inválida (só UTF-8 é aceito)'); i += m[0].length; ws();
  }
  const stack = [], out = []; let root = null, count = 0, depth = 0, textTotal = 0;
  while (i < n) {
    if (s[i] !== '<') { // texto
      const j = s.indexOf('<', i), e = j < 0 ? n : j, t = s.slice(i, e);
      if (!stack.length) { if (t.trim()) bad('texto fora do elemento principal do XML'); }
      else {
        if (t.length > 200000 || (textTotal += t.length) > 4e6) bad('texto grande demais no XML');
        entityOk(t, 'texto do XML'); if (t.includes(']]>')) bad('sequência ]]> no texto do XML');
        const sig = scanSig(unescXml(t), false); if (sig) bad(`${sig} escondido em texto do XML`);
        if (prof.rebuild) out.push(esc(t));
      }
      i = e; continue;
    }
    const c = s[i + 1];
    if (c === '!') bad(s.startsWith('<!--', i) ? 'comentário dentro do XML' : s.startsWith('<![CDATA[', i) ? 'seção CDATA dentro do XML' : 'DOCTYPE/ENTITY no XML (declaração de tipo de documento)');
    if (c === '?') { const pm = prof.pi && !root ? prof.pi.exec(s.slice(i, i + 400)) : null; if (!pm) bad('instrução de processamento dentro do XML'); i += pm[0].length; continue; }
    if (c === '/') {
      NAME_RE.lastIndex = i + 2; const m = NAME_RE.exec(s); let nm = m && m.index === i + 2 ? m[0] : null, k = i + 2 + (nm ? nm.length : 0);
      if (nm && s[k] === ':') { NAME_RE.lastIndex = k + 1; const m2 = NAME_RE.exec(s); if (m2 && m2.index === k + 1) { nm += ':' + m2[0]; k += 1 + m2[0].length; } }
      while (k < n && /\s/.test(s[k])) k++;
      const top = stack[stack.length - 1];
      if (!nm || s[k] !== '>' || !top || top.name !== nm) bad('XML mal formado (tag de fechamento)');
      stack.pop(); i = k + 1; if (prof.rebuild) out.push(`</${nm}>`); continue;
    }
    // tag de abertura
    NAME_RE.lastIndex = i + 1; const m = NAME_RE.exec(s); if (!m || m.index !== i + 1) bad('XML mal formado (nome de elemento)');
    let name = m[0], k = i + 1 + name.length;
    if (s[k] === ':') { NAME_RE.lastIndex = k + 1; const m2 = NAME_RE.exec(s); if (!m2 || m2.index !== k + 1) bad('XML mal formado (nome de elemento)'); name += ':' + m2[0]; k += 1 + m2[0].length; }
    const attrs = [], scope = { def: stack.length ? stack[stack.length - 1].scope.def : undefined, pfx: Object.assign({}, stack.length ? stack[stack.length - 1].scope.pfx : {}) };
    let selfClose = false;
    for (;;) {
      const before = k; while (k < n && /\s/.test(s[k])) k++;
      if (s[k] === '>') { k++; break; }
      if (s[k] === '/' && s[k + 1] === '>') { selfClose = true; k += 2; break; }
      if (k === before) bad('XML mal formado (atributos)');
      NAME_RE.lastIndex = k; const am = NAME_RE.exec(s); if (!am || am.index !== k) bad('XML mal formado (nome de atributo)');
      let an = am[0]; k += an.length;
      if (s[k] === ':') { NAME_RE.lastIndex = k + 1; const a2 = NAME_RE.exec(s); if (!a2 || a2.index !== k + 1) bad('XML mal formado (nome de atributo)'); an += ':' + a2[0]; k += 1 + a2[0].length; }
      while (k < n && /\s/.test(s[k])) k++;
      if (s[k] !== '=') bad('XML mal formado (atributo sem valor)'); k++;
      while (k < n && /\s/.test(s[k])) k++;
      const q = s[k]; if (q !== '"' && q !== "'") bad('XML mal formado (valor de atributo sem aspas)');
      const e = s.indexOf(q, k + 1); if (e < 0) bad('XML mal formado (aspas sem fechar)');
      const raw = s.slice(k + 1, e); if (raw.includes('<') || raw.length > 4096) bad('valor de atributo inválido ou grande demais'); entityOk(raw, 'atributo do XML');
      if (attrs.some(a => a[0] === an)) bad('atributo repetido no XML'); if (attrs.length >= 16) bad('elemento com atributos demais');
      attrs.push([an, unescXml(raw)]); k = e + 1;
    }
    for (const [an, av] of attrs) if (an === 'xmlns' || an.startsWith('xmlns:')) {
      if (!prof.ns.has(av)) bad(`namespace não esperado (${av.slice(0, 80)})`);
      if (an === 'xmlns') scope.def = av; else scope.pfx[an.slice(6)] = av;
    }
    const [pfx, local] = name.includes(':') ? name.split(':') : [null, name], nsUri = pfx ? scope.pfx[pfx] : scope.def;
    if (pfx && !nsUri) bad(`prefixo de namespace não declarado (${pfx})`);
    if (prof.requireNs && !nsUri) bad(`elemento sem namespace (${local})`);
    if (nsUri && !prof.ns.has(nsUri)) bad('namespace não esperado');
    if (!root) { if (prof.roots && !prof.roots.has(local)) bad(`elemento principal não esperado (${local})`); root = local; }
    else if (!stack.length) bad('mais de um elemento principal no XML');
    if (prof.el && !prof.el.has(local)) bad(`elemento não esperado neste tipo de arquivo (${local})`);
    const keptAttrs = [];
    for (const [an, av] of attrs) {
      if (an === 'xmlns' || an.startsWith('xmlns:')) { keptAttrs.push([an, av]); continue; }
      if (an.includes(':') && !(prof.prefixes && prof.prefixes.has(an.split(':')[0]) && scope.pfx[an.split(':')[0]])) bad(`atributo com prefixo não esperado (${an})`);
      if (prof.at && !prof.at(an, av)) bad(`atributo não esperado (${an} em ${local})`);
      const sg = scanSig(av, false); if (sg) bad(`${sg} escondido em atributo do XML`);
      keptAttrs.push([an, av]);
    }
    if (++count > 100000) bad('XML com elementos demais'); if (stack.length + 1 > 40) bad('XML com aninhamento profundo demais');
    depth = Math.max(depth, stack.length + 1);
    if (prof.rebuild) out.push(`<${name}${keptAttrs.map(([a, v]) => ` ${a}="${esc(v, true)}"`).join('')}${selfClose ? '/>' : '>'}`);
    if (!selfClose) stack.push({ name, scope });
    i = k;
  }
  if (stack.length || !root) bad('XML incompleto');
  return { buf: prof.rebuild ? Buffer.from(out.join(''), 'utf8') : buf, root, elements: count, depth };
}

// ---------- ponto de entrada ----------
// Tipos que cada rota aceita (nome → lista). Tudo que não está na lista da rota é RECUSADO.
const IMG = ['jpeg', 'png', 'gif', 'webp', 'heic'], AUDIO = ['wav', 'mp3', 'ogg', 'webm', 'mp4', 'flac', 'aac', 'amr'];
const PRESETS = {
  fotos: IMG, fotos_audio: [...IMG, ...AUDIO], comprovante: [...IMG, 'pdf'], pdf: ['pdf'], xml: ['xml'], certificado: ['pfx', 'der', 'pem'], extrato: ['pdf', 'text', 'xml'], cad: ['dxf', 'dwg'],
  documentos: [...IMG, ...AUDIO, 'svg', 'xml', 'pdf', 'ooxml', 'odf', 'ole', 'rtf', 'text'], imagem_xml: [...IMG, 'svg', 'xml'],
};
const LABEL = { jpeg: 'foto JPEG', png: 'foto PNG', gif: 'GIF', webp: 'foto WebP', heic: 'foto HEIC', svg: 'SVG', xml: 'XML', pdf: 'PDF', wav: 'áudio WAV', mp3: 'áudio MP3', ogg: 'áudio OGG', webm: 'áudio WebM', mp4: 'áudio/vídeo MP4', flac: 'áudio FLAC', aac: 'áudio AAC', amr: 'áudio AMR',
  ooxml: 'documento do Office (docx/xlsx/pptx)', odf: 'documento OpenDocument', zip: 'arquivo compactado (ZIP)', ole: 'documento do Office antigo (doc/xls/ppt)', rtf: 'RTF', text: 'texto', pfx: 'certificado (PFX)', der: 'certificado (CER)', pem: 'certificado (PEM)', dxf: 'desenho DXF', dwg: 'desenho DWG', other: 'tipo desconhecido' };
const detectAny = (b, allow) => { const k = detect(b); return k === 'other' ? docs.detectDoc(b, allow instanceof Set ? allow : new Set(allow)) : k; };

// check(buf, { profile, allow }) → { ok:true, kind, mime, ext, buf, width, height } | { ok:false, kind, reason }
function check(buf, o = {}) {
  let kind = 'other';
  try {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    if (!buf.length) bad('arquivo vazio');
    const allow = new Set(typeof o.allow === 'string' ? PRESETS[o.allow] : o.allow || ['jpeg', 'png', 'gif', 'webp', 'heic', 'svg', 'xml']);
    kind = detectAny(buf, allow);
    const pre = { zip: ['ooxml', 'odf', 'zip'], der: ['pfx', 'der'] }[kind] || [kind];
    if (!pre.some(k => allow.has(k))) bad(`${LABEL[kind] ? LABEL[kind][0].toUpperCase() + LABEL[kind].slice(1) : 'Este tipo de arquivo'} não é aceito aqui`);
    let r;
    if (kind === 'jpeg') r = checkJpeg(buf, { motion: true }); else if (kind === 'png') r = checkPng(buf); else if (kind === 'gif') r = checkGif(buf);
    else if (kind === 'webp') r = checkWebp(buf); else if (kind === 'heic') r = checkHeic(buf);
    else if (kind === 'svg') r = checkXml(buf, { profile: 'svg' });
    else if (kind === 'xml') r = checkXml(buf, { profile: o.profile || 'xml' });
    else if (docs.CHECKERS[kind]) r = docs.CHECKERS[kind](buf, o);
    else bad('tipo de arquivo não reconhecido');
    if (r.kind) { kind = r.kind; if (!allow.has(kind)) bad(`${LABEL[kind][0].toUpperCase() + LABEL[kind].slice(1)} não é aceito aqui`); }
    const [mime, ext] = KINDS[kind] || docs.MIME[kind] || ['application/octet-stream', '.bin'];
    return { ok: true, kind, mime, ext, buf: r.buf, width: r.width || 0, height: r.height || 0, root: r.root || '' };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, kind, reason: e.message };
    return { ok: false, kind, reason: 'não consegui ler o arquivo com segurança (' + String(e && e.message).slice(0, 80) + ')' };
  }
}

docs.hooks.jpeg = checkJpeg; // PDF usa o mesmo leitor para as fotos que carrega
module.exports = { check, detect, detectAny, checkXml, scanSig, KINDS, IMAGE_KINDS, PRESETS, LABEL, AUDIO, Bad };
