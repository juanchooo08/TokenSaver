---
name: cheap-ai
description: |
  Delega trabajo de implementacion bien acotado a modelos de IA gratis/baratos via
  OpenRouter directo, para no gastar tokens del modelo principal (Sonnet/Claude Code Pro)
  generando cosas que otro modelo puede escribir igual de bien. Tiene un tope de gasto
  semanal (default US$1, compartido entre todos los proyectos) que solo cuenta los modelos
  pagos -- los modelos gratis (":free") no consumen presupuesto.
  Usar PROACTIVAMENTE, en CADA tarea no trivial, para: traducir textos largos, resumir
  logs/errores extensos, generar boilerplate/fixtures/seeds, redactar commits/changelogs,
  formatear/limpiar datos, generar metadata SEO/alt-text, Y TAMBIEN para escribir
  componentes/hooks/configuracion bien especificados (categoria `implement`) cuando el
  modelo principal ya entendio el pedido y solo falta producir el codigo.
  Ademas tiene un rol de ASISTENTE (categoria `assist`, modelo fijo, gratis primero) para
  ayudar -- nunca reemplazar -- al modelo principal en auth/RLS/seguridad/arquitectura/
  debugging complejo: borradores, segundas opiniones, busqueda de huecos. La decision
  final y el codigo que se aplica en esas areas SIEMPRE los escribe/revisa el modelo
  principal linea por linea.
  NO USAR para escribir archivos directamente -- el output de este skill SIEMPRE debe
  pasar por revision del modelo principal antes de guardarse, sin excepcion.
user-invocable: true
argument-hint: "[--prompt \"...\" | --batch jobs.json]"
allowed-tools: Read, Bash
---

# Cheap AI (delegacion directa a OpenRouter)

> El modelo principal (Sonnet) es el cerebro: entiende el pedido, explora el codigo real,
> decide, y da la ultima palabra en todo lo sensible. Para todo lo demas -- trabajo mecanico,
> boilerplate, y hasta implementacion bien especificada -- delega a una IA gratis/barata de
> OpenRouter en vez de gastar tus propios tokens generandolo.

---

## Regla de Oro

**OpenRouter nunca escribe archivos.** Solo genera texto/borradores. El modelo principal
SIEMPRE revisa el output antes de usarlo o guardarlo -- sin excepcion, ni siquiera para
tareas "obvias". Lo caro no es generar, es NO revisar y meter algo roto.

---

## Cuando Usar (delegar)

- Traducir textos largos (i18n, copys, descripciones)
- Resumir logs, stack traces, o archivos grandes antes de analizarlos tu mismo
- Generar boilerplate repetitivo: fixtures de test, datos dummy, seeds
- Redactar mensajes de commit, changelogs, descripciones de PR (borrador, tu apruebas)
- Formatear/limpiar datos (JSON a CSV, normalizar texto)
- Generar metadata SEO, alt-text de imagenes, copys cortos no criticos
- Primeras versiones de documentacion no critica
- **Implementacion bien especificada** (categoria `implement`): un componente, un hook, un
  archivo de configuracion, contenido de una pagina -- cuando VOS (modelo principal) ya
  entendiste el pedido, explorastes el codigo existente, y podes darle a la IA barata una
  instruccion precisa con los fragmentos de contexto necesarios. Ella escribe el borrador,
  vos lo revisas contra las convenciones del proyecto antes de aplicarlo.
- **Asistencia en tareas sensibles** (categoria `assist`, ver seccion dedicada abajo)

## Cuando NO Usar (nunca delegar, ni como asistencia)

- Decidir la arquitectura final o aplicar codigo de auth/pagos/RLS/seguridad sin tu revision
  linea por linea
- Tomar la decision final de un debugging complejo o ambiguo
- Escribir el codigo final de produccion sin pasar por vos
- Cualquier cosa que el usuario no pueda ver revisada por vos antes de guardarse

---

## Modo Ambiental (delegacion continua, sin invocar nada "para activarla")

`/cheap-ai` sin `--prompt` ni `--batch` NO es un error -- corre un chequeo de estado
(presupuesto semanal + creditos disponibles) y explica el resto. La delegacion continua en
si NO depende de invocar el skill: esta forzada por 3 hooks en `.claude/settings.json` de
este proyecto, activos en cada sesion sin que nadie los invoque:

| Hook | Evento | Que hace |
|------|--------|----------|
| `cheap-ai-heartbeat.sh` | `PostToolUse` (matcher `Bash`) | Cada vez que corre `openrouter-call.ts` y algun job resuelve con `ok:true`, otorga 1 credito por job (un `--batch` de N tareas otorga N creditos de una sola llamada). |
| `cheap-ai-gate.sh` | `PreToolUse` (matcher `Write\|Edit`) | Consume 1 credito por cada escritura/edicion. Sin creditos, **bloquea** el `Write`/`Edit` y te devuelve el comando exacto para delegar primero. Rutas que matchean `auth\|rls\|polic\|payment\|checkout\|billing\|stripe\|polar\|security\|middleware\|webhook\|\.env` pasan siempre gratis, sin consumir ni requerir credito (ahi cheap-ai solo asiste, nunca decide -- Regla de Oro). |
| Reminder | `UserPromptSubmit` | Inyecta en cada mensaje el recordatorio de evaluar que se puede delegar antes de escribir vos mismo. |

El contador de creditos vive en `.claude/.cheap-ai-heartbeat` (un numero entero, texto plano)
dentro del repo del proyecto -- no en `~/.claude`, a diferencia del presupuesto semanal.

**Por que existe esto:** antes, la delegacion dependia de que el modelo principal se
acordara de delegar cada vez ("usar PROACTIVAMENTE"). El gate lo convierte en estructural --
un `Write`/`Edit` fuera de rutas sensibles simplemente no pasa si no hubo delegacion previa
en el mismo turno/sesion, asi que el ahorro de tokens no depende de la memoria ni el criterio
del modelo principal turno a turno.

---

## Prohibiciones (Criterio de Interrupcion / Deadman Switch)

Auth y RLS no son "trabajo mecanico bien especificado" -- son criterio de arquitecto. Esto
es Auto-Blindaje puro: en vez de confiar en que el prompt este bien acotado, el script se
bloquea solo antes de gastar una sola llamada.

- **El script rechaza automaticamente** cualquier tarea (`--prompt`, `--system` o `--file`)
  cuyo texto mencione una de las rutas protegidas de `scripts/models.json`
  (`forbiddenPathPatterns`: rutas de auth, migraciones, `.env`, secretos, middleware,
  webhooks, pagos), en cualquier categoria que NO sea `assist`. **Adapta esa lista a tu
  stack** -- son las areas donde un modelo barato no debe decidir el archivo final. Devuelve: `Error: Esta tarea requiere criterio de arquitecto. Ejecuta
  con Claude Code local.`
- **`assist` sigue permitido** para esas areas -- es la via sancionada para pedir un
  borrador/segunda opinion (ver seccion de abajo), nunca para que la IA barata escriba o
  aplique el codigo final.
- Los patrones bloqueados viven en `forbiddenPathPatterns` dentro de `scripts/models.json`
  -- agregales rutas si detectas otra capa sensible (ej. `src/lib/stripe`, `*.env*`).
- Esto es un limite de seguridad, no un parametro de eficiencia: el analisis de fin de
  sesion (ver abajo) **nunca** debe tocar esta seccion ni la lista de `forbiddenPathPatterns`
  para "hacerla mas permisiva".

---

## Rol de Asistente en Tareas Sensibles (categoria `assist`)

Auth, pagos, RLS, seguridad, arquitectura y debugging complejo **siguen siendo tuyos** --
pero eso no significa que tengas que hacer TODO el trabajo de cero. La IA barata puede
ayudarte como asistente, nunca como reemplazo:

| Tarea | Lo que hace la IA barata (`assist`) | Lo que haces vos |
|-------|--------------------------------------|--------------------|
| RLS | Borrador de una policy segun un patron estandar | Verificar cada linea contra el schema real antes de aplicarla |
| Debugging complejo | Resumir un stack trace enorme o buscar el patron en logs | El razonamiento de causa raiz y el fix |
| Seguridad | Actuar de "abogado del diablo": buscar huecos en codigo que VOS ya escribiste | Decidir si el hueco es real y como cerrarlo |
| Arquitectura | Investigar/resumir pros y contras de un patron (research) | Tomar la decision final |

`assist` usa una **lista fija en orden de intento** (ver `pinnedModels.assist` en
`scripts/models.json`), no el auto-ruteo que usan las demas categorias, porque en este rol
importa la consistencia del modelo:

1. `z-ai/glm-5.2:free` -- coding 68.8, el mejor gratis del catalogo por bastante (el
   segundo, `minimax-m3:free`, marca 58.6). US$0.
2. `z-ai/glm-5.3-flash` -- fallback pago (US$0.075/US$0.25 por millon), solo si el gratis
   esta caido o rate-limited. Misma familia que el gratis, asi el asistente no cambia de
   caracter entre uno y otro, y es el mejor benchmark bajo el techo de precio:
   coding 71.5, intelligence 46.2.

**Por que NO se fija el `z-ai/glm-5.2` pago:** cuesta US$3.04 por millon de tokens de
salida. Con un tope semanal de centavos, tres o cuatro consultas agotan el presupuesto de
la semana entera. La regla general al elegir modelo aca es mirar `pricing.completion` del
catalogo, no solo el benchmark; el techo duro esta en `maxPaidCompletionPricePerM`.

Sigue respetando el tope de presupuesto semanal igual que el resto.

---

## Como Funciona el Ruteo (sin preguntarle al usuario)

Cada llamada elige una **categoria** de tarea. Para las categorias normales, el script prueba
varios modelos gratis (`":free"`) en orden de calidad real; si TODOS fallan (rate limit,
caido, etc.) y todavia queda presupuesto semanal, cae a la **escalera de fallback pago** de
`pinnedModels.paidFallback`, en orden de menos a mas caro (precios por millon de tokens de
salida, verificados el 2026-09-04):

| # | Modelo | Salida | Entrada | Coding | Intelligence |
|---|--------|--------|---------|--------|--------------|
| 1 | `inclusionai/ling-3.0-flash` | US$0.063 | US$0.021 | 50.6 | 27.4 |
| 2 | `upstage/solar-pro4` | US$0.12 | US$0.03 | 52.7 | s/d |
| 3 | `deepseek/deepseek-v4-flash-0731` | US$0.18 | US$0.065 | 69.1 | 40.8 |
| 4 | `z-ai/glm-5.3-flash` | US$0.25 | US$0.075 | 71.5 | 46.2 |

La escalera es una preferencia, no una atadura: si un modelo desaparece del catalogo o sube
por encima de `maxPaidCompletionPricePerM`, se saltea solo y el hueco lo llena la seleccion
automatica por benchmark.

**Gemini salio de `paidProviderKeywords`:** Gemini Flash hoy cuesta US$3.75 por millon de
salida, 12 veces el techo, asi que el filtro lo descartaba siempre. Era peso muerto. La categoria `assist` es la unica excepcion: usa siempre el
modelo fijo, nunca prueba gratis primero (ver seccion de arriba).

| Categoria | Tipo de tarea |
|-----------|----------------|
| `translation` | Traduccion, copy, texto de marketing |
| `code` | Boilerplate, fixtures, tests, seeds |
| `implement` | Componente/hook/config bien especificado, contenido de pagina |
| `summarize` | Resumir logs/errores/textos largos |
| `reasoning` | Extraccion de datos estructurados, razonamiento medio |
| `auto` | Cualquier otra tarea mecanica sin categoria clara (default) |
| `assist` | Ayuda (no reemplazo) en auth/RLS/seguridad/arquitectura/debugging complejo -- modelo fijo |

La tabla completa de modelos, keywords y el modelo fijo de `assist` esta en
`scripts/models.json` -- revisala/actualizala si notas que un modelo gratis dejo de existir
o los precios cambiaron (verificar en https://openrouter.ai/models).

**Como se elige el modelo dentro de cada categoria (salvo `assist`):** por benchmarks reales
de calidad (`intelligence_index` / `coding_index` de Artificial Analysis, que OpenRouter
expone en `/api/v1/models`), NO por tamano de contexto ni por ser el mas barato. Un modelo
con ventana grande o precio bajo pero mal benchmark NO se prioriza -- la meta es que el
resultado sirva de verdad, no solo que sea gratis.

---

## Validation-as-a-Service (auto-validacion antes de mostrarte el resultado)

Para las categorias `code` e `implement`, si la respuesta del modelo incluye un bloque de
codigo TS/JS/TSX/JSX, el script lo pasa por `tsc --noEmit` (usando el `tsc` local del
proyecto, `node_modules/.bin/tsc` -- si el proyecto no lo tiene instalado, se salta la
validacion en vez de fallar por falta de herramienta) ANTES de devolverte el contenido.

- Si el typecheck falla, ese intento cuenta como fallido y el script prueba automaticamente
  el siguiente modelo (gratis primero, despues fallback pago) -- vos ves en stderr un aviso
  tipo "el modelo fallo, reintentando con otro", no el codigo roto.
- Si TODOS los modelos fallan el typecheck (o fallan por otra razon), el job vuelve con
  `ok: false` y el error correspondiente -- en ese caso hacelo vos mismo.
- Esto no reemplaza tu revision: sigue siendo la Regla de Oro. Solo evita que pierdas tiempo
  revisando a mano un borrador que ni siquiera compila.
- No aplica a `--variants` (ahi el objetivo es comparar varios borradores a mano) ni a
  `assist` (su output es prosa/analisis, no codigo para aplicar).

---

## Comando

```bash
npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts \
  --prompt "TEXTO O INSTRUCCION" \
  [--system "instrucciones de rol"] \
  [--category translation|code|implement|summarize|reasoning|auto|assist] \
  [--file ./archivo-de-entrada.txt] \
  [--variants N]
```

| Arg | Requerido | Descripcion |
|-----|-----------|-------------|
| `--prompt` | SI (o `--file`) | La tarea/instruccion |
| `--system` | NO | System prompt para acotar el rol |
| `--category` | NO | Categoria de ruteo (ver tabla). Default: `auto` |
| `--file` | NO | Path a archivo cuyo contenido se agrega antes del prompt |
| `--variants` | NO | Si es >1 (y la categoria no es `assist`), pide el MISMO borrador a N modelos gratis EN PARALELO en vez de uno solo -- devuelve todos para que elijas/combines el mejor. Sigue costando US$0. Util para `implement` cuando la calidad importa. |

**Invocacion directa por el usuario:** el skill es `user-invocable: true`, asi que dentro de
una sesion de `claude` alcanza con escribir `/cheap-ai --batch jobs.json` (o
`/cheap-ai --prompt "..." --category translation`, etc.) -- Claude Code mapea el slash
command al mismo comando `npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts` de
arriba, con los argumentos que sigan al nombre del skill.

---

## Modo Batch: Varias Tareas EN PARALELO (usar SIEMPRE que haya >1 tarea delegable)

Cuando detectes **varias** tareas delegables independientes en el mismo turno (ej: traducir
5 archivos, generar 3 sets de fixtures, resumir 4 logs distintos), arma un solo batch en vez
de llamar una por una -- corren todas al mismo tiempo.

1. Escribe un archivo temporal `jobs.json` con un array de tareas, cada una con su categoria:

```json
[
  { "id": "traducir-hero", "prompt": "Traduce al ingles: ...", "category": "translation" },
  { "id": "fixtures-usuarios", "prompt": "Genera 20 usuarios dummy en JSON: ...", "category": "code" },
  { "id": "resumen-log-build", "prompt": "Resume los errores clave de este log: ...", "category": "summarize" }
]
```

2. Corre (idealmente con `run_in_background: true` para no bloquearte mientras responde):

```bash
npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts --batch jobs.json
```

3. El script corre las tareas **en paralelo real** (`Promise.all` -- todas comparten el
   mismo presupuesto semanal en memoria; si dos caen al fallback pago en el mismo instante
   el tope se puede pasar por centavos, riesgo aceptado por velocidad) y devuelve un JSON
   array `[{ id, ok, content, model, costUSD, error }]`. Revisa cada `content` antes de
   usarlo; si algun `ok` es `false`, decide si lo reintentas o lo haces tu mismo.
4. Borra el archivo temporal `jobs.json` al terminar.

---

## Presupuesto Semanal

- Tope: **US$1/semana** (configurable con env var `OPENROUTER_CHEAP_WEEKLY_CAP_USD`).
- Se reinicia automaticamente cada lunes. El acumulado vive en
  `~/.claude/openrouter-budget.json` -- es **global a esta maquina**, se comparte entre
  TODOS los proyectos que tengan el skill instalado, no solo este.
- Los modelos gratis (`":free"`) no consumen presupuesto -- solo se descuenta cuando se
  cae al fallback pago o se usa `assist` (que siempre es pago).
- Si el presupuesto se agota y los modelos gratis tambien fallan (o la tarea era `assist`),
  el script termina con error explicito: en ese caso, haz la tarea vos mismo en vez de insistir.
- Cada llamada deja un renglon en `~/.claude/openrouter-usage-log.jsonl` (modelo, categoria,
  costo) -- revisalo si el usuario pregunta si de verdad se esta delegando.
- Cada tarea delegada **que tuvo exito** ademas deja un renglon legible en
  `.claude/memory/DELEGATED_TASKS.md` (dentro del repo, no en `~/.claude`): fecha, id,
  categoria, modelo real, costo, y los primeros ~80 caracteres del prompt. Es el historial
  de "que se escribio a mano vs que se delego" -- si en unos dias hay que cambiar algo que
  vino de aca, revisa ese archivo para saber que modelo y que prompt se usaron antes de
  tocarlo.

---

## Prerequisito: la key (una sola, en todos los proyectos)

La key de `cheap-ai` es **compartida**: la misma en todos los proyectos de esta maquina,
en la variable dedicada `OPENROUTER_CHEAP_API_KEY`. Separada a proposito de
`OPENROUTER_API_KEY`, que es la que usa la app en produccion, para que el gasto del skill
no se mezcle con el consumo real de la app.

Las keys PROPIAS de cada proyecto (base de datos, mailer, `OPENROUTER_API_KEY` de la app,
etc.) se quedan en su `.env.local` y **no se tocan nunca**.

| Donde | Que |
|-------|-----|
| `~/.claude/secrets/openrouter` | La key (chmod 600). **Fuente de verdad.** |
| `.env.local` de cada proyecto | Copia, dentro del bloque delimitado `# --- cheap-ai ---` |
| `~/.claude/cheap-ai.env` | Defaults de la maquina; cubre proyectos nuevos sin `.env.local` |

Orden de busqueda: `.env.local` del proyecto -> `.env.local` del cwd ->
`~/.claude/cheap-ai.env` -> `~/.claude/secrets/openrouter`. Un proyecto recien creado
funciona sin configurar nada.

Un `OPENROUTER_API_KEY` generico del proyecto **no** bloquea el fallback global: varios
`.env.local` arrastran keys viejas y muertas con ese nombre, y darlas por buenas hacia
fallar el skill con el error enganoso "todos los modelos fallaron".

### Rotar la key

Cambiar `~/.claude/secrets/openrouter` y correr:

```bash
npx tsx .claude/skills/cheap-ai/scripts/sync-key.ts            # reparte a todos
npx tsx .claude/skills/cheap-ai/scripts/sync-key.ts --dry-run  # ver antes de escribir
```

Valida la key contra OpenRouter **antes** de repartirla (propagar una key muerta deja el
skill roto en todos los proyectos), deriva el tope local del limite real de la cuenta, y
reescribe solo el bloque de cheap-ai. Es idempotente.

---

## Ejemplo de Flujo (tarea mecanica)

```
Usuario: "traduce estos 40 textos de la landing al ingles"

1. Junta los textos en un archivo temporal o pasalos en --prompt
2. npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts \
     --system "Traduce al ingles manteniendo el tono de marketing, responde solo con las traducciones" \
     --file textos-es.txt \
     --category translation
3. Revisa el output: si la calidad es aceptable, lo usas; si no, lo ajustas tu mismo
4. Tu (modelo principal) escribes el resultado final en los archivos del proyecto
```

## Ejemplo de Flujo (asistencia en tarea sensible)

```
Usuario: "ayudame a revisar la policy de RLS de garments"

1. Vos ya leiste el schema real y escribiste (o estas por escribir) la policy
2. npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts \
     --system "Sos un asistente de seguridad. Actua como abogado del diablo, se breve." \
     --prompt "Busca huecos de seguridad en esta policy: <pegar SQL>" \
     --category assist
3. Cruzas los huecos que senala contra el schema real -- descartas falsos positivos,
   confirmas los reales
4. Vos decidis el fix final y aplicas el SQL -- el asistente nunca escribe el archivo
```

---

## Analisis de Fin de Sesion (auto-mejora del skill, AUTONOMA)

**Trigger:** SIEMPRE que la sesion este por terminar (el usuario dice algo tipo "ya vamos a
parar por hoy", "eso es todo por hoy", "terminamos por hoy", "nos vemos", cierra el tema, o
pide explicitamente el analisis) Y `cheap-ai` se uso al menos una vez en la sesion. Si no se
uso ni una vez, no hay nada que analizar -- saltealo en silencio. Esto corre SIN que el
usuario tenga que pedirlo cada vez -- es tu criterio, proactivo, cada sesion.

Cuando el trigger aplique, ANTES de cerrar la sesion:

1. **Reconstruye el uso real de la sesion** leyendo `~/.claude/openrouter-usage-log.jsonl`
   (filtra por los timestamps de esta sesion) y, si corriste batches, los `jobs.json`/outputs
   que hayas visto en el turno. Saca metricas: cuantas llamadas, por categoria, cuantas
   cayeron a fallback pago vs se resolvieron gratis, costo acumulado vs el tope semanal,
   y si algun modelo fallo repetido (rate limit, respuesta vacia, etc.).
2. **Evalua la calidad real de la delegacion**, no solo el volumen:
   - Casos donde el borrador de la IA barata sirvio tal cual vs tuviste que reescribirlo
     vos casi entero (senal de categoria mal elegida o prompt de sistema pobre).
   - Tareas mecanicas/delegables de la sesion que terminaste haciendo vos mismo en vez de
     pasarlas por el skill (oportunidad perdida de ahorrar tokens).
   - Si usaste `--variants` alguna vez y si valio la pena vs el costo/tiempo extra.
3. **Decide y aplica los ajustes vos mismo, con tu criterio, SIN preguntarle al usuario.**
   No es una propuesta que esperas que el usuario apruebe -- la aplicas directo. Ejemplos de
   lo que podes tocar: agregar/quitar keywords en `paidProviderKeywords` o
   `codeCategoryKeywords` en `models.json`, ajustar `maxFreeAttempts`/
   `maxPaidFallbackAttempts` si un modelo gratis falla siempre y hace perder tiempo, cambiar
   el modelo fijo de `assist` en `pinnedModels`, agregar una categoria nueva en este SKILL.md
   si detectaste un tipo de tarea recurrente que no encaja en las actuales, o ajustar el
   texto sugerido de `--system` para una categoria si el resultado viene con un formato que
   siempre hay que corregir a mano. Cambios chicos y reversibles -- nunca una reescritura
   grande de una sola vez.
4. **Limite duro, esto NUNCA se auto-modifica:** la "Regla de Oro" (OpenRouter nunca escribe
   archivos, el modelo principal siempre revisa antes de guardar), la lista de que NO se
   delega nunca (auth/pagos/RLS/seguridad/arquitectura/debugging complejo/decision final), el
   hecho de que `assist` es solo ayuda y no reemplazo, y `forbiddenPathPatterns` en
   `models.json` (el deadman switch de la seccion "Prohibiciones") -- solo se le pueden
   AGREGAR rutas nuevas si se detecta otra capa sensible, nunca quitarle ninguna. Si el
   analisis "sugiere" tocar alguna de estas reglas para hacerlas mas permisivas, ignoralo y
   seguí de largo -- son limites de seguridad, no parametros de eficiencia.
5. **Deja rastro en `## Historial de Auto-Mejora` (abajo en este mismo archivo):** una linea
   nueva con fecha, que cambiaste, y por que (la metrica/patron que lo justifico). Asi el
   usuario puede ver que paso con el tiempo sin tener que pedir nada, pero vos no esperas su
   aprobacion para seguir. No hace falta avisarle en el chat salvo que el cambio sea grande
   o dudoso -- en ese caso, un mensaje de una linea alcanza.

---

## Historial de Auto-Mejora

*(la seccion de arriba se auto-actualiza aca cada vez que corre el analisis de fin de
sesion y aplica un cambio -- formato: fecha, que cambio, por que)*

- **2026-07-25:** Fix critico -- `openrouter-call.ts` nunca cargaba `.env.local` (a
  diferencia de Next.js, `npx tsx` no lo hace solo), asi que el skill fallaba siempre con
  "falta OPENROUTER_CHEAP_API_KEY" salvo que la variable ya estuviera exportada a mano en la
  shell. Se agrego `loadEnvLocal()` al inicio del script (busca `.env.local` en la raiz del
  proyecto relativo a la ubicacion fija del script, con fallback a `process.cwd()`, sin pisar
  variables ya exportadas). Verificado con llamadas reales ($0, modelos gratis) en los 9
  proyectos que usan este skill -- todos funcionan ahora.
- **2026-07-25:** Se agrego `"gemini"` a `paidProviderKeywords` en `models.json`. Verificado
  contra el catalogo real de OpenRouter (`/api/v1/models`): hoy no hay ningun Gemini gratis
  (solo Gemma, un modelo distinto y mas chico), pero `google/gemini-3.5-flash` como fallback
  pago es mas barato Y tiene mejor benchmark (intelligence 50.2, coding 70.1) que varias de
  las opciones "chinas" ya configuradas -- ahora entra en la rotacion del fallback pago.
- **2026-07-25:** Se agrego timeout (`AbortSignal.timeout`) a ambas llamadas fetch del
  script -- 20s para listar modelos, 60s para completar una tarea -- para que un OpenRouter
  lento o colgado no bloquee indefinidamente al modelo principal esperando el resultado.
- **2026-07-26 (manual, no autonomo):** Tres mejoras pedidas por el usuario tras revisar el
  skill: (1) Validation-as-a-Service -- `runJob` ahora tipeachea con el `tsc` local del
  proyecto cualquier bloque de codigo TS/JS devuelto en categorias `code`/`implement` antes
  de aceptarlo, y reintenta con el siguiente modelo si falla; (2) deadman switch -- nueva
  seccion "Prohibiciones" + `forbiddenPathPatterns` en `models.json`: el script se bloquea
  solo si una tarea (fuera de `assist`) menciona una ruta protegida;
  (3) `user-invocable: true` + `argument-hint` en el frontmatter para que `/cheap-ai --batch
  jobs.json` funcione como slash command, y registro automatico de cada delegacion exitosa
  en `.claude/memory/DELEGATED_TASKS.md` (fecha/modelo/prompt) para tener historial de que
  se delego vs que se escribio a mano.
