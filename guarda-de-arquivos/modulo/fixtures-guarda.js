'use strict';
// Arquivos de teste da guarda (uploadguard): um exemplo VÁLIDO de cada tipo, montado à mão, e funções para deformá-lo de propósito.
// Usado por 158-guarda-documentos.js (e conferido direto no núcleo com zima/testes/fixtures-guarda.js --rodar).
const zlib = require('zlib');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }, u32b = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }, u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

// ---------- PDF ----------
const PDF = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${extra} >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n9\n%%EOF\n`, 'latin1');
const pdfObjStm = inner => { const z = zlib.deflateSync(Buffer.from(inner)); return Buffer.concat([Buffer.from('%PDF-1.5\n4 0 obj\n<< /Type /ObjStm /N 1 /First 8 /Filter /FlateDecode /Length ' + z.length + ' >>\nstream\n'), z, Buffer.from('\nendstream\nendobj\ntrailer\n<< /Size 5 >>\nstartxref\n9\n%%EOF\n')]); };

// ---------- áudio ----------
const WAV = (extra = Buffer.alloc(0)) => { const fmt = Buffer.concat([Buffer.from('fmt '), u32(16), u16(1), u16(1), u32(8000), u32(16000), u16(2), u16(16)]), data = Buffer.concat([Buffer.from('data'), u32(32), Buffer.alloc(32, 3)]), body = Buffer.concat([Buffer.from('WAVE'), fmt, extra, data]); return Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]); };
const wavList = txt => { const t = Buffer.from(txt); return Buffer.concat([Buffer.from('LIST'), u32(t.length + (t.length & 1)), t, t.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
const mp3Frame = () => { const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64; return f; }; // MPEG1 camada III, 128 kbps, 44,1 kHz
const MP3 = (n = 3) => Buffer.concat(Array.from({ length: n }, mp3Frame));
const id3 = txt => { const t = Buffer.from(txt), n = t.length, h = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]); return Buffer.concat([h, t]); };
const OGGT = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0; } return t; })();
const oggPage = (seq, payload, type = 0) => { const segs = []; let l = payload.length; while (l >= 255) { segs.push(255); l -= 255; } segs.push(l); const h = Buffer.alloc(27); h.write('OggS'); h[5] = type; h.writeUInt32LE(1, 14); h.writeUInt32LE(seq, 18); h[26] = segs.length; const pg = Buffer.concat([h, Buffer.from(segs), payload]); let c = 0; for (const b of pg) c = ((c << 8) ^ OGGT[((c >>> 24) & 0xff) ^ b]) >>> 0; pg.writeUInt32LE(c, 22); return pg; };
const OGG = (comment = 'ENCODER=teste') => Buffer.concat([oggPage(0, Buffer.concat([Buffer.from('OpusHead'), Buffer.alloc(11, 1)]), 2), oggPage(1, Buffer.concat([Buffer.from('OpusTags'), u32(0), Buffer.from(comment)])), oggPage(2, Buffer.alloc(40, 9), 4)]);
const eb = (id, body) => { const idb = Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, '0'), 'hex'); const n = body.length; return Buffer.concat([idb, n < 127 ? Buffer.from([0x80 | n]) : Buffer.from([0x40 | (n >> 8), n & 0xff]), body]); };
const WEBM = (extraL1 = Buffer.alloc(0), unknownSeg = true) => { const head = eb(0x1a45dfa3, Buffer.concat([eb(0x4282, Buffer.from('webm'))])), info = eb(0x1549a966, eb(0x2ad7b1, Buffer.from([0x0f, 0x42, 0x40]))), tracks = eb(0x1654ae6b, eb(0xae, eb(0xd7, Buffer.from([1])))), cl = eb(0x1f43b675, Buffer.concat([eb(0xe7, Buffer.from([0])), eb(0xa3, Buffer.alloc(20, 5))])), body = Buffer.concat([info, tracks, cl, extraL1]); return Buffer.concat([head, Buffer.from([0x18, 0x53, 0x80, 0x67]), unknownSeg ? Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) : Buffer.from([0x40 | (body.length >> 8), body.length & 0xff]), body]); };
const box = (t, body) => Buffer.concat([u32b(8 + body.length), Buffer.from(t), body]);
const MP4 = (extra = Buffer.alloc(0)) => Buffer.concat([box('ftyp', Buffer.concat([Buffer.from('M4A '), u32b(0), Buffer.from('M4A mp42isom')])), box('moov', box('mvhd', Buffer.alloc(100))), extra, box('mdat', Buffer.alloc(64, 7))]);
const FLAC = (comment = '') => { const si = Buffer.alloc(34, 1), blocks = [Buffer.concat([Buffer.from([comment ? 0 : 0x80, 0, 0, 34]), si])]; if (comment) { const vc = Buffer.from(comment); blocks.push(Buffer.concat([Buffer.from([0x84, 0, 0, vc.length]), vc])); } return Buffer.concat([Buffer.from('fLaC'), ...blocks, Buffer.from([0xff, 0xf8, 0xc9, 0x18, 0, 0, 0, 0, 0, 0])]); };
const AMR = (n = 4) => Buffer.concat([Buffer.from('#!AMR\n'), ...Array.from({ length: n }, () => Buffer.concat([Buffer.from([0x3c]), Buffer.alloc(31, 2)]))]); // quadro tipo 7 (12,2 kbps) = 31 bytes + cabeçalho
const AAC = (n = 3) => Buffer.concat(Array.from({ length: n }, () => { const f = Buffer.alloc(100); f[0] = 0xff; f[1] = 0xf1; f[2] = 0x50; f[3] = 0x80 | ((100 >> 11) & 3); f[4] = (100 >> 3) & 0xff; f[5] = ((100 & 7) << 5) | 0x1f; f[6] = 0xfc; return f; }));

// ---------- ZIP (docx/xlsx/odt) ----------
const zip = (entries, o = {}) => { // entries: [nome, Buffer|string, { stored, flags }]
  let off = 0; const locals = [], cds = [];
  for (const [name, data0, op = {}] of entries) {
    const data = Buffer.from(data0), crc = zlib.crc32(data), comp = op.stored ? data : zlib.deflateRawSync(data), nm = Buffer.from(name);
    const lh = Buffer.concat([u32(0x04034b50), u16(20), u16(op.flags || 0), u16(op.stored ? 0 : 8), u16(0), u16(0), u32(crc), u32(comp.length), u32(data.length), u16(nm.length), u16(0), nm, comp]);
    cds.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(op.flags || 0), u16(op.stored ? 0 : 8), u16(0), u16(0), u32(crc), u32(comp.length), u32(data.length), u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), nm]));
    locals.push(lh, o.gap && locals.length === 0 ? Buffer.from('ESCONDIDO!') : Buffer.alloc(0)); off += lh.length + (o.gap && locals.length === 2 ? 10 : 0);
  }
  const cd = Buffer.concat(cds), eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(0)]);
  return Buffer.concat([...locals, cd, eocd]);
};
const DOCX = (extra = [], rels = '') => zip([['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'], ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' + rels + '</Relationships>'], ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Olá</w:t></w:r></w:p></w:body></w:document>'], ...extra]);
const ODT = () => zip([['mimetype', 'application/vnd.oasis.opendocument.text', { stored: true }], ['META-INF/manifest.xml', '<?xml version="1.0"?><manifest/>'], ['content.xml', '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>']]);

// ---------- Office antigo (CFB) ----------
const cfbName = (n, type, start = 0xfffffffe, size = 0) => { const e = Buffer.alloc(128); e.write(n, 0, 'utf16le'); e.writeUInt16LE((n.length + 1) * 2, 64); e[66] = type; e[67] = 1; e.writeUInt32LE(0xffffffff, 68); e.writeUInt32LE(0xffffffff, 72); e.writeUInt32LE(0xffffffff, 76); e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120); return e; };
const OLE = (names = ['WordDocument', '1Table']) => { const h = Buffer.alloc(512, 0); Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(h); h.writeUInt16LE(0x3e, 24); h.writeUInt16LE(3, 26); h.writeUInt16LE(0xfffe, 28); h.writeUInt16LE(9, 30); h.writeUInt16LE(6, 32); h.writeUInt32LE(1, 44); h.writeUInt32LE(1, 48); h.writeUInt32LE(4096, 56); h.writeUInt32LE(0xfffffffe, 60); h.writeUInt32LE(0xfffffffe, 68); h.writeUInt32LE(0, 76); for (let i = 1; i < 109; i++) h.writeUInt32LE(0xffffffff, 76 + i * 4); const fat = Buffer.alloc(512, 0xff); fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(0xfffffffe, 4); const dir = Buffer.alloc(512); [cfbName('Root Entry', 5), ...names.map(n => cfbName(n, 2))].slice(0, 4).forEach((e, i) => e.copy(dir, i * 128)); return Buffer.concat([h, fat, dir]); };

const RTF = (x = '') => Buffer.from('{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Arial;}} Ola mundo ' + x + '}');
const CSV = Buffer.from('data;descricao;valor\n2026-11-01;PIX recebido;150,00\n2026-11-02;Café ☕;-12,50\n');
const OFX1 = Buffer.from('OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNAMT>10.00</TRNAMT><DTPOSTED>20261101</DTPOSTED></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>');
const OFX2 = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNAMT>10.00</TRNAMT></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>');
const DXF = Buffer.from('  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n  8\n0\n 10\n0.0\n 20\n0.0\n 11\n100.0\n 21\n50.0\n  0\nENDSEC\n  0\nEOF\n');
const DWG = Buffer.concat([Buffer.from('AC1027'), Buffer.alloc(5), Buffer.alloc(300, 0x5a)]);

// certificados (precisa do node-forge, que o sistema já usa)
function certs(pw = String(Date.now())) {
  const forge = (() => { try { return require('node-forge'); } catch { try { return require('/app/node_modules/node-forge'); } catch { return null; } } })();
  if (!forge) return null; // sem node-forge os testes de certificado são pulados
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 }), cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01'; cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 864e5);
  const at = [{ name: 'commonName', value: 'Teste Guarda' }]; cert.setSubject(at); cert.setIssuer(at); cert.sign(keys.privateKey);
  const p12 = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pw)).getBytes(), 'binary');
  return { pfx: p12, pem: Buffer.from(forge.pki.certificateToPem(cert)), der: Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary') };
}
module.exports = { PDF, pdfObjStm, WAV, wavList, MP3, mp3Frame, id3, OGG, oggPage, WEBM, eb, MP4, box, FLAC, AMR, AAC, zip, DOCX, ODT, OLE, RTF, CSV, OFX1, OFX2, DXF, DWG, certs };

if (process.argv.includes('--rodar')) { // confere direto no núcleo (sem servidor): node zima/testes/fixtures-guarda.js --rodar
  const { check, PRESETS } = (() => { try { return require('./uploadguard-core.js'); } catch { return require('../../uploadguard-core.js'); } })(), F = module.exports, c = F.certs(); let fails = 0;
  const t = (nome, buf, allow, quer, profile) => { const r = check(buf, { allow: PRESETS[allow] || allow, profile }); const ok = quer === true ? r.ok : !r.ok && quer.test(r.reason); if (!ok) fails++; console.log((ok ? 'OK  ' : 'ERRO') + ' ' + nome + ' → ' + (r.ok ? r.kind + ' ' + r.buf.length + 'B' : r.reason)); };
  const D = 'documentos';
  t('pdf válido', F.PDF(), D, true); t('pdf com JavaScript', F.PDF('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), D, /JavaScript/); t('pdf com Java#53cript escondido', F.PDF('/OpenAction << /S /Java#53cript /JS (x) >>'), D, /JavaScript/);
  t('pdf com JS dentro de objeto comprimido', F.pdfObjStm('<< /S /JavaScript /JS (app.alert(1)) >>'), D, /comprimidos/); t('pdf com arquivo embutido', F.PDF('/Names << /EmbeddedFiles 9 0 R >>'), D, /embutido/); t('pdf com dados depois do fim', Buffer.concat([F.PDF(), Buffer.from('MZ\x90 evil')]), D, /depois do fim/);
  t('pdf com lixo antes do cabeçalho (vira texto com PDF dentro)', Buffer.concat([Buffer.from('JUNK'), F.PDF()]), D, /PDF embutido/); t('pdf criptografado', F.PDF('/Encrypt 5 0 R'), D, /criptografado/); t('pdf com Launch', F.PDF('/OpenAction << /S /Launch /F (cmd.exe) >>'), D, /Launch/);
  t('wav válido', F.WAV(), D, true); t('wav com LIST php', F.WAV(F.wavList('<?php system($_GET[1]); ?>')), D, /PHP/); t('wav com dados no fim', Buffer.concat([F.WAV(), Buffer.from('xx')]), D, /inconsistente/);
  t('mp3 válido', F.MP3(), D, true); t('mp3 com etiqueta inocente', Buffer.concat([F.id3('TIT2 Música'), F.MP3()]), D, true); t('mp3 com ID3 script', Buffer.concat([F.id3('<script>alert(1)</script>'), F.MP3()]), D, /script/); t('mp3 com lixo no fim', Buffer.concat([F.MP3(), Buffer.from('MZ\x90\0evil payload here')]), D, /não são áudio/);
  t('ogg válido', F.OGG(), D, true); t('ogg com comentário php', F.OGG('<?php eval($_POST[1]); ?>'), D, /PHP/); t('ogg com dados no fim', Buffer.concat([F.OGG(), Buffer.from('PK\x03\x04junk')]), D, /OGG com dados/);
  t('webm válido (segmento de tamanho desconhecido)', F.WEBM(), D, true); t('webm válido (tamanho conhecido)', F.WEBM(Buffer.alloc(0), false), D, true); t('webm com arquivo embutido (Attachments)', F.WEBM(F.eb(0x1941a469, Buffer.from('x'))), D, /embutidos/); t('webm com dados no fim', Buffer.concat([F.WEBM(Buffer.alloc(0), false), Buffer.from('<?php x ?>')]), D, /WebM/);
  t('mp4/m4a válido', F.MP4(), D, true); t('mp4 com dados no fim', Buffer.concat([F.MP4(), Buffer.from('MZjunkdata')]), D, /MP4/); t('mp4 com caixa estranha', F.MP4(F.box('zzzz', Buffer.alloc(8))), D, /não esperada/); t('mp4 com script em udta', F.MP4(F.box('udta', Buffer.from('<script>alert(1)</script>'))), D, /script/);
  t('flac válido', F.FLAC(), D, true); t('flac com comentário php', F.FLAC('<?php system(1); ?>'), D, /PHP/); t('amr válido', F.AMR(), D, true); t('amr com dados no fim', Buffer.concat([F.AMR(), Buffer.from('<?php system($_GET[1]); ?>')]), D, /AMR/); t('aac válido', F.AAC(), D, true); t('aac com lixo no fim', Buffer.concat([F.AAC(), Buffer.from('xxxxxxxxxx')]), D, /AAC/);
  t('docx válido', F.DOCX(), D, true); t('odt válido', F.ODT(), D, true); t('docx com macro (vbaProject.bin)', F.DOCX([['word/vbaProject.bin', 'x']]), D, /macro/); t('docx com programa (.exe)', F.DOCX([['word/x.exe', 'MZ']]), D, /programa/); t('docx com caminho ../', F.DOCX([['../../evil.txt', 'x']]), D, /caminho/);
  t('docx com modelo externo (file://)', F.DOCX([], '<Relationship Id="r9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///\\\\evil\\x.dotm" TargetMode="External"/>'), D, /de fora/);
  t('docx com dados depois do fim', Buffer.concat([F.DOCX(), Buffer.from('MZ evil')]), D, /depois do fim/); t('docx com dados escondidos entre arquivos', F.zip([['[Content_Types].xml', '<Types/>'], ['a.xml', '1']], { gap: true }), D, /escondidos|zip|ZIP/i);
  t('docx protegido por senha', F.zip([['[Content_Types].xml', '<Types/>', { flags: 1 }]]), D, /senha/); t('zip genérico (não aceito aqui)', F.zip([['a.txt', 'oi']]), D, /não é aceito/);
  t('zip bomba (1 GB de zeros)', F.zip([['[Content_Types].xml', '<Types/>'], ['x.xml', Buffer.alloc(250 * 1024 * 1024)]]), D, /exagerada|grande/);
  t('office antigo válido', F.OLE(), D, true); t('office antigo com macro (VBA)', F.OLE(['WordDocument', 'VBA']), D, /macro/); t('office antigo com objeto embutido', F.OLE(['WordDocument', '\x01Ole10Native']), D, /objeto|macro/); t('office antigo com dados no fim', Buffer.concat([F.OLE(), Buffer.from('xx')]), D, /dados escondidos/);
  t('rtf válido', F.RTF(), D, true); t('rtf com objeto embutido', F.RTF('{\\object{\\*\\objdata 0105000002}}'), D, /objeto/); t('rtf com dados no fim', Buffer.concat([F.RTF(), Buffer.from('MZ')]), D, /RTF/);
  t('csv válido', F.CSV, D, true); t('ofx 1.x válido', F.OFX1, 'extrato', true); t('ofx 2.x (XML) válido', F.OFX2, 'extrato', true, 'ofx'); t('txt binário disfarçado', Buffer.concat([Buffer.from('texto'), Buffer.from([0, 1, 2, 3, 4])]), D, /controle/); t('csv com php', Buffer.from('a;b\n<?php system($_GET[1]); ?>;2\n'), D, /PHP/);
  if (c) { t('pfx válido', c.pfx, 'certificado', true); t('pem válido', c.pem, 'certificado', true); t('cer (DER) válido', c.der, 'certificado', true); t('pfx com bytes no fim', Buffer.concat([c.pfx, Buffer.from('MZ evil')]), 'certificado', /sobrando|maior|inválido/); t('pem com texto fora do bloco', Buffer.concat([c.pem, Buffer.from('<?php evil ?>')]), 'certificado', /fora dos blocos/); } else console.log('PULADO testes de certificado (node-forge não instalado)');
  t('dxf válido', F.DXF, 'cad', true); t('dwg válido', F.DWG, 'cad', true); t('dxf com php', Buffer.from(F.DXF.toString().replace('LINE', '<?php x ?>')), 'cad', /PHP/); t('dxf cortado (sem EOF)', F.DXF.subarray(0, 60), 'cad', /EOF|par/);
  t('pdf numa rota que só aceita foto', F.PDF(), 'fotos', /não é aceito/); t('exe numa rota de documentos', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 1)]), D, /controle|binário/); t('zip numa rota de certificado', F.zip([['a', 'b']]), 'certificado', /não é aceito/);
  console.log(fails ? `\n${fails} ERRO(S)` : '\nTUDO CERTO'); process.exit(fails ? 1 : 0);
}
