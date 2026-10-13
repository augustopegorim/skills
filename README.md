# Skills do Claude Code — Pegorim Serviços

Skills usadas em todos os projetos. Toda skill de terceiros entra **só depois de revisada**
(`/skill-security-auditor` + leitura), com a origem e as alterações anotadas no `ORIGEM.md` dela.

| Skill | Comando | Para quê |
|---|---|---|
| `checkup-seguranca` | `/checkup-seguranca` | Checkup de segurança completo ao terminar um app (lista + `varredura.sh`) |
| `adversarial-reviewer` | `/adversarial-reviewer` | Revisão "hostil" do código antes de publicar |
| `skill-security-auditor` | `/skill-security-auditor <pasta ou link>` | Auditar skill/plugin de terceiros antes de instalar (precisa de Python 3) |

## Instalar

**No PC (vale para todos os projetos)** — no terminal:
```
git clone https://github.com/augustopegorim/skills.git %USERPROFILE%\.claude\skills
```
(Linux/Zima: `git clone https://github.com/augustopegorim/skills.git ~/.claude/skills`.)
Se a pasta `skills` já existir, clone em outro lugar e copie as pastas para dentro dela.

**Atualizar:** `git -C ~/.claude/skills pull` (no Windows: `git -C %USERPROFILE%\.claude\skills pull`).

**Só num projeto:** copie a pasta da skill para `.claude/skills/` do repositório do projeto.

## Regras para adicionar uma skill

1. Rodar `/skill-security-auditor` nela e ler o `SKILL.md` inteiro (ele vira instrução para o Claude).
2. Recusar se tiver gancho automático (hooks), servidor MCP ou envio de dados para fora sem necessidade.
3. Anotar no `ORIGEM.md`: de onde veio, versão/commit, licença e o que foi alterado.
4. Nunca instalar pacote de skills inteiro: copiar só a pasta da skill escolhida.
