#!/usr/bin/env bash
# Instalador de token-saver: copia los hooks y skills al .claude/ de un proyecto y
# engancha los hooks en settings.json SIN pisar lo que ya tengas configurado.
#
#   bash install.sh                      # instala en el directorio actual
#   bash install.sh --project ~/mi-app   # instala en otro proyecto
#   bash install.sh --global             # ademas instala permitir-bash.sh en ~/.claude
#   bash install.sh --no-gate            # sin el gate que bloquea Write/Edit sin creditos
#   bash install.sh --dry-run            # muestra que haria, no escribe nada
#
# Es idempotente: correrlo dos veces no duplica hooks ni pisa tus reglas.
set -euo pipefail

ORIGEN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO="$PWD"
GLOBAL=0
GATE=1
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) DESTINO="$(cd "$2" && pwd)"; shift 2 ;;
    --global)  GLOBAL=1; shift ;;
    --no-gate) GATE=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "  [dry-run] $*"; else eval "$@"; fi; }

# --- dependencias ---------------------------------------------------------------
faltan=""
command -v jq   >/dev/null 2>&1 || faltan="$faltan jq"
command -v node >/dev/null 2>&1 || faltan="$faltan node"
if [ -n "$faltan" ]; then
  say "Faltan dependencias:$faltan"
  say "  macOS:  brew install${faltan}"
  say "  Debian: sudo apt install${faltan}"
  say ""
  say "jq lo usan los hooks para leer el JSON que les pasa Claude Code."
  say "node (>=18) lo usa el skill cheap-ai. Sin ellos la instalacion no sirve."
  exit 1
fi

say "token-saver -> $DESTINO"
say ""

# --- hooks ----------------------------------------------------------------------
run "mkdir -p '$DESTINO/.claude/hooks' '$DESTINO/.claude/skills'"

for h in compact-reminder capturar-salida-larga cheap-ai-trigger cheap-ai-heartbeat; do
  say "hook  $h.sh"
  run "cp '$ORIGEN/hooks/$h.sh' '$DESTINO/.claude/hooks/'"
  run "chmod +x '$DESTINO/.claude/hooks/$h.sh'"
done

if [ "$GATE" = 1 ]; then
  say "hook  cheap-ai-gate.sh   (bloquea Write/Edit sin creditos de delegacion)"
  run "cp '$ORIGEN/hooks/cheap-ai-gate.sh' '$DESTINO/.claude/hooks/'"
  run "chmod +x '$DESTINO/.claude/hooks/cheap-ai-gate.sh'"
fi

# --- skills ---------------------------------------------------------------------
for s in cheap-ai destilar-docs prompt-compressor; do
  say "skill $s"
  run "rm -rf '$DESTINO/.claude/skills/$s'"
  run "cp -R '$ORIGEN/skills/$s' '$DESTINO/.claude/skills/$s'"
done

# --- settings.json: merge, no overwrite -----------------------------------------
SETTINGS="$DESTINO/.claude/settings.json"
FRAGMENTO="$ORIGEN/settings.hooks.json"

if [ "$GATE" = 0 ]; then
  FRAGMENTO="$(mktemp)"
  jq 'del(.hooks.PreToolUse[] | select(.matcher == "Write|Edit"))' "$ORIGEN/settings.hooks.json" > "$FRAGMENTO"
fi

say ""
say "settings.json: enganchando hooks (sin tocar el resto de tu configuracion)"

if [ "$DRY" = 1 ]; then
  say "  [dry-run] merge de $FRAGMENTO en $SETTINGS"
else
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  # Backup una sola vez, con timestamp: si algo sale mal el original sigue ahi.
  cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"
  tmp="$(mktemp)"
  # Agrega solo las entradas cuyo comando todavia no este registrado. Correr el
  # instalador dos veces no duplica hooks.
  jq --slurpfile nuevo "$FRAGMENTO" '
    ($nuevo[0].hooks) as $nh
    | reduce ($nh | keys_unsorted[]) as $ev (.;
        .hooks[$ev] = (
          ((.hooks[$ev] // [])) as $cur
          | $cur + [ $nh[$ev][] | . as $e
              | select( (($cur | map(.hooks[].command)) | index($e.hooks[0].command)) | not ) ]
        )
      )
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
fi

# --- hook global opcional --------------------------------------------------------
if [ "$GLOBAL" = 1 ]; then
  say ""
  say "global: permitir-bash.sh en ~/.claude/hooks"
  run "mkdir -p '$HOME/.claude/hooks'"
  run "cp '$ORIGEN/hooks/permitir-bash.sh' '$HOME/.claude/hooks/'"
  run "chmod +x '$HOME/.claude/hooks/permitir-bash.sh'"
  if [ "$DRY" = 1 ]; then
    say "  [dry-run] registrar el hook en ~/.claude/settings.json"
  else
    G="$HOME/.claude/settings.json"
    [ -f "$G" ] || echo '{}' > "$G"
    cp "$G" "$G.bak-$(date +%Y%m%d-%H%M%S)"
    tmp="$(mktemp)"
    jq --arg cmd "bash $HOME/.claude/hooks/permitir-bash.sh" '
      .hooks.PreToolUse = (
        (.hooks.PreToolUse // []) as $cur
        | if ($cur | map(.hooks[].command) | index($cmd)) then $cur
          else $cur + [{matcher: "Bash", hooks: [{type: "command", command: $cmd}]}] end
      )
    ' "$G" > "$tmp" && mv "$tmp" "$G"
  fi
fi

# --- cierre -----------------------------------------------------------------------
say ""
say "Listo."
say ""
if [ ! -f "$DESTINO/.env.local" ] || ! grep -q "OPENROUTER_CHEAP_API_KEY" "$DESTINO/.env.local" 2>/dev/null; then
  say "FALTA LA KEY. cheap-ai y destilar-docs no funcionan sin ella:"
  say ""
  say "  echo 'OPENROUTER_CHEAP_API_KEY=sk-or-v1-...' >> $DESTINO/.env.local"
  say ""
  say "Se saca gratis en https://openrouter.ai/keys . El skill usa modelos ':free'"
  say "(costo US\$0); el fallback pago tiene un tope de US\$1/semana por maquina."
  say "Asegurate de que .env.local este en tu .gitignore."
  say ""
  say "RECOMENDADO: carga US\$10 de saldo en OpenRouter. No es para pagar los modelos,"
  say "es para que los gratis rindan: con menos de US\$10 cargados el limite de los ':free'"
  say "es 50 pedidos por dia; con US\$10 o mas pasa a 1000. Ese mismo saldo cubre el"
  say "fallback pago, que casi nunca se usa."
  say ""
fi
say "Verificacion rapida (dentro de $DESTINO):"
say "  npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts"
say ""
say "Copia las reglas de docs/CLAUDE.md-snippet.md a tu CLAUDE.md: los hooks automatizan"
say "una parte, pero la mitad del ahorro esta en como el agente decide leer y buscar."
