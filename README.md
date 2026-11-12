# Skills do Claude Code — Pegorim Serviços

Skills usadas em todos os projetos. Toda skill de terceiros entra **só depois de revisada**
(`/skill-security-auditor` + leitura), com a origem e as alterações anotadas no `ORIGEM.md` dela.

| Skill | Comando | Para quê |
|---|---|---|
| `checkup-seguranca` | `/checkup-seguranca` | Checkup de segurança completo ao terminar um app (lista + `varredura.sh`) |
| `adversarial-reviewer` | `/adversarial-reviewer` | Revisão "hostil" do código antes de publicar |
| `skill-security-auditor` | `/skill-security-auditor <pasta ou link>` | Auditar skill/plugin de terceiros antes de instalar (precisa de Python 3) |
| `claude-automation-recommender` | `/claude-automation-recommender` | Analisa um projeto e sugere automações do Claude Code (hooks, skills, subagentes, MCP); só lê, não altera nada. Rodar uma vez por projeto |
| `publicar` | `/publicar` | **Projeto Patrimônio:** do código pronto ao sistema no ar (conferir, testar, diário, commit, push, deploy, verificar, relatório). Só o Augusto chama |
| `novo-teste` | `/novo-teste` | **Projeto Patrimônio:** cria teste de API/tela (inclusive em tela de celular) no padrão de `zima/testes`, com modelo pronto e as lições aprendidas |
| `guarda-de-arquivos` | `/guarda-de-arquivos` | **Qualquer sistema Node/Express que recebe arquivo:** guarda que lê foto, PDF, áudio, Office, XML, texto, certificado e CAD num processo isolado e descarta o que tiver algo além do esperado (módulo pronto em `modulo/`, com testes) |
| `cloudflare` | automática (`/cloudflare`) | Escolher produto Cloudflare e **diagnosticar erro de site pela Cloudflare (52x, 1xxx, 403)**; referências de Tunnel, WAF, cron, R2, D1… (terceiros: cloudflare/skills, Apache-2.0, auditada) |
| `cloudflare-one` | automática | Zero Trust / Access / túnel: projetar, configurar e diagnosticar (ligada à proteção "só com VPN" do patrimoniocode.com) (terceiros: cloudflare/skills, auditada) |
| `wrangler`, `workers-development`, `workers-best-practices`, `workers-profiling`, `cloudflare-app-bootstrap`, `frameworks-on-cloudflare`, `nextjs-on-cloudflare`, `durable-objects`, `agents-sdk`, `sandbox-stable`, `sandbox-next`, `sandbox-migrate-to-next`, `basin`, `k2`, `gateway-workers`, `cloudflare-email-service`, `cloudflare-one-migrations`, `cf-cli`, `turnstile-spin`, `web-perf` | automáticas | **Para projetos futuros na Cloudflare** (Workers, Durable Objects, agentes, sandbox, Next.js, e-mail, anti-robô Turnstile, desempenho de site, migração de VPN). Não usadas no Patrimônio hoje. Terceiros: cloudflare/skills, Apache-2.0, auditadas (`ORIGEM.txt` em cada pasta) |

## Instalar

**No PC (vale para todos os projetos)** — no **PowerShell**:
```
git clone https://github.com/augustopegorim/skills.git "$env:USERPROFILE\.claude\skills"
```
(No Prompt de Comando/cmd o caminho é `%USERPROFILE%\.claude\skills`; no Linux/Zima, `~/.claude/skills`.)
Se a pasta `skills` já existir, clone em outro lugar e copie as pastas para dentro dela.

**Python (só para o `skill-security-auditor`):** no Windows, `winget install -e --id Python.Python.3.12`;
depois confira com `py -3 --version` (o comando `python3` do Windows abre a Microsoft Store — não use).

**Atualizar (PowerShell):** `git -C "$env:USERPROFILE\.claude\skills" pull` (Linux/Zima: `git -C ~/.claude/skills pull`).

**Só num projeto:** copie a pasta da skill para `.claude/skills/` do repositório do projeto.

## Regras para adicionar uma skill

1. Rodar `/skill-security-auditor` nela e ler o `SKILL.md` inteiro (ele vira instrução para o Claude).
2. Recusar se tiver gancho automático (hooks), servidor MCP ou envio de dados para fora sem necessidade.
3. Anotar no `ORIGEM.md`: de onde veio, versão/commit, licença e o que foi alterado.
4. Nunca instalar pacote de skills inteiro: copiar só a pasta da skill escolhida.
