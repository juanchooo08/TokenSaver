# token-saver

Un paquete que hace que Claude Code gaste menos tokens. Se instala con un comando en
cualquier proyecto, de cualquier lenguaje, y después trabaja solo en segundo plano.

```bash
git clone https://github.com/juanchooo08/TokenSaver.git
bash TokenSaver/install.sh --project /ruta/a/tu/proyecto
```

---

## Por qué tu sesión gasta tanto

Lo caro no es lo que Claude escribe. Es lo que Claude **lee**, una y otra vez.

Claude Code no tiene memoria entre mensajes: en cada turno vuelve a mandar toda la
conversación. Si en el turno 3 corriste un `npm run build` que falló y escupió 400 líneas de
errores, esas 400 líneas se vuelven a mandar en el turno 4, en el 5, en el 20. Las pagás
cada vez.

Midiendo 30 días de uso real:

| | |
|---|---|
| Lo que se relee por turno, en promedio | **214.000 tokens** |
| Turnos que pasan de 150.000 tokens | **57,6%** |
| Cuánto más grande es lo que se relee vs. lo que se escribe | **225 veces** |

Decirle "sé breve" a Claude no arregla nada, porque el problema no está en lo que escribe.
Este paquete ataca lo otro: **qué entra a la conversación, y qué se puede hacer sin Claude.**

---

## Qué hace, en simple

### 1. Corta las salidas largas antes de que entren

Cuando Claude corre un build, un test o un linter, este paquete guarda la salida completa en
un archivo aparte y solo deja pasar **las últimas 60 líneas**. Si necesita ver el resto, el
archivo está ahí y lo puede abrir.

Es lo único del paquete que borra tokens de verdad, en vez de sugerir que los borres.

> Archivo: `hooks/capturar-salida-larga.sh`

### 2. Te avisa cuando la conversación se puso cara

Lee cuánto pesa la conversación de verdad y avisa **una sola vez** cuando pasa los 150.000
tokens, para que sepas que es buen momento de hacer `/compact` o de arrancar un chat nuevo.
No cuenta mensajes a ciegas: mira el peso real.

> Archivo: `hooks/compact-reminder.sh`

### 3. Manda el trabajo aburrido a modelos gratis

Traducir un texto, generar datos de prueba, escribir un mensaje de commit, resumir un log de
errores: nada de eso necesita el modelo caro. El skill `cheap-ai` le pasa esas tareas a
modelos **gratuitos** de OpenRouter y te devuelve el resultado para que Claude lo revise.

La regla de oro: **el modelo barato nunca guarda archivos.** Solo propone; el modelo
principal revisa y decide.

> Skill: `skills/cheap-ai/`

### 4. Convierte los documentos largos en notas cortas

Si tu repo tiene documentación de 500 líneas, `destilar-docs` la resume una vez (con los
modelos gratis) y deja una nota de 40 líneas en `docs/notas/`. A partir de ahí Claude lee la
nota y no el documento. Solo vuelve a resumir lo que cambió.

> Skill: `skills/destilar-docs/`

### 5. Te ayuda a escribir prompts más cortos

`/prompt-compressor "tu texto largo"` te devuelve la versión corta para que la copies y la
mandes vos. Es manual a propósito: nadie reescribe tu mensaje sin que lo veas.

> Skill: `skills/prompt-compressor/`

### 6. Deja de preguntarte permiso por cada comando

Opcional (`--global`). Si tenés reglas que bloquean leer tu `.env`, Claude Code pregunta
permiso en casi cada comando por las dudas. Este hook responde por vos: si el comando no
menciona `.env` ni `secrets/`, pasa; si los menciona, decide el sistema normal como siempre.

> Archivo: `hooks/permitir-bash.sh`

---

## Los modelos gratis y baratos que usa

Cuando Claude delega una tarea, el skill busca un modelo en este orden:

**Primero, gratis.** No hay una lista fija porque los modelos gratuitos de OpenRouter
cambian cada pocas semanas. El skill mira el catálogo en vivo y elige los mejores por
benchmark real, no por precio. Prueba 4 antes de rendirse.

**Si todos los gratis fallan** (caídos o con el límite de uso agotado) y todavía te queda
presupuesto, baja a esta escalera de pagos, **del mejor al más barato**. Precios en dólares
por millón de tokens, verificados el 2026-09-04:

| Orden | Modelo | Salida | Entrada | Coding | Inteligencia |
|:---:|---|---:|---:|---:|---:|
| 1 | `z-ai/glm-5.3-flash` | $0.25 | $0.075 | **71.5** | **46.2** |
| 2 | `deepseek/deepseek-v4-flash-0731` | $0.18 | $0.065 | 69.1 | 40.8 |
| 3 | `upstage/solar-pro4` | $0.12 | $0.03 | 52.7 | s/d |
| 4 | `inclusionai/ling-3.0-flash` | $0.063 | $0.021 | 50.6 | 27.4 |

*Coding e inteligencia son los índices públicos de Artificial Analysis, los mismos que usa
el skill para ordenar los modelos.*

Empieza por el mejor y no por el más barato porque a esta escala el precio no cambia nada:
entre el primero y el último de la tabla hay US$0.0004 de diferencia por tarea. Lo que
protege tu bolsillo es el techo de precio, no el orden.

Para que tengas una idea de la escala: una tarea típica delegada gasta como US$0.0005 en el
modelo más caro de esa tabla. Con el tope de **US$1 por semana** que trae por defecto,
entran unas 2.000 tareas. En la práctica el gasto real es casi siempre **cero**, porque los
gratis funcionan.

Hay un techo duro de $0.30 por millón: cualquier modelo más caro queda descartado
automáticamente, aunque sea mejor. Es lo que evita que una tarea se coma el presupuesto de
la semana.

La escalera es una preferencia, no una obligación. Si mañana uno de esos modelos desaparece
o sube de precio, el skill lo saltea solo y elige el mejor que quede.

---

## Qué necesitás antes de instalar

- **`jq`** — un programita para leer JSON. Los hooks lo usan.
  `brew install jq` en Mac, `sudo apt install jq` en Linux.
- **Node 18 o más nuevo** — para los skills.
- **Una cuenta de OpenRouter** — la API key es gratis, se saca en
  <https://openrouter.ai/keys>.

Después de instalar, pegá la key en tu proyecto:

```bash
echo 'OPENROUTER_CHEAP_API_KEY=sk-or-v1-tu-key-aca' >> .env.local
```

Fijate que `.env.local` esté en tu `.gitignore`, así no se te sube por accidente.

> Si preferís poner la key una sola vez para todos tus proyectos, guardala en
> `~/.claude/cheap-ai.env`. El skill la busca ahí si no la encuentra en el proyecto.

**Los dos primeros hooks funcionan sin key.** La key hace falta para los que delegan trabajo.

---

## Instalación

```bash
bash install.sh                      # en la carpeta donde estás parado
bash install.sh --project ~/mi-app   # en otro proyecto
bash install.sh --global             # además, el hook de permisos para todos tus proyectos
bash install.sh --no-gate            # sin el sistema de créditos (ver abajo)
bash install.sh --dry-run            # mostrame qué harías, sin tocar nada
```

El instalador **no pisa tu configuración**: agrega los hooks a tu `.claude/settings.json`
respetando lo que ya tengas, y si lo corrés dos veces no duplica nada. Igual te deja una
copia de seguridad al lado.

Para terminar, copiá las reglas de [`docs/CLAUDE.md-snippet.md`](docs/CLAUDE.md-snippet.md)
a tu archivo `CLAUDE.md`. Los hooks hacen una parte del trabajo; la otra mitad del ahorro
está en cómo Claude decide leer y buscar, y eso son instrucciones.

### Comprobar que quedó bien

```bash
npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts
```

Te muestra cuánto llevás gastado esta semana y cuántos créditos tenés.

### Sacarlo

```bash
rm -rf .claude/hooks/{capturar-salida-larga,compact-reminder,cheap-ai-trigger,cheap-ai-heartbeat,cheap-ai-gate}.sh
rm -rf .claude/skills/{cheap-ai,destilar-docs,prompt-compressor}
```

Y borrá los bloques correspondientes de `.claude/settings.json`, o restaurá la copia
`.bak-...` que dejó el instalador.

---

## El sistema de créditos (leelo antes, es el más estricto)

Hay dos hooks que trabajan juntos:

```
delegás una tarea a un modelo gratis   ->  ganás 1 crédito
Claude quiere guardar un archivo       ->  gasta 1 crédito
no te quedan créditos                  ->  no puede guardar hasta que delegues algo
```

¿Por qué tan drástico? Porque "acordate de delegar lo aburrido" es una sugerencia que el
modelo olvida a los tres mensajes. Así deja de depender de su memoria.

**Si te parece demasiado, instalá con `--no-gate`** y te quedás con todo lo demás.

Trae tres salidas de emergencia:

- **Los archivos delicados nunca se bloquean.** Todo lo que tenga que ver con login,
  permisos, pagos, webhooks o `.env` se guarda sin gastar crédito. Ahí un modelo barato no
  debería opinar.
- **Si no tenés `cheap-ai` instalado, el hook no hace nada.** Sin forma de ganar créditos,
  bloquear sería dejarte encerrado.
- **`export TOKEN_SAVER_NO_CREDITS=1`** lo apaga entero, sin desinstalar nada.

---

## Ajustes que quizás quieras tocar

**Si no usás JavaScript.** Abrí `hooks/capturar-salida-larga.sh` y agregá tus comandos a la
lista (`cargo test`, `pytest`, `go test`, `mvn`, lo que uses). Por defecto trae los de
`npm`, `pnpm`, `yarn` y `bun`.

**Qué cosas nunca se delegan.** En `skills/cheap-ai/scripts/models.json`, la lista
`forbiddenPathPatterns` marca los temas donde el skill se niega a trabajar y te devuelve la
tarea. Vienen puestos login, migraciones de base de datos, `.env`, webhooks y pagos. Poné
los tuyos.

**Todas las variables de entorno:**

| Variable | Por defecto | Para qué |
|---|---|---|
| `OPENROUTER_CHEAP_API_KEY` | — | Tu key de OpenRouter. |
| `OPENROUTER_CHEAP_WEEKLY_CAP_USD` | `1` | Cuánto podés gastar por semana, en dólares. |
| `TOKEN_SAVER_NO_CREDITS` | — | `1` apaga el sistema de créditos. |
| `TOKEN_SAVER_COMPACT_WARN` | `150000` | A partir de qué tamaño te avisa. |

---

## Dos cosas importantes

**Tus prompts salen de tu computadora.** `cheap-ai` se los manda a OpenRouter, que es un
servicio de afuera. No le pases datos reales de clientes, contraseñas ni contenido de tu
`.env`. Si necesitás datos de ejemplo, inventá unos falsos primero. Si trabajás con
información sensible (salud, pagos, temas legales), en
[`docs/CLAUDE.md-snippet.md`](docs/CLAUDE.md-snippet.md) hay un bloque listo para prohibirlo
explícitamente.

**Nada de lo que escribe un modelo barato se guarda sin que Claude lo revise.** El skill
imprime el resultado en pantalla; guardarlo o no es decisión del modelo principal.

---

## Licencia

MIT. Usalo, cambialo, compartilo.
