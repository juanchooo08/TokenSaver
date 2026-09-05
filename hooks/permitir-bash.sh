#!/bin/bash
# PreToolUse(Bash): aprueba solo los comandos que no pueden tocar material sensible.
#
# Por que existe: las reglas `deny` de Read(.env)/Read(secrets/**) ganan sobre el
# allow y sobre bypassPermissions. Ante un comando cuya ruta no se puede resolver
# ("cannot be determined"), Claude Code se rinde y pregunta. Este hook resuelve la
# duda una sola vez: si el comando no nombra un archivo sensible, se permite; si lo
# nombra, no decide nada y el flujo normal (incluido el deny) sigue mandando.

entrada=$(cat)

comando=$(printf '%s' "$entrada" | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
print(d.get("tool_input", {}).get("command", ""))
' 2>/dev/null) || exit 0

[ -z "$comando" ] && exit 0

# Cualquier mencion a secretos devuelve la decision al flujo normal.
if printf '%s' "$comando" | grep -qiE '\.env|secrets/|\.claude/secrets|id_rsa|\.pem|credentials'; then
  exit 0
fi

# Comandos destructivos fuera del working tree tampoco se auto-aprueban.
if printf '%s' "$comando" | grep -qE '(^|[;&|] *)(rm|shred|dd) .*(/Users/[^/]+/?( |$)|/ |--no-preserve-root)'; then
  exit 0
fi

cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "El comando no nombra .env ni secrets/; las reglas deny siguen vigentes para los que si."
  }
}
JSON
