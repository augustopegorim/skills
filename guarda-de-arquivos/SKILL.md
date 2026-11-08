---
name: guarda-de-arquivos
description: Guarda de arquivos enviados (fotos, PDF, áudio, Office, XML, texto, certificado, CAD) para sistemas Node/Express. Todo arquivo é LIDO byte a byte num processo isolado (sandbox, nada é executado) e DESCARTADO se tiver qualquer coisa além do esperado (dados escondidos, macro, script, DOCTYPE/XXE, bomba de descompressão, tipo disfarçado). Use ao criar ou revisar qualquer sistema que receba arquivo de usuário (upload, anexo, importação, assinatura desenhada, logo).
---

# Guarda de arquivos (uploadguard)

Módulo pronto, sem dependências de npm, feito no Patrimônio (08/11/2026) e pensado para ser **copiado para outros sistemas**.
O código está em `modulo/` desta pasta. A fonte da verdade continua sendo o Patrimônio (`uploadguard*.js` na raiz): se mudar lá, atualize aqui.

## O que ele garante
1. **Nada é executado.** O arquivo é lido por um leitor estrito, num processo filho isolado (`node --permission`: não grava, não lê fora dos próprios arquivos, não abre comando nem thread; **sem variáveis de ambiente**, ou seja, sem senhas). Um processo por arquivo, 20 s de limite, 512 MB, fila de 3 por vez.
2. **Tipo vem do conteúdo**, nunca do nome nem do tipo informado. Tipo informado que não bate com o conteúdo = recusa.
3. **Padrão é recusar.** Cada rota diz os tipos que aceita (`allow`); o resto é descartado.
4. **Qualquer coisa além do esperado = descarta** (nada é gravado, erro 422 com o motivo, recusa registrada com impressão digital SHA-256).
5. **O que passa é reconstruído** quando possível: foto sai sem EXIF/GPS/comentários (mantém só a rotação), WAV/MP3/FLAC sem etiquetas. PDF, Office, XML e demais ficam como vieram (assinatura digital não pode mudar).

## Tipos cobertos (`allow`)
`jpeg png gif webp heic svg xml` · `pdf` · áudio `wav mp3 ogg webm mp4(m4a/3gp) flac aac amr` · `ooxml`(docx/xlsx/pptx) `odf` `ole`(doc/xls/ppt) `rtf` `text`(txt/csv/ofx) · `pfx der pem`(certificado) · `dxf dwg`(CAD) · `zip`(genérico, desligado por padrão).
Atalhos (`PRESETS` em `uploadguard-core.js`): `fotos`, `fotos_audio`, `comprovante`(fotos+PDF), `pdf`, `xml`, `certificado`, `extrato`, `cad`, `documentos`(tudo, menos ZIP/certificado/CAD), `imagem_xml`.

## O que cada leitor recusa (resumo)
- **Imagens:** dados depois do fim, bloco desconhecido, CRC quebrado, bomba de descompressão, imagem gigante, código/EXE/ZIP/PDF escondido em comentário/EXIF/texto.
- **PDF:** JavaScript (inclusive `/Java#53cript` e dentro de objetos comprimidos), Launch, arquivo embutido, XFA, SubmitForm, GoToR, criptografado, dados antes do cabeçalho ou depois do `%%EOF`.
- **Office moderno/ODF:** macro (`vbaProject`), objeto embutido, programa/script, caminho `../`, modelo/objeto externo (inclusive UNC/`file:`), ZIP com dados escondidos/bomba/senha. **Office antigo:** macro VBA, objeto OLE, tamanho fora do padrão. **RTF:** `\objdata` e afins.
- **XML:** DOCTYPE/entidades (XXE, "bilhões de risadas"), CDATA, comentários, instruções, namespace/elemento/atributo fora do esperado, profundidade/tamanho. **SVG:** só formas (sem script, evento, link externo, `foreignObject`, `image`).
- **Áudio:** dados no fim, etiqueta com código, WebM com `Attachments`, CRC do OGG, quadros inválidos. **Certificado:** estrutura ASN.1 completa e sem sobra. **CAD:** DXF com linhas fora do par código/valor, sem EOF, ou código escondido.

## Como instalar num sistema novo (Node ≥ 22.13, Express)
1. Copie `modulo/uploadguard*.js` para a raiz do sistema. (`uploadguard-nfe-tags.js` só serve para NF-e brasileira; em outro sistema pode ficar vazio: `module.exports = { elements: [], attributes: [] };`.)
2. **Docker:** coloque os 6 arquivos no `COPY`. Sem isso o build quebra.
3. Inicie uma vez, cedo (antes dos módulos que recebem arquivo):
   ```js
   const UG = require('./uploadguard')({ db, UPLOADS, filecrypt, audit });   // db/filecrypt/audit são opcionais
   const upload = UG.wrapMulter(multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } }), { allow: 'comprovante' });
   ```
   Nos outros arquivos: `require('./uploadguard').get()`.
4. **Cada rota que recebe arquivo** usa um destes:
   - multer: `UG.wrapMulter(multer(...), { allow: 'fotos' | 'documentos' | [...] | (req, file) => 'pdf', profile: 'nfe' })` (a rota continua igual, com `upload.array/single/fields`);
   - imagem em texto (assinatura/logo, `data:image/png;base64,...`): `const g = await UG.cleanDataUrl(sig, { kinds: ['png'], req }); if (!g.ok) return erro(g.reason); sig = g.dataUrl;`
   - XML em texto: `const g = await UG.checkXmlText(xml, 'nfe', req); if (!g.ok) ...`
   - corpo cru (`express.raw`): `const g = await UG.inspect(buf, { allow: 'cad' }); if (!g.ok) ...`
5. Rotas que usavam `wrap((req,res)=>...)` precisam virar `async`.
6. Teste de fumaça sem servidor: `node modulo/fixtures-guarda.js --rodar` (deve terminar em `TUDO CERTO`; sem `node-forge` instalado, os testes de certificado são pulados). Depois copie e adapte `exemplos/teste-*.js` para as rotas reais do sistema (precisam de Chromium para gerar foto/voz de verdade).
7. Painel (opcional): rota admin que devolve `UG.stats` e `UG.recent()`, com botão de `UG.selftest()` (prova que o isolamento está valendo: gravar/ler fora/processo/thread devem dar `ERR_ACCESS_DENIED`).

## Lições aprendidas (leia antes de ligar em produção)
- **Fotos de celular têm EXIF com orientação.** Por isso a foto regravada mantém um EXIF mínimo só com a rotação; sem isso as fotos aparecem deitadas.
- **Foto em movimento (Samsung/Google) tem vídeo colado depois do fim do JPEG** e será recusada por "dados depois do fim". É proposital; o usuário deve desligar o recurso ou enviar captura.
- **Nota/XML de teste simplificado sem `xmlns`** é aceito (nota real sempre tem); elementos continuam conferidos.
- **NF-e com elemento novo** (reforma tributária) é recusada até rodar `gerar-lista-xml-nfe.js` com os XSD novos.
- **Teste com arquivo falso quebra**: um "PDF" de teste precisa ter `%%EOF`, um `.docx` precisa ser ZIP de verdade. Use `fixtures-guarda.js`.
- O isolamento do Node **não bloqueia rede** (o verificador não tem código de rede, mas o contêiner continua em rede). Em ambiente crítico, rode o worker num contêiner sem rede.
- `--allow-fs-read` precisa listar **todos** os arquivos que o worker carrega; arquivo novo na guarda = incluir em `runWorker`.

## Limites conhecidos (não prometa mais do que isso)
FLAC/MP3/AAC não têm como provar "nada depois do fim" em todos os casos; AMR aceita enchimento que pareça quadro "sem dados"; macros XLM (Excel 4) em `.xls` não são detectadas; DWG só tem conferência de cabeçalho e tamanho; imagens dentro de PDF e vídeo não são decodificadas (bug em decodificador do navegador continua possível); texto exige que não haja código (um arquivo de suporte com trecho de PHP/script será recusado).

## Como adicionar um tipo novo
1. `detectDoc` em `uploadguard-docs.js`: reconhecer pelo conteúdo (assinatura de bytes).
2. Escrever `checkXxx(buf)` que **lança `bad('motivo')`** a cada coisa fora do esperado e devolve `{ buf }` (reconstruído se der) — nada de executar, só ler; conferir tamanhos até o fim exato do arquivo.
3. Registrar em `CHECKERS`, `MIME` e `LABEL`; incluir no(s) `PRESETS`.
4. Acrescentar um arquivo válido **e vários maliciosos** em `fixtures-guarda.js --rodar`.
