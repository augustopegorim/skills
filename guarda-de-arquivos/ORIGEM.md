# Origem

Criada em **08/11/2026** no projeto Patrimônio (Pegorim Serviços), a pedido do Augusto, a partir do módulo `uploadguard*.js`
(fonte da verdade: raiz do repositório `augustopegorim/Patrimonio`; testes `zima/testes/157-guarda-uploads.js`, `158-guarda-documentos.js`
e `fixtures-guarda.js`). Código próprio, **sem dependências de terceiros** (só Node ≥ 22.13). Não precisa de `/skill-security-auditor`
(o auditor acusa "falso positivo" em leitores de arquivo: `RegExp.exec`, nomes de assinatura de malware nas listas de busca).

Alterou no Patrimônio? Copie de volta para `modulo/` e confira com `node modulo/fixtures-guarda.js --rodar`.
