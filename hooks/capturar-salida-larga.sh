#!/bin/bash
# PreToolUse hook (matcher: Bash) -- automatizacion REAL, no un recordatorio.
#
# El problema medido: el contexto promedio por turno es ~214k tokens y el cache-read es
# 225 veces el output. Lo que engorda el contexto no es lo que el modelo escribe, es lo
# que le entra. Un `npm run build` que falla vuelca 400 lineas de stack traces que quedan
# en el contexto para SIEMPRE, releidas en cada turno posterior de la sesion.
#
# Ningun hook puede reescribir la SALIDA de una herramienta (PostToolUse llega tarde),
# pero PreToolUse si puede reescribir el COMANDO con updatedInput. Asi que interceptamos
# antes: la salida completa va a un archivo, al contexto entra solo la cola.
#
# Es conservador a proposito: solo toca comandos de build/test/lint de una lista corta,
# y se abstiene si el comando ya tiene pipes, redirecciones o encadenamientos -- ahi el
# usuario o el modelo ya decidieron que quieren ver, y reescribirlo romperia la intencion.

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && { echo '{}'; exit 0; }

# Si ya hay pipe, redireccion, encadenamiento o un limitador, no se toca.
case "$cmd" in
  *'|'*|*'>'*|*'<'*|*'&&'*|*';'*|*'tail '*|*'head '*|*'2>&1'*) echo '{}'; exit 0 ;;
esac

# Lista corta de comandos cuya salida es predeciblemente enorme y cuya cola es lo unico
# que importa el 95% de las veces (el error final, no las 300 lineas de progreso).
case "$cmd" in
  npm\ run\ build*|npm\ run\ typecheck*|npm\ run\ lint*|npm\ test*|npm\ run\ test*|\
  pnpm\ build*|pnpm\ typecheck*|pnpm\ lint*|pnpm\ test*|\
  yarn\ build*|yarn\ lint*|yarn\ test*|\
  npx\ tsc*|npx\ next\ build*|npx\ playwright\ test*|\
  bun\ run\ build*|bun\ test*) ;;
  *) echo '{}'; exit 0 ;;
esac

# Los logs se acumulan durante la sesion. Se borran los de mas de un dia: si el error
# sigue importando pasado un dia, ya esta arreglado o ya se leyo.
find /tmp -maxdepth 1 -name 'cc-salida-*.log' -mtime +1 -delete 2>/dev/null

log="/tmp/cc-salida-$$-$(date +%s).log"

# Se preserva el codigo de salida: sin esto el modelo veria "exito" en un build que fallo,
# que es peor que no tener el hook. `(exit $ec)` fija el codigo sin matar la shell.
nuevo="{ ${cmd} ; } > ${log} 2>&1; ec=\$?; \
lineas=\$(wc -l < ${log} | tr -d ' '); \
if [ \"\$lineas\" -gt 80 ]; then \
  echo \"[hook] salida de \$lineas lineas recortada a las ultimas 60. Completa en: ${log}\"; \
  echo \"[hook] para ver el resto: grep -n 'error' ${log}  |  sed -n '1,40p' ${log}\"; \
  tail -n 60 ${log}; \
else \
  cat ${log}; \
fi; \
(exit \$ec)"

jq -n --arg c "$nuevo" '{hookSpecificOutput:{hookEventName:"PreToolUse",updatedInput:{command:$c}}}'
