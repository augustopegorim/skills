#!/usr/bin/env bash
# Varredura automática do checkup de segurança. Uso: bash varredura.sh [pasta-do-app]   (padrão: pasta atual)
# Cada bloco impresso é SUSPEITA, não falha: abra só a linha apontada e decida.
cd "${1:-.}" || exit 1
# Documentação (*.md) só entra na busca de segredos (gs); o resto olha só código.
X=(--exclude="*.md"); gs(){ X=(); g "$@"; X=(--exclude="*.md"); }
g(){ t="$1"; shift; r=$(grep -rnEI "${X[@]}" --exclude-dir={node_modules,.git,dist,build,vendor,coverage,.next} \
  --exclude={*.min.js,package-lock.json,yarn.lock,go.sum,*.map,SKILL.md,varredura.sh} "$@" . 2>/dev/null | cut -c1-180 | head -20)
  [ -n "$r" ] && printf '\n== %s\n%s\n' "$t" "$r"; }
g "SQL montado com texto (injeção)"  '\.(prepare|query|exec|run|all|get|raw)\(\s*`[^`]*\$\{'
g "SQL concatenado"                  "(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER BY)[^;]*[\"'\`]\s*\+\s*\w"
g "HTML com dados (XSS)"             'innerHTML|outerHTML|insertAdjacentHTML|document\.write|dangerouslySetInnerHTML|v-html'
g "eval / código dinâmico"           '\beval\(|new Function\(|setTimeout\(\s*["'"'"'`]|vm\.run'
g "Comando do sistema"               'child_process|execSync\(|exec\(|shell:\s*true|exec\.Command\('
gs "Segredo no código"                "(api[_-]?key|secret|token|passw(or)?d|senha|private[_-]?key)\s*[:=]\s*[\"'][^\"']{8,}"
gs "Chave/token conhecido"            'BEGIN (RSA |EC |OPENSSH |)PRIVATE|sk-ant-|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20}|xox[bp]-|AIza[0-9A-Za-z_-]{30}'
g "Hash fraco"                       "createHash\(['\"](md5|sha1)|\bmd5\(|\bsha1\("
g "Aleatório fraco p/ token"         'Math\.random\(|math/rand'
g "TLS desligado"                    'rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|InsecureSkipVerify:\s*true|usesCleartextTraffic="true"'
g "CORS"                             "cors\(|Access-Control-Allow-(Origin|Credentials)"
g "Cookies"                          'res\.cookie\(|Set-Cookie|cookie:\s*\{|httpOnly|sameSite'
g "JWT"                              'jwt\.(sign|verify|decode)|algorithms?:'
g "Arquivo com caminho do usuário"   '(readFile|createReadStream|sendFile|download|unlink|writeFile|rm)\w*\([^)]*req\.(params|query|body)'
g "Redirect com dado do usuário"     'res\.redirect\([^)]*req\.|location\.href\s*=\s*[^;]*(params|query|hash)'
g "URL externa vinda do usuário (SSRF)" '(fetch|axios(\.\w+)?|https?\.get|got|request)\([^)]*req\.(body|query|params)'
g "Mass assignment / prototype"      '\.\.\.req\.body|Object\.assign\([^)]*req\.body|__proto__|merge\([^)]*req\.body'
g "Regex com dado do usuário"        'new RegExp\([^)]*(req\.|params|query)'
g "Erro vazando p/ usuário"          'err(or)?\.stack|res\.(send|json)\([^)]*\berr(or)?\b\)|res\.status\(500\)\.(send|json)\([^)]*\.message'
g "Log com dado sensível"            "console\.(log|info|error)\([^)]*(senha|password|token|secret|cpf|cartao|card)"
g "Token no navegador"               'localStorage\.setItem\([^)]*(token|senha|password|jwt|session)'
g "Limite de corpo / upload"         'express\.json\(|urlencoded\(|bodyParser|multer|busboy|formidable|limits?:'
g "Rate limit"                       'rateLimit|rate-limit|limiter|tooManyRequests|429'
g "Headers de segurança"             'helmet|Content-Security-Policy|Strict-Transport-Security|X-Frame-Options|frame-ancestors|x-powered-by'
g "target=_blank"                    'target=["'"'"']_blank'
g "Rotas de debug/teste"             "app\.(get|post|use)\(['\"]/(debug|test|dev|teste|phpinfo|_)"
echo; echo "== Arquivos sensíveis versionados"; git ls-files 2>/dev/null | grep -Ei '(^|/)\.env($|\.)|\.(pem|key|p12|pfx|jks|keystore|sqlite3?|db|bak|dump)$|id_rsa|credentials' | head
echo "== .gitignore cobre .env?"; grep -qE '^\.env' .gitignore 2>/dev/null && echo sim || echo "NÃO"
[ -f package.json ] && { echo "== npm audit"; npm audit --omit=dev --audit-level=high 2>&1 | grep -vi "npm notice" | tail -15; }
[ -f go.mod ] && command -v govulncheck >/dev/null && { echo "== govulncheck"; govulncheck ./... 2>&1 | tail -15; }
command -v gitleaks >/dev/null && { echo "== gitleaks (histórico)"; gitleaks detect --no-banner -v 2>&1 | tail -15; }
exit 0
