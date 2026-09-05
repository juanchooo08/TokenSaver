#!/bin/bash
# UserPromptSubmit hook -- reemplaza al recordatorio que se inyectaba en CADA turno.
#
# El anterior gastaba ~130 tokens por turno pidiendo "acordate de delegar", se usara o no.
# Con ~12.000 turnos al mes eso era ~1,6M de tokens gastados en recordar que hay que
# ahorrar. Este mira lo que pidio el usuario y solo habla cuando hay algo delegable de
# verdad, asi el aviso vuelve a significar algo en vez de ser ruido de fondo.
#
# No decide por el modelo principal: sigue siendo este el que evalua y revisa. Lo unico
# que cambia es CUANDO se le recuerda.

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]')
[ -z "$prompt" ] && { echo '{}'; exit 0; }

# Trabajo mecanico: el modelo principal ya entendio que hay que hacer y solo falta
# producir texto o codigo bien especificado. Es lo que cheap-ai hace igual de bien.
# Los tokens cortos van anclados con \b: sin eso `seo` matcheaba dentro de "deseo" y
# "paseo", y `resum` dentro de "presumo" -- justo el ruido por turno que este hook vino
# a eliminar.
MECANICO='traduc|traduzc|\bresum|\bresúm|boilerplate|scaffold|fixture|\bseed|mock |datos de prueba'
MECANICO="$MECANICO"'|changelog|mensaje de commit|commit message|alt-text|alt text|metadata|\bseo\b'
MECANICO="$MECANICO"'|formatear|reformatear|limpiar (los )?datos|convertir (a|el|los)|renombrar'
MECANICO="$MECANICO"'|placeholder|lorem|copy para|redacta|redactar'

# Sensible: cheap-ai solo puede asistir (categoria assist). Nunca decide ni escribe.
# `\brls\b` por lo mismo: sin anclar matcheaba dentro de "urls".
SENSIBLE='auth|autenticaci|\brls\b|row level|seguridad|security|pago|payment|checkout|webhook'
SENSIBLE="$SENSIBLE"'|migracion|migración|arquitectura|refactor grande|debug'

msg=""
if printf '%s' "$prompt" | grep -qE "$MECANICO"; then
  msg="cheap-ai: este pedido parece tener trabajo MECANICO delegable. Antes de escribirlo vos, "
  msg="$msg"'corre `npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts --category <cat>` '
  msg="$msg"'(o --batch si hay mas de una tarea) y revisa el output antes de aplicarlo. Modelos gratis: costo US$0.'
elif printf '%s' "$prompt" | grep -qE "$SENSIBLE"; then
  msg="cheap-ai: area SENSIBLE. Podes usar --category assist para un borrador o una segunda "
  msg="$msg"'opinion, pero la decision final y el codigo que se aplica los escribis y revisas VOS, linea por linea.'
fi

if [ -n "$msg" ]; then
  jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m}}'
else
  echo '{}'
fi
