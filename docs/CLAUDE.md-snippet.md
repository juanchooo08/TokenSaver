# Reglas para tu CLAUDE.md

Copiá esto a tu `CLAUDE.md` (global en `~/.claude/CLAUDE.md`, o el del proyecto). Los hooks
recortan lo que entra al contexto; estas reglas cambian cómo el agente decide leer y buscar,
que es la otra mitad del ahorro.

Está en español porque así se usa a diario, pero el modelo lo entiende igual en cualquier
idioma. Traducilo si preferís.

---

```markdown
## Gestión de contexto y coste

El gasto real no está en lo que generás, está en el tamaño del contexto que se relee en
cada turno. Medido sobre 30 días: el cache-read es ~225 veces el output.

- **Compactá antes de que duela.** Al terminar una fase, `/compact`. Si la conversación
  cambia de tema, decilo y compactá: arrastrar el contexto viejo se paga en cada turno.
- **Un hilo, una tarea.** Si la tarea principal terminó, sugerí `/clear`.
- **No leas archivos enteros para revisar una función.** `grep -n` y `sed -n`. Nunca
  `node_modules/` salvo para depurar un error de dependencia real.
- **Antes de abrir un documento largo de `docs/`**, fijate si existe su nota destilada en
  `docs/notas/`.
- **Antes de lanzar un subagente**, evaluá si una edición directa lo resuelve.
- **Si una tarea va a llevar más de 3 turnos**, pará y proponé un plan de 3 puntos.

Buscar en el repo NO requiere preguntar en qué carpeta buscar: usá `git grep` y andá.
Preguntar gasta un turno entero en algo que resolvés con un comando.

## No releer

- Un archivo ya leído en esta sesión sigue en contexto. No lo vuelvas a leer salvo que un
  comando externo lo haya modificado, o que yo diga que cambió.
- Después de Edit/Write NUNCA releas para "verificar": la herramienta habría fallado.
- No leas archivos vecinos "para entender el patrón" de forma preventiva. Grep primero, y
  leé solo el rango con `offset`/`limit`.

## Salida corta

- Sin preámbulos ni cierres. Nada de "voy a...", "perfecto, ahora...", ni resúmenes finales
  salvo que los pida.
- No repitas en el chat código que ya escribiste en un archivo. Referenciá `ruta:linea`.
- No listes "próximos pasos" ni alternativas que no vas a tomar.
- Preguntas y respuestas de una línea se responden en una línea.

## Contenido externo

- WebFetch siempre con un `prompt` estrecho ("extraé solo X"), nunca "resumí la página".
- Nunca `curl` de una URL HTML hacia el contexto. Si usás curl, extraé el campo con `| jq`
  o `| python3 -c` en el mismo pipe.
- Antes de consultar docs externas: `grep -n` en el repo. Si el patrón ya existe acá,
  copialo y no consultes.

## Bash: rutas absolutas, nunca `cd`

Esto no es estilo. Evita un pedido de permiso en CADA comando.

Si tenés reglas `deny` sobre `Read(.env)` o `Read(secrets/**)`, Claude Code tiene que poder
demostrar que un comando de bash no lee una ruta denegada. Con `cd X && grep foo archivo.ts`
no puede: la ruta es relativa y el directorio no se puede determinar, así que se rinde y
pregunta. Con la ruta absoluta lo resuelve solo.

- Ruta absoluta siempre: `grep -n foo /ruta/completa/archivo.ts`.
- Nada de `cd` encadenado con `&&`. Si una herramienta necesita el directorio, pasáselo por
  su bandera: `npm --prefix <ruta>`, `git -C <ruta>`, `find <ruta>`.
- No saques las reglas `deny` para esquivar esto: están para que no se filtre un `.env`.

### Nunca barrer la raíz del proyecto

Mismo motivo, distinta causa: la raíz contiene `.env`. Cualquier comando recursivo que
apunte a la raíz (`grep -r`, `rg`, `find`, `ls -R`) *podría* leerlo, así que Claude Code
pregunta aunque `Bash` esté en `allow` — el chequeo de rutas denegadas gana sobre el allow.
Esto NO se arregla con settings.json.

- Buscar en el repo: `git grep -n <patrón>`. Respeta `.gitignore`, no ve `.env`, y es más
  rápido. Es el default.
- Si hace falta ver archivos no versionados, apuntá a un subdirectorio concreto con ruta
  absoluta, nunca a la raíz.

## Escalera de Tokens

Cada tarea baja hasta la capa más barata que la pueda hacer bien. Solo subís cuando el
resultado importa de verdad. Las capas 0-2 no consumen cuota del plan.

| Capa | Para qué | Con qué |
|------|----------|---------|
| 0 | Documentos largos: PDFs, normativa, docs de proveedores | Se destilan a `docs/notas/` con `destilar-docs`. Nunca pegar un documento entero. |
| 1 | Leer, buscar y verificar | bash: `grep -n`, `sed -n`, `jq`, el typecheck del proyecto. NUNCA leer un archivo completo para revisar una función. |
| 2 | Trabajo mecánico | Skill `cheap-ai` (modelos `:free`): boilerplate, seeds, fixtures, traducciones, resúmenes de logs, commits, changelogs, alt-text, borradores de componentes bien especificados. |
| 3 | Búsqueda amplia y tareas simples | Subagente de exploración (el volcado muere en su contexto), esfuerzo bajo, modelo chico. |
| 4 | Arquitectura, auth, permisos, pagos, debugging ambiguo | Modelo principal, esfuerzo alto, revisión línea por línea. |

Regla de Oro: `cheap-ai` nunca escribe archivos. Todo lo que sube de la capa 2 lo revisa el
modelo principal antes de guardarse, sin excepción.
```

---

## Bloque opcional: corte duro por datos sensibles

Si tu proyecto maneja datos de personas (salud, pagos, legal, RRHH), agregá esto y adaptá
la lista. `cheap-ai` manda el prompt a un servicio externo.

```markdown
**Corte duro para este repo:** `cheap-ai` manda el prompt a OpenRouter, que es un servicio
externo. NUNCA le pases datos de clientes, registros reales, respuestas de APIs de terceros
ni contenido de `.env.local`. Si la tarea mecánica necesita datos reales de ejemplo, inventá
fixtures sintéticos primero.
```

---

## Bloque opcional: auto-blindaje

Convierte cada error en una regla, para que no se vuelva a pagar:

```markdown
## Auto-blindaje

Cada error refuerza el sistema. El mismo error NUNCA ocurre dos veces.

Error ocurre -> se arregla -> se DOCUMENTA -> no vuelve a ocurrir.

| Dónde documentar | Cuándo |
|------------------|--------|
| El plan de la feature actual | Errores específicos de esta feature |
| El skill relevante | Errores que aplican a varias features |
| Este archivo (CLAUDE.md) | Errores críticos que aplican a TODO |
```
