---
name: destilar-docs
description: |
  Capa 0 del ahorro de tokens: convierte los documentos pesados del repo (docs/*.md,
  estudios, normativa, manuales) en notas cortas y accionables dentro de docs/notas/,
  usando modelos GRATIS de OpenRouter via el skill cheap-ai. Despues de correrlo, el
  agente lee la nota de 40 lineas en vez del estudio de 500 y sigue sabiendo lo mismo.
  Reemplaza el trabajo manual de pasar documentacion por NotebookLM: la nota queda en
  el repo, versionada con git, sin depender de ningun servicio externo.
  Usar cuando: se agregan documentos largos al repo, se arranca un proyecto con
  documentacion heredada, o antes de una feature que toca normativa/contabilidad/
  integraciones documentadas. Correrlo tambien despues de editar un documento largo.
  Triggers: destilar docs, destila la documentacion, capa 0, notas de docs,
  resumir documentacion del proyecto, notebooklm, actualizar docs/notas.
  NO USAR para: resumir codigo (para eso se lee el codigo con grep), ni para
  documentos que cambian todos los dias.
user-invocable: true
argument-hint: "[--file docs/x.md] [--min-lines 150] [--force] [--dry-run]"
allowed-tools: Read, Bash
---

# Destilar Docs (Capa 0)

> El material pesado no entra al contexto. Entra su nota.

## Que hace

1. Busca los `.md` de `docs/` y de la raiz con **150 lineas o mas** (configurable).
2. Le manda cada uno a un modelo gratis de OpenRouter con 5 preguntas fijas.
3. Escribe `docs/notas/<slug>.md` con la respuesta y un encabezado que dice de que
   documento salio, cuantas lineas tenia y con que modelo se hizo.
4. Guarda el hash de cada fuente en `docs/notas/.destilado.json`. La proxima corrida
   salta lo que no cambio y re-destila solo lo que editaste.

Costo: **US$0**. Usa los modelos `:free` del catalogo de OpenRouter via `cheap-ai`,
que ya tiene su propio tope de gasto semanal.

## Como se corre

```bash
npx tsx .claude/skills/destilar-docs/scripts/destilar.ts             # todo lo pendiente
npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --dry-run   # solo lista que haria
npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --file docs/normativa.md
npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --min-lines 80
npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --force     # re-destila todo
```

## Las 5 preguntas

Son fijas a proposito, para que todas las notas tengan la misma forma y el agente sepa
donde mirar:

| Seccion | Para que sirve |
|---------|----------------|
| Lo esencial | 15 bullets implementables, sin contexto de negocio |
| Obligatorio | campos, codigos y formatos con nombre exacto y tipo |
| Validaciones | reglas y consecuencia de incumplirlas |
| Contradicciones | donde el documento se pelea consigo mismo |
| Lo que NO cubre | el hueco que hay que confirmar por fuera |

Las dos ultimas son las que mas valen: son las que evitan que una sesion de vueltas
por documentacion que se contradice.

## Reglas

- **La nota nunca reemplaza al original.** El documento fuente se queda donde esta. La
  nota es una puerta de entrada; si no alcanza, se abre el original con `grep -n`.
- **Nunca destilar `CLAUDE.md`, `AGENTS.md`, `README.md` ni changelogs.** Son
  instrucciones del agente, no material de consulta. El script ya los excluye.
- **Revisar antes de confiar.** El modelo es gratis, no infalible. Si la nota va a guiar
  algo sensible (facturacion, normativa fiscal, auth), contrastala con el original antes
  de implementar. Regla de Oro de `cheap-ai`: lo barato genera, el modelo principal revisa.
- **Documentos que cambian a diario no se destilan.** El hash se invalida todo el tiempo
  y la nota nunca esta al dia.

## Requisitos

- Skill `cheap-ai` instalado en `.claude/skills/cheap-ai/`.
- `OPENROUTER_CHEAP_API_KEY` (o `OPENROUTER_API_KEY`) en el `.env.local` del proyecto.

## Relacion con NotebookLM

Este skill hace lo mismo que hacias a mano en NotebookLM, sin navegador ni cuenta de
Google. Lo unico que NotebookLM hace y esto no: leer PDFs escaneados y videos. Para eso
seguis usando el cuaderno y pegas la respuesta en `docs/notas/` con la misma plantilla.
