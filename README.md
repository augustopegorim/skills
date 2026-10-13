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
