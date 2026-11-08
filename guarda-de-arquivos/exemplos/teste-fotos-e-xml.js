'use strict';
// Guarda de fotos e XML (uploadguard): arquivo com qualquer coisa além do esperado é DESCARTADO e nada é gravado; o que passa sai reconstruído
// (foto sem EXIF/GPS/comentários, só com a rotação). Testa o isolamento (sandbox), as rotas reais de foto, XML de NF-e, assinatura e logo.
const zlib = require('zlib');
const puppeteer = require('/app/node_modules/puppeteer-core');
const { req, ok, ca, ct, run, wait, D, B } = require('./lib');
const b64 = s => Buffer.from(s, 'base64');
const PNG = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const GIF = b64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
const JPG = Buffer.concat([b64('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), Buffer.from([0xff, 0xd9])]);
const WEBP = b64('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');
const seg = (m, body) => { const l = Buffer.alloc(2); l.writeUInt16BE(body.length + 2); return Buffer.concat([Buffer.from([0xff, m]), l, body]); };
const jpgWith = (...segs) => Buffer.concat([JPG.subarray(0, 2), ...segs, JPG.subarray(2)]);
const pngChunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data]))); return Buffer.concat([l, Buffer.from(type), data, c]); };
const pngWith = (chunk, tail = Buffer.alloc(0)) => Buffer.concat([PNG.subarray(0, PNG.length - 12), chunk, PNG.subarray(PNG.length - 12), tail]);
// EXIF de celular: orientação 6 (girada) + texto de GPS/aparelho
const exif = (o, extra = '') => { const t = Buffer.concat([Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]), Buffer.from(extra)]); return seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), t])); };

const upload = async (c, path, files, extra = {}) => {
  const fd = new FormData(); for (const [name, buf, type] of files) fd.append('files', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const r = await fetch(B + path, { method: 'POST', headers: { cookie: c }, body: fd }); let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const files = id => D.prepare("SELECT filename FROM attachments WHERE item_id = ? AND kind = 'location' ORDER BY id").all(id).map(x => x.filename);
const getFile = async f => Buffer.from(await (await fetch(B + '/files/' + f, { headers: { cookie: ca } })).arrayBuffer());

run(async () => {
  // ================= isolamento (sandbox) =================
  let st = (await req(ca, 'GET', '/api/uploadguard')).j;
  for (let i = 0; i < 15 && !(st.status && st.status.selftest); i++) { await wait(1000); st = (await req(ca, 'GET', '/api/uploadguard')).j; }
  const sf = (await req(ca, 'POST', '/api/uploadguard/selftest', {})).j;
  ok(sf && sf.ok === true, 'o processo isolado NÃO consegue gravar arquivo, ler fora da pasta, abrir comando nem criar thread, e não recebe senhas do ambiente: ' + JSON.stringify(sf));
  ok((await req(ct, 'GET', '/api/uploadguard')).s === 403, 'só administrador vê o painel da guarda');

  // ================= fotos pelas rotas reais =================
  const c = (await req(ca, 'POST', '/api/clients', { name: 'Cliente Guarda ' + Date.now() % 1e6 })).j;
  const it = (await req(ca, 'POST', '/api/items', { client_id: c.id, name: 'Item guarda' })).j;
  const P = `/api/items/${it.id}/location-photos`;
  let r = await upload(ca, P, [['a.png', PNG, 'image/png'], ['b.jpg', JPG, 'image/jpeg'], ['c.gif', GIF, 'image/gif'], ['d.webp', WEBP, 'image/webp']]);
  ok(r.s === 200 && files(it.id).length === 4, 'fotos PNG, JPEG, GIF e WebP válidas passam e ficam guardadas (' + r.s + ')');
  let n = files(it.id).length;
  const bad = async (nome, buf, type, quer) => {
    const x = await upload(ca, P, [['bom.png', PNG, 'image/png'], [nome, buf, type]]);
    ok(x.s === 422 && x.j && x.j.rejected && files(it.id).length === n && (!quer || quer.test(x.j.error)), `RECUSADA e nada gravado: ${nome} — ${x.j && x.j.error ? x.j.error.slice(0, 110) : x.s}`);
  };
  await bad('php-no-fim.jpg', Buffer.concat([JPG, Buffer.from('<?php system($_GET["c"]); ?>')]), 'image/jpeg', /depois do fim/);
  await bad('zip-no-fim.jpg', Buffer.concat([JPG, Buffer.from('PK\x03\x04conteudo')]), 'image/jpeg', /depois do fim/);
  await bad('comentario-php.jpg', jpgWith(seg(0xfe, Buffer.from('<?php eval($_POST[1]); ?>'))), 'image/jpeg', /PHP/);
  await bad('exif-script.jpg', jpgWith(exif(1, '<script>fetch("//x")</script>')), 'image/jpeg', /script/);
  await bad('marcador-estranho.jpg', jpgWith(seg(0xc3, Buffer.alloc(9))), 'image/jpeg', /desconhecido|não suportado|inválido|cortado/);
  await bad('png-texto.png', pngWith(pngChunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script>'))), 'image/png', /script/);
  await bad('png-dados-no-fim.png', pngWith(Buffer.alloc(0), Buffer.from('MZ\x90\0 This program cannot be run in DOS mode')), 'image/png', /depois do fim/);
  await bad('png-bloco-desconhecido.png', pngWith(pngChunk('zzZz', Buffer.from('abc'))), 'image/png', /desconhecido/);
  await bad('png-crc-quebrado.png', Buffer.concat([PNG.subarray(0, 40), Buffer.from([PNG[40] ^ 1]), PNG.subarray(41)]), 'image/png', /CRC|corrompido|inválid/);
  await bad('gif-no-fim.gif', Buffer.concat([GIF, Buffer.from('<script>x</script>')]), 'image/gif', /depois do fim/);
  await bad('svg-disfarcado.jpg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/jpeg', /não bate|SVG|svg/i);
  await bad('html-disfarcado.jpg', Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg', /conteúdo/);
  await bad('png-que-diz-ser-jpeg.jpg', PNG, 'image/jpeg', /não bate/);
  await bad('exe-disfarcado.png', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 7)]), 'image/png', /conteúdo/);
  // bomba de descompressão: 1×1 declarado, mas o bloco de imagem expande para ~30 MB; e imagem gigante declarada
  const ihdr = (w, h) => { const d = Buffer.alloc(13); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); d[8] = 8; d[9] = 2; return pngChunk('IHDR', d); };
  const mk = (ih, idat) => Buffer.concat([PNG.subarray(0, 8), ih, pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
  await bad('bomba.png', mk(ihdr(1, 1), zlib.deflateSync(Buffer.alloc(30 * 1024 * 1024))), 'image/png', /maiores|declarado/);
  await bad('gigante.png', mk(ihdr(60000, 60000), zlib.deflateSync(Buffer.alloc(10))), 'image/png', /grande demais/);

  // foto de celular: EXIF com GPS/aparelho sai SEM os metadados, mas mantém a rotação (senão a foto aparece deitada)
  const cel = jpgWith(exif(6, 'GPS 24°58\'S 46°18\'W Samsung SM-S918B'), seg(0xfe, Buffer.from('editado no celular')));
  r = await upload(ca, P, [['celular.jpg', cel, 'image/jpeg']]); n++;
  const fn = files(it.id).slice(-1)[0], saved = r.s === 200 ? await getFile(fn) : Buffer.alloc(0);
  ok(r.s === 200 && saved.length > 0 && !saved.includes('Samsung') && !saved.includes('GPS') && !saved.includes('celular'), 'foto de celular passa e sai SEM GPS, aparelho e comentário (' + r.s + ')');
  ok(saved.includes(Buffer.from([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6])), 'a rotação da foto (EXIF orientação 6) é mantida');
  ok(saved[0] === 0xff && saved[1] === 0xd8 && saved.subarray(-2).equals(Buffer.from([0xff, 0xd9])), 'o arquivo guardado é um JPEG completo, sem nada depois do fim');
  const rej = (await req(ca, 'GET', '/api/uploadguard')).j;
  ok(rej.recent.length >= 14 && rej.recent.every(x => x.reason && x.sha256.length === 64) && rej.recent.some(x => /PHP/.test(x.reason)) && rej.status.rejected >= 14, 'cada recusa fica registrada (quem, arquivo, motivo e impressão digital): ' + rej.recent.length);

  // vários ao mesmo tempo (fila do isolamento) e tipo que não é foto continua passando
  const par = await Promise.all(Array.from({ length: 8 }, (_, i) => upload(ca, P, [[`p${i}.png`, PNG, 'image/png']])));
  ok(par.every(x => x.s === 200), '8 fotos enviadas ao mesmo tempo passam pela fila do isolamento'); n += 8;
  const pdf = await upload(ca, `/api/tickets`, []); // rota qualquer: só garante que não derrubou nada
  ok((await fetch(B + '/', { headers: { cookie: ca } })).status === 200, 'o sistema continua respondendo');

  // ================= XML de nota de entrada (estoque → importar NF-e) =================
  const NF = (inner, head = '<?xml version="1.0" encoding="UTF-8"?>') => `${head}<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe35260112345678000190550010000000011000000011" versao="4.00"><ide><nNF>1</nNF></ide><emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor Teste</xNome></emit>${inner}<total><ICMSTot><vProd>10.00</vProd></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const det = '<det nItem="1"><prod><cProd>X1</cProd><xProd>Cabo de rede</xProd><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det>';
  const imp = xml => req(ca, 'POST', '/api/stock/import/xml', { xml });
  r = await imp(NF(det));
  ok(r.s === 200 && r.j && r.j.lines && r.j.lines.length === 1, 'XML de NF-e válido é aceito e lido (' + r.s + ')');
  const xbad = async (nome, xml, quer) => { const x = await imp(xml); ok(x.s === 400 && /recusado por segurança/.test(x.j.error) && (!quer || quer.test(x.j.error)), `XML RECUSADO: ${nome} — ${(x.j.error || '').slice(0, 120)}`); };
  await xbad('DOCTYPE com entidade externa (XXE)', NF(det, '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>').replace('<xNome>Fornecedor Teste', '<xNome>&xxe;'), /DOCTYPE/);
  await xbad('bilhões de risadas (entidades aninhadas)', NF(det, '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>').replace('Fornecedor Teste', '&b;'), /DOCTYPE/);
  await xbad('elemento que a nota fiscal não tem', NF(det + '<comando>rm -rf</comando>'), /não esperado/);
  await xbad('CDATA', NF(det.replace('Cabo de rede', '<![CDATA[Cabo]]>')), /CDATA/);
  await xbad('comentário', NF(det + '<!-- oculto -->'), /comentário/);
  await xbad('instrução de processamento', NF(det + '<?php echo 1 ?>'), /instrução/);
  await xbad('código PHP no texto', NF(det.replace('Cabo de rede', '&lt;?php system($_GET[1]) ?&gt;')), /PHP/);
  await xbad('entidade inventada', NF(det.replace('Cabo de rede', '&lol;')), /entidade/);
  await xbad('script em atributo', NF(det.replace('nItem="1"', 'nItem="1" onload="x()"')), /atributo/);
  await xbad('namespace estranho', NF(det).replace('http://www.portalfiscal.inf.br/nfe', 'http://evil.example/x'), /namespace/);
  await xbad('dois elementos principais', NF(det) + '<extra/>', /principal|não esperado/);
  await xbad('aninhamento profundo', NF(det.replace('<prod>', '<prod>' + '<det>'.repeat(60)).replace('</prod>', '</det>'.repeat(60) + '</prod>')), /profundo|mal formado/);
  await xbad('não é XML', 'isto não é xml', /não é um XML/);

  // ================= assinatura desenhada (RAT) =================
  const tk = (await req(ca, 'POST', '/api/tickets', { client_id: c.id, subject: 'Guarda ' + Date.now() % 1e6 })).j.ticket;
  const du = (buf, m = 'image/png') => `data:${m};base64,${buf.toString('base64')}`;
  const acc = sig => req(ca, 'POST', `/api/tickets/${tk.id}/accept`, { name: 'Cliente', signature: sig });
  r = await acc(du(Buffer.concat([PNG, Buffer.from('<?php evil() ?>')])));
  ok(r.s === 400 && /recusada por segurança/.test(r.j.error), 'assinatura com código escondido depois do PNG é RECUSADA: ' + (r.j.error || r.s));
  r = await acc(du(JPG, 'image/png'));
  ok(r.s === 400 && /recusada/.test(r.j.error), 'assinatura que diz ser PNG mas é outro tipo é RECUSADA');
  const antes = D.prepare('SELECT signature FROM tickets WHERE id = ?').get(tk.id).signature;
  ok(!antes, 'nada foi gravado no chamado pelas recusas');
  r = await acc(du(PNG));
  ok(r.s === 200 && D.prepare('SELECT signature FROM tickets WHERE id = ?').get(tk.id).signature.startsWith('data:image/png;base64,'), 'assinatura PNG limpa é aceita e guardada');

  // ================= logo da empresa (PNG/JPG/SVG) =================
  const logo = d => req(ca, 'PUT', '/api/companies/1/logo', { data: d });
  const svgOk = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#08f"/></svg>';
  r = await logo(du(Buffer.from(svgOk), 'image/svg+xml'));
  ok(r.s === 200, 'logo SVG só com formas é aceita (' + r.s + ')');
  for (const [nome, svg, quer] of [['script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', /script/],
    ['evento onload', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', /atributo|script|evento/], ['link externo', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="http://evil/x.svg#a"/></svg>', /atributo/],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>', /elemento|script/], ['imagem externa', '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil/a.png"/></svg>', /elemento/],
    ['entidade', '<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns="http://www.w3.org/2000/svg">&e;</svg>', /DOCTYPE|entidade/]]) {
    const x = await logo(du(Buffer.from(svg), 'image/svg+xml')); ok(x.s === 400 && quer.test(x.j.error), `logo SVG RECUSADA: ${nome} — ${(x.j.error || '').slice(0, 100)}`);
  }
  r = await logo(du(Buffer.concat([PNG, Buffer.from('<script>x</script>')]), 'image/png'));
  ok(r.s === 400 && /recusada por segurança/.test(r.j.error), 'logo PNG com dados escondidos é RECUSADA');
  await req(ca, 'PUT', '/api/companies/1/logo', { data: '' });

  // ================= tela de Segurança (administrador) =================
  const br = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=pt-BR'] });
  const pg = await br.newPage(); const errs = []; pg.on('pageerror', x => errs.push(x.message));
  await pg.setCookie({ name: 'sid', value: ca.slice(4), url: B }); await pg.setViewport({ width: 1100, height: 900 });
  await pg.goto(B + '/', { waitUntil: 'networkidle0' }); await pg.goto(B + '/#/security', { waitUntil: 'networkidle0' }); await wait(1500);
  const tx = await pg.evaluate(() => (document.getElementById('ugcard') || {}).innerText || '');
  ok(/Guarda de fotos e XML/.test(tx) && /isolamento funcionando/.test(tx) && /recusado/.test(tx) && /PHP|depois do fim|script/.test(tx), 'a tela de Segurança mostra a guarda: isolamento funcionando e as recusas');
  await pg.setViewport({ width: 390, height: 780, isMobile: true }); await pg.goto(B + '/#/security', { waitUntil: 'networkidle0' }); await wait(1200);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'o cartão cabe na tela do celular');
  ok(errs.length === 0, 'sem erros de JavaScript na tela' + (errs.length ? ': ' + errs[0] : ''));
  await br.close();
});
