# token-saver

Hooks y skills para gastar menos tokens en Claude Code. Se instalan en cualquier proyecto,
en cualquier lenguaje, y funcionan solos: no dependen de que el modelo se acuerde de nada.

```bash
git clone https://github.com/juanchooo08/TokenSaver.git
bash TokenSaver/token-saver/install.sh --project /ruta/a/tu/proyecto
```

---

## El problema

Lo caro no es lo que el modelo escribe. Es el tamaño del contexto que se relee en **cada
turno**.

Medido sobre 30 días de uso real de Claude Code (los números salen de los `.jsonl` de
sesión, campo `message.usage`):

| Métrica | Valor |
|---|---|
| Contexto promedio por turno | ~214.000 tokens |
| Turnos que pasan de 150k | 57,6% |
| Relación cache-read / output | **~225 a 1** |

Un `npm run build` que falla vuelca 400 líneas de stack trace. Esas 400 líneas no se pagan
una vez: se releen en cada turno posterior de la sesión. Ese es el gasto real, y ninguna
instrucción del tipo "sé conciso" lo toca.

Este paquete ataca eso en tres frentes: **recortar lo que entra** al contexto, **avisar
antes** de que el contexto se vuelva caro, y **bajar el trabajo mecánico** a modelos
gratis.

---

## Qué instala

### Hooks (automáticos, no dependen del criterio del modelo)

| Hook | Evento | Qué hace |
|---|---|---|
| `capturar-salida-larga.sh` | `PreToolUse` / Bash | Intercepta builds, tests y linters: vuelca la salida completa a `/tmp` y deja entrar al contexto solo las últimas 60 líneas. **Es el único que elimina tokens en vez de sugerir que los elimines.** |
| `compact-reminder.sh` | `UserPromptSubmit` | Lee el tamaño real del contexto del turno anterior y avisa **una sola vez** al cruzar 150k. Sin contar turnos a ciegas. |
| `cheap-ai-trigger.sh` | `UserPromptSubmit` | Detecta por regex si tu pedido tiene trabajo mecánico delegable y solo entonces recuerda delegarlo. |
| `cheap-ai-heartbeat.sh` | `PostToolUse` / Bash | Otorga 1 crédito por cada tarea que delegaste con éxito. |
| `cheap-ai-gate.sh` | `PreToolUse` / Write\|Edit | Cobra 1 crédito por cada escritura. Sin créditos, bloquea. |
| `permitir-bash.sh` | `PreToolUse` / Bash (global, opcional) | Auto-aprueba comandos que no nombran `.env` ni `secrets/`, para que las reglas `deny` no disparen un prompt de permiso en cada comando. |

### Skills

| Skill | Qué hace |
|---|---|
| `cheap-ai` | Delega trabajo mecánico a modelos `:free` de OpenRouter (traducciones, fixtures, boilerplate, changelogs, resúmenes de logs). Elige el modelo en vivo por benchmark, valida el código que devuelve con tu `tsc`, y tiene tope de gasto semanal. |
| `destilar-docs` | Convierte los `.md` largos del repo en notas cortas en `docs/notas/`. Después el agente lee 40 líneas en vez de 500. Idempotente por hash. |
| `prompt-compressor` | Comprime un borrador de prompt largo antes de que lo mandes. Manual, a propósito. |

---

## El sistema de créditos (leelo antes de instalar)

`cheap-ai-heartbeat.sh` + `cheap-ai-gate.sh` forman un ciclo cerrado:

```
delegás una tarea a un modelo gratis  ->  ganás 1 crédito
Claude quiere escribir un archivo     ->  gasta 1 crédito
sin créditos                          ->  Write/Edit bloqueado
```

La idea: sin el gate, "delegá lo mecánico" es una sugerencia que el modelo olvida en el
turno 3. Con el gate, la escalera de tokens deja de depender de su memoria.

**Es el mecanismo más agresivo del paquete.** Si no lo querés, instalá con `--no-gate` y
te quedás con todo lo demás.

Dos salidas de emergencia, ya incluidas:

- **Rutas sensibles pasan siempre, gratis.** Cualquier archivo cuyo path matchee
  `auth|rls|polic|payment|checkout|billing|stripe|polar|security|middleware|webhook|.env`
  se escribe sin consumir crédito. Ahí un modelo barato nunca decide el archivo final.
- **Sin `cheap-ai` instalado, el gate se abstiene.** No hay forma de ganar créditos, así
  que bloquear sería dejar al agente sin salida.

Y un opt-out global: `export TOKEN_SAVER_NO_CREDITS=1` desactiva el ciclo entero sin
desinstalar nada. Útil si ya corrés Claude Code contra un modelo gratis o un gateway local
— ahí la capa 2 no aporta nada.

---

## Requisitos

- **`jq`** — los hooks lo usan para leer el JSON que les pasa Claude Code. Sin esto no
  funciona ninguno.
- **Node ≥ 18** — para los skills (`npx tsx`).
- **Una API key de OpenRouter** — gratis en <https://openrouter.ai/keys>.

```bash
echo 'OPENROUTER_CHEAP_API_KEY=sk-or-v1-...' >> .env.local
```

O una vez para toda la máquina, en `~/.claude/cheap-ai.env` (el skill la busca ahí si no
la encuentra en el proyecto).

Sobre el costo: `cheap-ai` usa modelos `:free`, que cuestan US$0. Solo cae a un modelo pago
cuando los gratis fallan, con un techo duro de US$0,30 por millón de tokens de salida y un
tope de **US$1 por semana** compartido entre todos tus proyectos
(`OPENROUTER_CHEAP_WEEKLY_CAP_USD`). El acumulado vive en `~/.claude/openrouter-budget.json`
y se reinicia los lunes.

**Los hooks funcionan sin key.** Los que dependen de OpenRouter son los skills y el ciclo
de créditos.

---

## Instalación

```bash
bash install.sh                      # en el directorio actual
bash install.sh --project ~/mi-app   # en otro proyecto
bash install.sh --global             # + permitir-bash.sh en ~/.claude
bash install.sh --no-gate            # sin el gate de créditos
bash install.sh --dry-run            # mostrame qué harías
```

El instalador **mergea** los hooks dentro de tu `.claude/settings.json` con `jq`: no pisa
tus `permissions`, tu `model` ni tus hooks propios, y correrlo dos veces no duplica nada.
Igual deja un backup con timestamp al lado.

Después, copiá las reglas de [`docs/CLAUDE.md-snippet.md`](docs/CLAUDE.md-snippet.md) a tu
`CLAUDE.md`. Los hooks automatizan una parte; la otra mitad del ahorro está en cómo el
agente decide leer y buscar, y eso son reglas.

### Verificar

```bash
npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts     # estado y presupuesto
```

### Desinstalar

```bash
rm -rf .claude/hooks/{capturar-salida-larga,compact-reminder,cheap-ai-trigger,cheap-ai-heartbeat,cheap-ai-gate}.sh
rm -rf .claude/skills/{cheap-ai,destilar-docs,prompt-compressor}
```

y sacá los bloques correspondientes de `.claude/settings.json` (o restaurá el `.bak-*` que
dejó el instalador).

---

## Cómo adaptarlo a tu stack

Este paquete es agnóstico del lenguaje, pero dos cosas conviene ajustar:

1. **`skills/cheap-ai/scripts/models.json` → `forbiddenPathPatterns`.** Es un deadman
   switch: si el prompt de una tarea menciona una de esas rutas, el skill se niega a
   ejecutarla y te la devuelve. Los valores por defecto (`/auth`, `migrations/`, `.env`,
   `/webhook`…) cubren un stack web típico. Poné las tuyas.
2. **La lista de comandos de `capturar-salida-larga.sh`.** Trae `npm/pnpm/yarn/bun` +
   `tsc/next/playwright`. Si usás `cargo`, `pytest`, `go test` o `mvn`, agregalos al `case`.

El hook es conservador a propósito: se abstiene si el comando ya tiene pipes,
redirecciones o encadenamientos, porque ahí vos o el modelo ya decidieron qué querían ver.

---

## Variables de entorno

| Variable | Default | Qué hace |
|---|---|---|
| `OPENROUTER_CHEAP_API_KEY` | — | Key de OpenRouter para los skills. Separada de la key que use tu app en producción. |
| `OPENROUTER_CHEAP_WEEKLY_CAP_USD` | `1` | Tope de gasto semanal, por máquina. |
| `TOKEN_SAVER_NO_CREDITS` | — | `1` desactiva el ciclo de créditos (heartbeat + gate). |
| `TOKEN_SAVER_COMPACT_WARN` | `150000` | Umbral de contexto para el aviso temprano. |
| `CHEAP_AI_SYNC_EXCLUDE` | — | Proyectos a excluir de `sync-key.ts`, separados por coma. |

---

## Advertencias

- **`cheap-ai` manda tu prompt a OpenRouter, que es un servicio externo.** Nunca le pases
  datos reales de usuarios, credenciales ni contenido de `.env`. Si una tarea mecánica
  necesita datos de ejemplo, inventá fixtures sintéticos primero. Si trabajás con datos
  sensibles (salud, pagos, legal), copiá la cláusula de corte duro del snippet de
  `CLAUDE.md`.
- **Nada de lo que devuelve un modelo barato se guarda sin revisión.** El skill nunca
  escribe archivos: imprime, y el modelo principal decide.
- El presupuesto en modo `--batch` puede pasarse por centavos: los jobs corren en paralelo
  contra un contador compartido en memoria. Es una limitación conocida y aceptada.
