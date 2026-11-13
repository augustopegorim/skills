#!/usr/bin/env bash
# Instala as duas ferramentas que o checkup usa (precisa de Go instalado) e deixa uma cópia em bin/ ao lado desta skill.
#   gitleaks    — procura segredos no histórico do Git
#   govulncheck — procura falhas conhecidas nas bibliotecas Go
# Uso: bash instalar-ferramentas.sh      (os binários em bin/ não vão para o Git; são do sistema de quem instalou)
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
go install github.com/zricethezav/gitleaks/v8@latest
go install golang.org/x/vuln/cmd/govulncheck@latest
mkdir -p bin && cp "$(go env GOPATH)/bin/gitleaks" "$(go env GOPATH)/bin/govulncheck" bin/
echo "Pronto: $(ls bin | tr '\n' ' ')em $(pwd)/bin"
