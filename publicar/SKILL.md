---
name: publicar
description: Coloca no ar o que está pronto no Patrimônio — fluxo completo do CLAUDE.md (conferir, testar, commit em português, push, deploy no Zima, verificar, diário). Só o Augusto chama.
disable-model-invocation: true
---

# /publicar — do código pronto até o sistema no ar

> Feita para o projeto **Patrimônio** (Pegorim Serviços): os caminhos (`zima/deploy.sh`, `docs/ESTADO-DO-SISTEMA.md`, `zima/teste-*.sh`) são desse repositório. Em outro projeto, adapte os passos 3, 4 e 7.

Siga **nesta ordem** e pare no primeiro problema (explique ao Augusto em português, em termos do que o sistema faz).
Argumento opcional: uma frase do que mudou (ajuda no texto do commit).

1. **Estado do repositório:** `git status -sb` e `git pull --ff-only`. Se o pull falhar por conflito, avise antes de mexer.
2. **Conferir:** `node --check` em todo `.js` alterado (inclusive `public/`); se mexeu em `monitor-agent/`: `cd monitor-agent && go test ./internal/...`.
   Todo módulo `.js` novo na raiz precisa estar no `COPY` do `Dockerfile` (o gancho avisa, mas confirme).
3. **Testar:** se a mudança é grande ou mexe em várias telas, rode a bateria completa em segundo plano (`zima/teste-semanal.sh --sem-enviar`, cerca de 9 min) e espere o "RESUMO". Para mudança pequena, rode só os testes do assunto: `zima/teste-completo.sh "<parte do nome>"`.
   Se algo falhar, **não publique**: corrija ou explique.
4. **Diário:** acrescente a entrada do dia em `docs/ESTADO-DO-SISTEMA.md` (o que foi pedido, o que foi feito, pendências) *antes* do commit, para ir junto.
5. **Commit** em português, descrevendo o efeito para o usuário, terminando com as duas linhas:
   as linhas de autoria que o Claude Code indicar na sessão (`Co-Authored-By` e `Claude-Session`; o `CLAUDE.md` do projeto tem a forma exata). Nunca inclua `docker-compose.zima.yml`, `.env`, `docker-compose.override.yml`, binários ou chaves.
6. **Enviar:** `git push` (nunca `--force`).
7. **Publicar:** `zima/deploy.sh --sem-pull`. Se falhar, o sistema pode estar fora do ar: veja `docker logs --tail 80 patrimonio` e corrija na hora.
8. **Conferir no ar:** `curl -fsS http://localhost:3000/` responde e `docker logs --tail 50 patrimonio` sem erro.
9. **Relatório ao Augusto:** em português simples, o que mudou, **onde ver** (qual tela/botão) e o que ele precisa fazer (ex.: "feche e abra o app", "atualização do app"). Sem termos de código.

Lembretes: versão dos agentes só o `deploy.sh` decide; custo/lucro nunca em documentos, RAT, orçamento ou link público.
