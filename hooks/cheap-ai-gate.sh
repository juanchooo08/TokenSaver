#!/bin/bash
# PreToolUse hook (matcher: Write|Edit): consume 1 credito de delegacion por cada
# escritura/edicion. Sin creditos disponibles, bloquea. Rutas sensibles (auth/RLS/pagos/
# seguridad) siempre se permiten sin consumir credito -- ahi cheap-ai solo puede asistir,
# nunca decidir el archivo final (Regla de Oro del skill).
# Mismo opt-out que el heartbeat (ver ahi el porque).
[ "$TOKEN_SAVER_NO_CREDITS" = "1" ] && { echo '{}'; exit 0; }

# Sin cheap-ai instalado en este proyecto no hay forma de ganar creditos: bloquear seria
# dejar al agente sin salida. El gate se abstiene y no decide nada.
[ -f .claude/skills/cheap-ai/scripts/openrouter-call.ts ] || { echo '{}'; exit 0; }

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if echo "$file_path" | grep -qiE '(auth|rls|polic|payment|checkout|billing|stripe|polar|security|middleware|webhook|\.env)'; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Ruta sensible (auth/RLS/pagos/seguridad): cheap-ai nunca escribe estos archivos, bypass automatico del gate, no consume credito."}}'
  exit 0
fi

credits=0
[ -f .claude/.cheap-ai-heartbeat ] && credits=$(cat .claude/.cheap-ai-heartbeat)
case "$credits" in (''|*[!0-9]*) credits=0 ;; esac

if [ "$credits" -le 0 ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Sin creditos de delegacion disponibles. Antes de escribir/editar este archivo, invoca cheap-ai: npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts --category <cat> --prompt \"...\". Cada job resuelto con ok:true otorga 1 credito = 1 Write/Edit permitido. Usa --batch para varias tareas delegables juntas y acumular varios creditos de una sola llamada (mas eficiente). Si de verdad no hay NADA delegable en este cambio puntual, usa categoria auto con un prompt breve (resumir el objetivo del cambio) solo para generar credito, y continua."}}'
  exit 0
fi

mkdir -p .claude
echo $((credits - 1)) > .claude/.cheap-ai-heartbeat
echo '{}'
