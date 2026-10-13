---
name: novo-teste
description: Cria um teste novo (API e/ou tela, inclusive em tamanho de celular) para o Patrimônio seguindo o padrão de zima/testes, com as lições já aprendidas. Use ao terminar qualquer funcionalidade ou tela nova.
---

# Novo teste do Patrimônio

Os testes ficam em `zima/testes/NN-assunto.js` (próximo número livre: `ls zima/testes | tail`). Rodam dentro de um contêiner descartável com cópia do banco real, **nunca na produção**.

**Como rodar:** só o seu — `zima/teste-completo.sh "NN-assunto"` (filtro por parte do nome; pula as etapas de unidade). Bateria inteira — `zima/teste-semanal.sh --sem-enviar` em segundo plano (cerca de 9 min). Comando `docker run/exec` direto não é liberado: use os scripts.

**Modelo:** `modelo-teste.js` (nesta pasta) — copie e adapte. Ele já traz `req/ok/ca/ct/run/wait` de `lib.js`, o `goto` correto e a conferência de rolagem lateral.

Regras que valem a pena lembrar (cada uma já deu trabalho):
- Texto de cada `ok(...)` em português, dizendo **o efeito** ("tocar no bloco abre o Financeiro na aba Despesas"), não o código.
- Mudar só o `#` da URL **não recarrega** a tela: use `pg.goto(...)` seguido de `pg.reload(...)`.
- O servidor de teste é construído **no início** da bateria: edições feitas durante a rodada não entram nela.
- Celular: `setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true })`. Rolagem lateral: compare `document.documentElement.scrollWidth` com **392** (não com `innerWidth`, que se amplia sozinho).
- `innerText` de `<input>` é vazio: leia `.value`. Tela que depende de dado: crie pela API antes (cliente, chamado, produto…).
- Usuários prontos: `ca` (administrador) e `ct` (técnico sem Estoque/Projetos/Financeiro): use o técnico para provar que a permissão barra.
- Fotos de tela: salve em `/tmp/shots` (aparecem depois em `/tmp/pat-shots`) e olhe com Read.
- Se a tela é nova, inclua-a na lista de `zima/testes/88-telas-celular.js` (varredura em 390 px).
- Custo/lucro: sempre teste que **não** aparecem em PDF, RAT, orçamento ou link público.
