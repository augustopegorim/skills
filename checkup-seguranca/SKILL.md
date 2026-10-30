---
name: checkup-seguranca
description: Checkup de segurança completo de um app (web, API, Android, agente) — HTTPS, headers, CORS, senhas, sessões, cookies, CSRF, controle de acesso, RLS/isolamento, injeções, XSS, validação, uploads, erros, segredos, dependências, DDoS, backup, monitoramento, LGPD. Use ao terminar um app/módulo novo ou mudança grande, ou quando pedirem "checkup/auditoria de segurança".
---

# Checkup de segurança — rodar ao final de cada app

Lista única para conferir **qualquer app** (web, API, app Android, agente) antes de dizer que está pronto.
Foi escrita para o Claude seguir sozinho, gastando poucos tokens. Serve para qualquer stack; os exemplos de comando são de Node/Express, Go e Android.

---

## 0. Como o Claude deve rodar este checkup

1. **Escopo**: defina a pasta do app e a URL pública (se houver). Se for só uma mudança, cheque apenas as
   seções que a mudança toca; app novo ou mudança grande → checkup completo.
2. **Primeiro a varredura automática (seção 1)** — se `gitleaks`/`govulncheck` não estiverem instalados, o resultado diz isso: instale (`go install github.com/zricethezav/gitleaks/v8@latest`, `go install golang.org/x/vuln/cmd/govulncheck@latest`) em vez de pular. Agentes Go de Windows: `GOOS=windows govulncheck ./...`, num único comando. Ela aponta os arquivos suspeitos;
   leia **só** as linhas apontadas (com offset/limit), nunca o projeto inteiro.
3. **Depois os testes externos (seção 2)**, se o app estiver no ar, **e o passeio por todas as rotas e telas (2b e 2c)**.
4. Percorra as seções 3 a 24 (incluindo 23b). Para cada item marque: **OK** / **FALHA** / **N/A** (não se aplica a este app),
   sempre com evidência curta (`arquivo:linha` ou saída do comando). Não marque OK "de cabeça".
5. **Gravidade**: Crítico (vaza dados/acesso sem login) · Alto (explorável com algum esforço) · Médio
   (defesa em profundidade faltando) · Baixo (boa prática).
6. **Crítico e Alto: corrigir antes de publicar.** Rodar o checkup e não corrigir/registrar nada é falha da rodada. Falso positivo conhecido (ex.: senha de teste em script) vai para um arquivo de exceções (`.gitleaksignore`) com o motivo, para o próximo checkup não repetir. Médio/Baixo: corrigir se for simples; senão, vira pendência.
7. Entregue o relatório no formato da seção 25 e registre as pendências no diário/lista de pendências do projeto (ex.: `docs/ESTADO-DO-SISTEMA.md`).
8. **Levar para outro projeto**: copie a pasta `checkup-seguranca` (SKILL.md + varredura.sh) para `.claude/skills/` do
   outro repositório, ou para `~/.claude/skills/` no PC para valer em todos os projetos. Chame com `/checkup-seguranca`.

---

## 1. Varredura automática (um comando só)

```bash
bash <pasta-desta-skill>/varredura.sh <raiz-do-app>
```
`<pasta-desta-skill>` é `.claude/skills/checkup-seguranca` no projeto ou `~/.claude/skills/checkup-seguranca`.
Cada bloco impresso é **suspeita**, não falha: abra só a linha apontada e decida.

---

## 2. Testes externos (app no ar; troque `URL`)

```bash
URL=https://exemplo.com; H=${URL#https://}
curl -sSI "http://$H" | head -3                                   # deve redirecionar (301/308) para https
curl -sSI "$URL" | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin|server:|x-powered-by'
curl -sSI -H 'Origin: https://atacante.example' "$URL/api/" | grep -i 'access-control'   # NÃO pode ecoar atacante.example
curl -sS "$URL/rota-que-nao-existe-123" | head -c 300             # sem stack trace, sem caminho de arquivo
curl -sS -X POST -H 'Content-Type: application/json' -d '{"x":' "$URL/api/login" | head -c 300   # JSON quebrado → erro genérico
curl -sS "$URL/.env" -o /dev/null -w '%{http_code}\n'; curl -sS "$URL/.git/config" -o /dev/null -w '%{http_code}\n'  # 404/403
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{"usuario":"x","senha":"y"}' "$URL/api/login"; done; echo   # deve aparecer 429
echo | openssl s_client -connect "$H:443" -servername "$H" 2>/dev/null | openssl x509 -noout -dates   # validade do certificado
```
Sem acesso à internet: rode contra `http://localhost:PORTA` e cheque os headers do mesmo jeito.
Opcional (navegador): securityheaders.com e ssllabs.com/ssltest.

## 2b. Passeio por TODAS as rotas (obrigatório em checkup completo)
O checkup não vale se não passar por cada rota e cada tela. Rode contra uma **cópia de teste** (banco descartável), nunca contra produção:
```bash
node <pasta-desta-skill>/rotas.js http://localhost:PORTA <raiz-do-app> --publicas=/a,/b --baixo="sid=..." --logado="sid=..."
```
- Sem login, toda rota precisa dar 401/403. Cada exceção vira **pergunta ao dono**: "esta rota é pública de propósito?" (entrada, link de assinatura, agentes com token próprio…). Rota pública não revisada = FALHA.
- `--baixo` (usuário de poucas permissões): conferir cada rota de administração/financeiro/usuários que ele alcança.
- `--logado`: erro 5xx com corpo vazio = rota quebrada ou vazando erro.
- Se o projeto tiver teste próprio de rotas/telas (no Patrimônio: `zima/teste-completo.sh 999`), use-o e confira também que ele está atualizado.

## 2c. Passeio por TODAS as telas (navegador de teste, tamanho de celular)
Abrir cada tela (menu, abas, fichas de cliente/equipamento/chamado/orçamento/venda, telas de admin) logado e conferir: **(a)** sem erro de JavaScript; **(b)** sem violação de CSP no console; **(c)** texto malicioso (`"><img src=x onerror=...>`, `<svg onload=...>`, `<script>`) digitado em nome/observação/endereço/assunto **não** vira HTML nem script em nenhuma tela; **(d)** tela sem login mostra só a entrada; **(e)** sem rolagem horizontal. Usar o Playwright do `.mcp.json` ou o Chromium dos testes.
Pelo menos 1 vez por checkup: repetir os testes da seção 2 **contra o site real** (pela internet, passando pelo Cloudflare) e, se houver proteção por VPN/IP, com ela ligada e desligada.

---

## 3. HTTPS e transporte
- [ ] **T1** Todo acesso público é HTTPS; HTTP redireciona (301/308).
- [ ] **T2** HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (só depois de confirmar que tudo funciona em HTTPS).
- [ ] **T3** TLS 1.2+ apenas; certificado válido e com renovação automática (alerta antes de vencer).
- [ ] **T4** Sem conteúdo misto (página https carregando http://).
- [ ] **T5** Chamadas de saída (APIs, webhooks, agentes) verificam o certificado — nada de `rejectUnauthorized:false` / `InsecureSkipVerify`.
- [ ] **T6** Atrás de proxy/túnel: `app.set('trust proxy', ...)` configurado com o número certo de saltos, para IP real e `secure` dos cookies funcionarem — e o IP do cliente não ser falsificável por `X-Forwarded-For`.

## 4. Headers de segurança
- [ ] **H1** `Content-Security-Policy` sem `unsafe-eval`; `unsafe-inline` só se inevitável; `frame-ancestors 'self'` (ou `'none'`); `object-src 'none'`; `base-uri 'self'`.
- [ ] **H2** `X-Content-Type-Options: nosniff`.
- [ ] **H3** `X-Frame-Options: DENY|SAMEORIGIN` (ou `frame-ancestors`) — evita clickjacking.
- [ ] **H4** `Referrer-Policy: strict-origin-when-cross-origin` (ou `no-referrer` onde há tokens na URL).
- [ ] **H5** `Permissions-Policy` desligando o que não usa (`camera=(), microphone=(), geolocation=()`; libere só o que o app usa).
- [ ] **H6** Sem `X-Powered-By` / versão do servidor (`app.disable('x-powered-by')`).
- [ ] **H7** Respostas com dados de usuário logado: `Cache-Control: no-store`.
- [ ] **H8** `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Resource-Policy: same-origin` quando não quebrar nada.

## 5. CORS
- [ ] **C1** Se o front e a API são o mesmo domínio: **CORS desligado** (não precisa).
- [ ] **C2** Se precisar: lista fixa de origens; nunca refletir o `Origin` recebido; nunca `*` junto com credenciais.
- [ ] **C3** Métodos e headers liberados são só os usados; `null` não é origem aceita.
- [ ] **C4** CORS não substitui login: rotas continuam exigindo sessão/permissão.

## 6. Senhas e autenticação
- [ ] **A1** Senha guardada com **argon2id**, **bcrypt** (custo ≥ 12) ou **scrypt**, com sal. Nunca MD5/SHA puro, nunca texto ou criptografia reversível.
- [ ] **A2** Comparação de hash/token com função de tempo constante (`bcrypt.compare`, `crypto.timingSafeEqual`).
- [ ] **A3** Política: mínimo 10–12 caracteres, sem regra de "símbolo obrigatório"; bloquear senhas comuns/vazadas; limite máximo ≥ 64 (bcrypt só usa 72 bytes — avise ou pré-hash).
- [ ] **A4** Login responde a mesma mensagem para "usuário não existe" e "senha errada"; o mesmo vale para "esqueci a senha" (sem enumerar e-mails).
- [ ] **A5** Força bruta: limite por IP **e** por usuário, com atraso/bloqueio temporário e registro (ver 19).
- [ ] **A6** Recuperação de senha: token aleatório (≥ 128 bits), guardado como hash, uso único, expira em ≤ 1 h.
- [ ] **A7** Trocar/recuperar senha derruba as outras sessões do usuário.
- [ ] **A8** 2FA (TOTP) obrigatório para administradores e acesso remoto. Segredo TOTP guardado no servidor, códigos de recuperação com hash.
- [ ] **A9** Sem usuário/senha padrão no primeiro uso (ou troca obrigatória no primeiro login).
- [ ] **A10** Ações críticas (trocar e-mail/senha, desligar 2FA, apagar conta, exportar dados) pedem a senha ou 2FA de novo.

## 7. Sessões
- [ ] **S1** ID de sessão aleatório criptográfico (≥ 128 bits, `crypto.randomBytes`), guardado no servidor como hash.
- [ ] **S2** ID novo a cada login e a cada mudança de privilégio (evita fixação de sessão).
- [ ] **S3** Expira por inatividade (ex.: 30 min–12 h conforme o risco) **e** por tempo absoluto.
- [ ] **S4** Logout apaga a sessão no servidor, não só o cookie.
- [ ] **S5** Usuário vê e encerra as sessões ativas; admin consegue derrubar sessões de outro usuário.
- [ ] **S6** JWT (se usar): algoritmo fixo na verificação (sem `none`), `exp` curto, segredo forte (≥ 256 bits) e forma de revogar. Preferir sessão no servidor.
- [ ] **S7** Usuário desativado/permissão removida perde o acesso na hora (a checagem é feita a cada requisição, não só no login).

## 8. Cookies
- [ ] **K1** Cookie de sessão: `HttpOnly`, `Secure`, `SameSite=Lax` (ou `Strict`), `Path=/`, de preferência nome com prefixo `__Host-`.
- [ ] **K2** Sem `Domain=` amplo (não compartilhar com subdomínios sem necessidade).
- [ ] **K3** Nada sensível no valor do cookie além do ID; nada de dados do usuário em cookie legível pelo JS.
- [ ] **K4** Token de sessão nunca em `localStorage`/`sessionStorage` nem na URL.

## 9. CSRF
- [ ] **F1** Toda ação que altera dados usa POST/PUT/PATCH/DELETE — **GET nunca altera nada**.
- [ ] **F2** Cookies `SameSite=Lax/Strict` **e** mais uma barreira: token CSRF, ou checagem de `Origin`/`Referer` nas rotas que alteram dados, ou exigir header próprio (`X-Requested-With`) com `Content-Type: application/json`.
- [ ] **F3** Rotas públicas que recebem formulário (ex.: assinatura por link) validam o token do link a cada envio.
- [ ] **F4** Logout também protegido contra CSRF.

## 10. Controle de acesso
- [ ] **P1** Negado por padrão: toda rota `/api` exige login, exceto uma lista explícita de públicas (revise a lista).
- [ ] **P2** Permissão checada **no servidor** em cada rota (esconder botão na tela não protege).
- [ ] **P3** IDOR: ao buscar/alterar/apagar por ID, confirmar que o registro pertence ao usuário/cliente/empresa dele. Teste: logado como A, pedir o ID de B → 403/404.
- [ ] **P4** Rotas de admin exigem papel admin no servidor; usuário comum não chega nelas trocando a URL.
- [ ] **P5** Mass assignment: o servidor só aceita os campos permitidos (sem `...req.body` direto no banco — o usuário não pode mandar `admin:true`, `empresa_id`, `valor_pago`).
- [ ] **P6** Arquivos enviados (fotos, PDFs) só são servidos para quem tem acesso ao registro dono; URLs de arquivo não são adivinháveis.
- [ ] **P7** Rotas antigas, de teste e de debug removidas ou protegidas.
- [ ] **P8** Exportações, relatórios, buscas e listagens respeitam o mesmo filtro de permissão das telas (vazamento clássico).
- [ ] **P9** Mudanças de permissão e ações de admin ficam registradas (quem, quando, o quê).

## 11. Isolamento de dados (RLS / multi-empresa)
- [ ] **R1** Postgres/Supabase: RLS **ativado e forçado** (`ENABLE` + `FORCE ROW LEVEL SECURITY`) em toda tabela com dado de cliente; política para cada operação (SELECT/INSERT/UPDATE/DELETE); teste com dois usuários.
- [ ] **R2** Supabase/Firebase: a chave `service_role`/admin **nunca** vai para o front-end ou app; regras do Firestore/Storage não estão abertas (`allow read, write: if true`).
- [ ] **R3** Sem RLS (SQLite/MySQL): toda consulta filtra pelo dono (`empresa_id`/`cliente_id`/`usuario_id`) vindo **da sessão**, nunca do corpo da requisição.
- [ ] **R4** Multi-empresa: banco/processo separado por empresa, sem rota que atravesse empresas.
- [ ] **R5** Recursos só do dono do sistema (chaves de API, integrações, webhooks) não vazam para as empresas.
- [ ] **R6** Usuário do banco da aplicação sem privilégio de dono/superusuário.

## 12. Injeção (SQL e outras)
- [ ] **I1** SQL sempre parametrizado (`?` / `$1`); nunca `${}` ou `+` com dado do usuário.
- [ ] **I2** Nome de coluna/tabela/`ORDER BY` dinâmico só a partir de lista permitida.
- [ ] **I3** `LIKE` com dado do usuário: escapar `%` e `_`.
- [ ] **I4** Comandos do sistema: `execFile`/`spawn` com lista de argumentos, sem `shell:true`, nunca montar string com dado do usuário.
- [ ] **I5** Caminhos de arquivo: nome gerado pelo servidor; se vier do usuário, `path.basename` + conferir que o caminho final fica dentro da pasta (`path.resolve` + `startsWith`).
- [ ] **I6** SSRF: URLs informadas pelo usuário (webhooks, "buscar imagem", integrações) só para domínios permitidos; bloquear `localhost`, `127.*`, `10.*`, `172.16–31.*`, `192.168.*`, `169.254.*` (metadados de nuvem) e redirecionamentos.
- [ ] **I7** Sem `eval`/`new Function`/template de servidor com texto do usuário; `yaml.load` seguro.
- [ ] **I8** Prototype pollution: não fazer merge profundo de `req.body` em objetos; bloquear `__proto__`, `constructor`.
- [ ] **I9** Regex com dado do usuário escapada; regex próprias sem retrocesso catastrófico (ReDoS).
- [ ] **I10** Cabeçalhos/e-mail: sem quebra de linha (`\r\n`) vinda do usuário em headers, assunto, destinatário.
- [ ] **I11** Open redirect: redirecionar só para caminhos internos (`/...`) ou lista fixa.
- [ ] **I12** Geração de PDF/HTML no servidor (Chromium): conteúdo do usuário escapado, sem acesso a `file://` nem à rede interna.
- [ ] **I13** CSV/planilha exportada: campos que começam com `= + - @` prefixados com `'` (injeção de fórmula).

## 13. XSS e injeção de CSS (front-end)
- [ ] **X1** Texto do usuário vai para a tela com `textContent` ou função de escape; `innerHTML` só com conteúdo fixo ou escapado. Confira cada ocorrência da varredura.
- [ ] **X2** Links com URL do usuário aceitam só `https:`/`http:`/`mailto:` (bloquear `javascript:` e `data:`).
- [ ] **X3** Markdown/HTML rico do usuário passa por sanitizador (DOMPurify) com lista permitida.
- [ ] **X4** Dados injetados em `<script>` como JSON escapam `<` (`<`).
- [ ] **X5** CSS: nada de `style`/`<style>` montado com texto do usuário (vaza dados e faz phishing visual); cores/tamanhos vindos do usuário validados por formato.
- [ ] **X6** SVG e HTML enviados pelo usuário nunca são exibidos inline no mesmo domínio (ver 15).
- [ ] **X7** `target="_blank"` com `rel="noopener noreferrer"`.
- [ ] **X8** Bibliotecas de CDN com versão fixa e `integrity` (SRI) — ou servidas localmente.

## 14. Validação de entrada
- [ ] **V1** Toda entrada validada **no servidor** (o front-end é só conforto): tipo, tamanho mínimo/máximo, formato, faixa de valores.
- [ ] **V2** Lista do que é permitido (enum), não do que é proibido.
- [ ] **V3** Limite de tamanho do corpo (`express.json({limit:'1mb'})` ou menor) e de cada campo de texto.
- [ ] **V4** Números: inteiros/decimais conferidos, sem negativos onde não cabe (valor, quantidade), dinheiro em centavos inteiros.
- [ ] **V5** Datas, e-mail, CPF/CNPJ, telefone validados por formato; texto normalizado (trim).
- [ ] **V6** Paginação com máximo (`limit ≤ 100`); buscas sem curingas que varrem tudo.
- [ ] **V7** Campos desconhecidos ignorados ou rejeitados.

## 15. Uploads
- [ ] **U1** Tamanho máximo por arquivo e por requisição; quantidade máxima de arquivos; cota por usuário/empresa.
- [ ] **U2** Tipo conferido pelo conteúdo (bytes mágicos), não só pela extensão/`Content-Type`; extensões permitidas em lista.
- [ ] **U3** Nome salvo gerado pelo servidor (aleatório); nome original só como metadado escapado.
- [ ] **U4** Guardado fora da pasta pública; entregue por rota que checa permissão (ver P6).
- [ ] **U5** Entrega com `Content-Type` correto, `nosniff` e `Content-Disposition: attachment` para tipos não-imagem; SVG/HTML nunca inline.
- [ ] **U6** Imagens reprocessadas/reduzidas (remove scripts embutidos e EXIF com localização).
- [ ] **U7** Arquivos compactados: limite de tamanho descompactado e de quantidade (zip bomb) e bloqueio de `../` (zip slip).
- [ ] **U8** Upload apagado do disco quando o registro é apagado (e incluído no backup).

## 16. Tratamento de erros e logs
- [ ] **E1** Usuário vê mensagem genérica; detalhes (stack, SQL, caminho) só no log do servidor. `NODE_ENV=production`.
- [ ] **E2** Handler global de erro no Express; `unhandledRejection`/`uncaughtException` registrados — o processo não cai por um erro de requisição.
- [ ] **E3** Logs **sem** senhas, tokens, cookies, códigos 2FA, documentos completos ou dados de cartão.
- [ ] **E4** Eventos de segurança registrados: login ok/falho, bloqueio, troca de senha/2FA, mudança de permissão, exportação, acesso remoto.
- [ ] **E5** Logs com horário (Brasília), usuário e IP; rotação/retenção definida; protegidos contra edição pelo app.
- [ ] **E6** Respostas de erro com o mesmo formato e tempo para "não existe" e "sem permissão" quando isso revelaria dados.

## 17. Segredos
- [ ] **K-1** Nenhum segredo no código ou no Git (inclusive no **histórico**: rode `gitleaks`); vazou → **troque o segredo**, apagar o commit não basta.
- [ ] **K-2** Segredos em variável de ambiente / `.env` do servidor; `.env` no `.gitignore`; arquivo de exemplo só com nomes.
- [ ] **K-3** Nada de segredo no front-end, no APK ou no binário distribuído (tudo ali é público).
- [ ] **K-4** Sem "valor padrão" de segredo no código (`process.env.SECRET || 'troque'`): faltou → o app não sobe.
- [ ] **K-5** Cada chave com o mínimo de permissão e, se possível, restrita por domínio/IP; chaves diferentes por ambiente.
- [ ] **K-6** Arquivos de chave com permissão restrita (`chmod 600`) e fora de volumes públicos.
- [ ] **K-7** Lista de onde cada segredo é usado e como trocá-lo (rotação) sem derrubar o sistema.

## 18. Dependências e cadeia de fornecimento
- [ ] **D1** `npm audit --omit=dev` sem High/Critical (ou justificativa escrita); Go: `govulncheck` limpo.
- [ ] **D2** Lockfile (`package-lock.json`, `go.sum`) versionado; build com `npm ci`.
- [ ] **D3** Pacote novo: conferir nome (typosquatting), downloads, manutenção recente; evitar pacote para coisa trivial.
- [ ] **D4** Imagem Docker base com versão fixa e atualizada (`node:22-slim`, não `latest`); reconstruir periodicamente.
- [ ] **D5** Atualização automática de alertas (Dependabot/Renovate) ligada no GitHub.
- [ ] **D6** Dependências de desenvolvimento fora da imagem de produção.

## 19. DDoS, abuso e limites
- [ ] **L1** Proxy na frente (Cloudflare) com proteção DDoS e WAF; **IP de origem não exposto** (túnel, sem porta aberta no roteador, DNS sem IP real em registros antigos).
- [ ] **L2** Rate limit no app: login, 2FA, recuperação de senha, cadastro, links públicos, envio de e-mail/WhatsApp e rotas caras (PDF, IA, busca, exportação). Resposta 429.
- [ ] **L3** Limite por IP considerando o IP real (ver T6) e, nas rotas logadas, também por usuário.
- [ ] **L4** Timeouts: requisição, corpo lento (`server.requestTimeout`, `headersTimeout`), chamadas externas com timeout.
- [ ] **L5** Tarefas pesadas (PDF/Chromium, IA, compressão) com fila e máximo simultâneo.
- [ ] **L6** Formulários públicos com proteção anti-robô (Turnstile/captcha) se forem alvo.
- [ ] **L7** Custos: APIs pagas (Claude, SMS, WhatsApp) com limite de gasto e alerta.

## 20. Backup e recuperação
- [ ] **B1** Backup automático diário de **bancos + arquivos enviados + configuração necessária** para reconstruir.
- [ ] **B2** Regra 3-2-1: 3 cópias, 2 mídias, 1 fora do local (nuvem/outro prédio); pelo menos uma cópia **imutável/offline** (ransomware).
- [ ] **B3** Backup criptografado; chave guardada em lugar separado do backup.
- [ ] **B4** Teste de restauração automático e periódico, com resultado avisado.
- [ ] **B5** Retenção definida (diários/semanais/mensais) e compatível com a LGPD.
- [ ] **B6** Falha de backup gera alerta (não depende de alguém olhar).

## 21. Monitoramento e alerta
- [ ] **M1** Monitor de disponibilidade externo (o site caiu → aviso no celular).
- [ ] **M2** Alerta de erros 5xx em excesso, disco cheio, memória, certificado vencendo, backup falho.
- [ ] **M3** Alerta de segurança: muitas falhas de login, login de país/IP novo de admin, 2FA desligado, permissão de admin concedida.
- [ ] **M4** Healthcheck no container (`HEALTHCHECK`/restart automático).
- [ ] **M5** Alguém recebe os alertas e sabe o que fazer (passo a passo curto de resposta a incidente).

## 22. Servidor, container e rede
- [ ] **N1** Container roda como usuário não-root; sistema de arquivos só-leitura onde der; `no-new-privileges`.
- [ ] **N2** Só a porta do app publicada; banco, Redis, painéis internos sem porta exposta.
- [ ] **N3** Socket do Docker não montado em container exposto à internet.
- [ ] **N4** Painéis administrativos (ZimaOS, Portainer, roteador) só pela VPN/rede local.
- [ ] **N5** SO e firmware atualizados; SSH só por chave, sem root, de preferência só pela VPN.
- [ ] **N6** Ambiente de teste separado da produção, sem dados reais de clientes.

## 23. Privacidade (LGPD)
- [ ] **G1** Coleta só o necessário; base legal anotada para cada dado pessoal.
- [ ] **G2** Dados sensíveis (documentos, saúde, biometria, senhas de clientes, credenciais de rede) criptografados no banco.
- [ ] **G3** Titular consegue pedir acesso, correção, exportação e exclusão; exclusão apaga também arquivos e (no prazo) backups.
- [ ] **G4** Aviso de privacidade e termos; registro de consentimento quando a base for consentimento.
- [ ] **G5** Acesso a dados pessoais registrado; plano para comunicar vazamento (ANPD/titulares).
- [ ] **G6** Fornecedores que recebem dados (nuvem, IA, e-mail) listados e com contrato adequado.

## 23b. Dados fiscais, certificados e recursos de rede local
- [ ] **Z1** Certificado digital (A1/PFX) e a senha dele: guardados **criptografados**, nunca em log, resposta de API, e-mail ou backup sem criptografia; só o dono do módulo fiscal baixa/troca; troca registrada na auditoria.
- [ ] **Z2** Notas/XML fiscais: valores e impostos calculados no servidor; cancelamento exige permissão + motivo e fica registrado; teste só contra servidor falso/homologação.
- [ ] **Z3** Recurso que **precisa** falar com IP da rede local (impressora, câmera, DVR, agente): aceitar só faixa privada (10.*, 172.16–31.*, 192.168.*), porta fixa da lista, sem `localhost`/`169.254.*`/IP público, sem seguir redirecionamento, com timeout. (É o contrário do bloqueio de I6, que vale para URLs livres.)
- [ ] **Z4** Dado restrito (custo, lucro, margem, senhas de rede) **nunca** em documento entregue ao cliente (PDF, RAT, orçamento, comprovante, link público). Conferir cada PDF/rota pública com busca por esses campos.
- [ ] **Z5** Seletor de contexto enviado pelo navegador (cabeçalho/parâmetro de empresa, filial, cliente): o servidor confere se o **usuário tem direito** a ele; trocar o valor à mão não pode abrir dados de outro.
- [ ] **Z6** Envio de WhatsApp/e-mail/SMS e links públicos: limite por destinatário e por hora (evita virar spam/gasto), sem texto livre do atacante no corpo.

## 24. Itens específicos por tipo de app
**Links públicos / webhooks / integrações**
- [ ] **W1** Link público (assinatura, compartilhamento) com token aleatório ≥ 128 bits, expiração, uso limitado e revogável; mostra só o mínimo.
- [ ] **W2** Webhooks recebidos validam assinatura HMAC + horário (anti-replay); enviados assinam o corpo.
- [ ] **W3** Lógica de negócio: valores e status calculados no servidor; operações financeiras idempotentes e sem corrida (transação); etapas de aprovação não podem ser puladas chamando a rota direto.

**App Android / WebView**
- [ ] **W4** `debuggable=false`, `allowBackup=false` (ou regras de backup), `usesCleartextTraffic=false`/network security config só HTTPS.
- [ ] **W5** WebView: só carrega o domínio próprio; `addJavascriptInterface` expõe o mínimo e só para o domínio próprio; `setAllowFileAccess(false)`; links externos abrem fora.
- [ ] **W6** Componentes `exported` revisados (Activities/Receivers/Providers); deep links validam parâmetros.
- [ ] **W7** Credenciais no Keystore/EncryptedSharedPreferences; nada sensível em log (`Log.d`).
- [ ] **W8** APK assinado com a chave oficial; atualização própria verifica assinatura/hash antes de instalar.

**Agentes / binários instalados em clientes**
- [ ] **W9** Atualizações e comandos remotos assinados; o agente recusa o que não for assinado pela chave oficial.
- [ ] **W10** Cada agente com token próprio e revogável; comunicação só por TLS verificado.
- [ ] **W11** Ações remotas (comandos, acesso remoto) registradas e exigindo 2FA/permissão específica.
- [ ] **W12** Binário roda com o menor privilégio possível; pasta de instalação sem permissão de escrita para usuários comuns.

**E-mail**
- [ ] **W13** Domínio com SPF, DKIM e DMARC (`p=quarantine` ou `reject`); SMTP com TLS; senha do SMTP fora do código.

---

## 25. Formato do relatório (entregar no chat e resumir no diário do projeto)

```
Checkup de segurança — <app> — <data>
Escopo: <completo | seções X,Y>   Varredura: <ok/erros>   Testes externos: <feito | N/A motivo>   Rotas: <n testadas>   Telas: <n testadas>

FALHAS (corrigir):
- [Crítico] P3 IDOR em GET /api/x/:id — routes.js:120 — corrigido em <commit> | pendente
- [Alto] ...
MÉDIO/BAIXO pendentes:
- [Médio] H8 COOP ausente — vai para pendências
N/A: R1, R2 (sem Postgres/Supabase), W4–W8 (sem app Android)
Resto: OK (<n> itens)
```
Regra: se sobrar qualquer **Crítico ou Alto** sem correção, o app **não está pronto**.
