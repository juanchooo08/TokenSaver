#!/bin/bash
# PostToolUse hook (matcher: Bash): otorga creditos de delegacion cada vez que cheap-ai
# resuelve trabajo. Cada job con ok:true en el output = 1 credito. El gate en
# cheap-ai-gate.sh consume 1 credito por cada Write/Edit -- fuerza delegacion continua,
# no solo "una vez cada rato". Un --batch de N tareas otorga N creditos de una sola llamada.
# Opt-out: si ya corres Claude Code contra un modelo gratis o baratisimo (un proxy propio,
# un gateway local, un modelo local), la capa 2 no aporta nada y el sistema de creditos
# solo estorba. Se desactiva sin desinstalar nada con cualquiera de las dos vias:
#   export TOKEN_SAVER_NO_CREDITS=1
#   ANTHROPIC_AUTH_TOKEN=omniroute   (el proxy propio del autor, se deja por compatibilidad)
# El gate lee lo mismo, asi que los dos hooks quedan consistentes.
if [ "$TOKEN_SAVER_NO_CREDITS" = "1" ] || [ "$ANTHROPIC_AUTH_TOKEN" = "omniroute" ]; then
  echo '{}'
  exit 0
fi
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

case "$cmd" in
  *cheap-ai/scripts/openrouter-call.ts*)
    output=$(echo "$input" | jq -r '(.tool_response.stdout // .tool_response.output // .tool_response.result // "") | tostring' 2>/dev/null)
    # El script tiene dos formatos de salida: --batch/--variants imprimen un ARRAY JSON de
    # resultados, y la llamada simple imprime el contenido crudo del modelo. Por eso se
    # intenta parsear como JSON primero y solo se cae al conteo de 1 si no lo es.
    # Contar con grep sobre el texto entero seria fragil: si el modelo delegado devuelve
    # codigo que contiene literalmente "ok": true, se otorgarian creditos de mas.
    count=$(printf '%s' "$output" | jq -e 'if type=="array" then [.[] | select(.ok == true)] | length else empty end' 2>/dev/null)
    case "$count" in (''|*[!0-9]*) count=1 ;; esac
    mkdir -p .claude
    current=0
    [ -f .claude/.cheap-ai-heartbeat ] && current=$(cat .claude/.cheap-ai-heartbeat)
    case "$current" in (''|*[!0-9]*) current=0 ;; esac
    echo $((current + count)) > .claude/.cheap-ai-heartbeat
    ;;
esac

echo '{}'
