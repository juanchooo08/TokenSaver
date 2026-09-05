#!/bin/bash
# UserPromptSubmit hook -- avisa de compactar MIRANDO EL CONTEXTO REAL, no contando turnos.
#
# La version anterior avisaba cada 5 turnos a ciegas: molestaba en una sesion corta de 40k
# y se quedaba callada en una de 400k. Como el aviso llegaba siempre igual, dejaba de
# significar algo.
#
# Esta lee el tamano real del contexto del ultimo turno desde el .jsonl de la sesion
# (campo message.usage) y solo habla cuando cruza un umbral. Medido sobre 30 dias: el
# contexto promedio por turno es 214k y el 57,6% de los turnos pasa de 150k; ahi es donde
# compactar rinde de verdad.

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$sid" ] && { echo '{}'; exit 0; }

jf=$(find "$HOME/.claude/projects" -name "${sid}.jsonl" -maxdepth 2 2>/dev/null | head -1)
[ -z "$jf" ] && { echo '{}'; exit 0; }

# Ultimo turno con uso reportado. El contexto es input + lo leido de cache + lo escrito.
ctx=$(tail -n 400 "$jf" 2>/dev/null | jq -s '
  [ .[] | select(.message.usage != null) | .message.usage
    | (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)
  ] | last // 0' 2>/dev/null)
case "$ctx" in (''|*[!0-9]*) echo '{}'; exit 0 ;; esac

# Para no repetir el mismo aviso en cada turno una vez cruzado el umbral.
#
# El marcador va POR SESION: con un archivo unico por proyecto, dos sesiones abiertas en
# el mismo repo se pisaban -- una sesion chica de 30k sobreescribia la marca de una de
# 200k, y la grande volvia a ver `previo < 150000` y repetia el aviso turno tras turno.
marca=".claude/.ultimo-aviso-compact-${sid}"
previo=0
[ -f "$marca" ] && previo=$(cat "$marca" 2>/dev/null)
case "$previo" in (''|*[!0-9]*) previo=0 ;; esac

k=$((ctx / 1000))
msg=""
# Umbral configurable. Por defecto avisa a los 150k: sobre 30 dias de uso real, el 57,6%
# de los turnos pasa ese numero, y es donde cambiar la forma de trabajar todavia sirve.
# El aviso es TEMPRANO a proposito: no reemplaza al auto-compact (que corta solo, mas
# arriba), aporta lo que el auto-compact no puede -- cambiar COMO se trabaja antes de
# llegar al techo.
UMBRAL="${TOKEN_SAVER_COMPACT_WARN:-150000}"
case "$UMBRAL" in (''|*[!0-9]*) UMBRAL=150000 ;; esac

if [ "$ctx" -ge "$UMBRAL" ] && [ "$previo" -lt "$UMBRAL" ]; then
  msg="CONTEXTO EN ${k}k. Queda menos margen del que parece: de aca en adelante evita "
  msg="$msg"'volcados grandes -- grep -n en vez de leer archivos enteros, colas en salidas largas, y considera /compact al cerrar la tarea actual.'
fi

mkdir -p .claude 2>/dev/null
echo "$ctx" > "$marca" 2>/dev/null

if [ -n "$msg" ]; then
  jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m}}'
else
  echo '{}'
fi
