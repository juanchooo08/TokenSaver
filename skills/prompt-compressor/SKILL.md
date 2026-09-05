---
name: prompt-compressor
description: |
  Comprime un borrador de prompt largo/conversacional a un formato ultra-conciso, manteniendo
  la intencion tecnica, ANTES de que el usuario lo mande como su pedido real. Invocacion
  SIEMPRE MANUAL: el usuario escribe /prompt-compressor "su borrador largo" como un paso
  previo y separado, revisa el resultado, y lo pega como su proximo mensaje real. No se
  activa solo ni intercepta mensajes -- Claude Code no permite reescribir en silencio un
  prompt antes de procesarlo, asi que este skill es una herramienta de pre-edicion consciente,
  no un filtro automatico.
user-invocable: true
argument-hint: "\"tu borrador de prompt largo aca\""
allowed-tools: Bash
---

# Prompt Compressor

> Herramienta de pre-edicion MANUAL. El usuario la corre a proposito, con el borrador que
> piensa mandar despues, para no gastar tokens del modelo principal escribiendo/leyendo un
> prompt mas largo de lo necesario. No reemplaza ni intercepta el mensaje real del usuario.

---

## Como Funciona

1. El texto a comprimir es `$ARGUMENTS` (el borrador completo que el usuario paso al
   invocar `/prompt-compressor "..."`).
2. **Delegar la compresion, no hacerla vos mismo:** si el proyecto actual tiene
   `.claude/skills/cheap-ai/scripts/openrouter-call.ts`, usalo (categoria `summarize`,
   modelo gratis) para no gastar tus propios tokens comprimiendo texto -- es exactamente el
   tipo de tarea mecanica que ese skill existe para delegar:
   ```bash
   npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts \
     --category summarize \
     --system "Sos un compresor de prompts tecnicos. Recibis una instruccion larga o conversacional en español y la devolves en formato ultra-conciso: elimina muletillas y repeticiones, mantene TODOS los terminos tecnicos y requisitos concretos (nombres, paths, flags, numeros), y converti parrafos en listas de pasos directos e imperativos. No agregues informacion que no estaba. No pidas confirmacion ni agregues comentarios fuera del prompt comprimido." \
     --prompt "$ARGUMENTS"
   ```
3. Si el proyecto actual NO tiene `cheap-ai` instalado, comprimilo vos mismo (Claude) con el
   mismo criterio del system prompt de arriba -- no hay fallback de red, pero el resultado
   igual debe seguir el formato de salida de abajo.
4. Nunca pidas confirmacion -- entrega el resultado directo, siempre con las 3 secciones.

---

## Formato de Salida (obligatorio, siempre las 3 secciones)

```
1. Prompt optimizado:
<el prompt comprimido, listo para usar>

2. Ahorro estimado de tokens:
Original: ~N palabras (~N*1.3 tokens) -> Comprimido: ~M palabras (~M*1.3 tokens) -> ~X% menos

3. Bloque de texto listo para copiar:
```
<el mismo prompt comprimido de la seccion 1, en un code block aparte para copiar directo>
```
```

- El calculo de tokens es una estimacion (palabras * 1.3), no un conteo exacto -- decilo asi,
  no lo presentes como precision real.
- Si `cheap-ai` fallo o no devolvio nada usable (`ok: false`), avisalo brevemente y comprimi
  vos mismo en vez de bloquear al usuario.

---

## Limite (por que esto es manual, no automatico)

Claude Code no tiene un mecanismo para interceptar y reescribir el mensaje del usuario ANTES
de que el modelo principal lo procese -- los hooks (`UserPromptSubmit`) pueden agregar
contexto o bloquear el envio, pero no sustituir en silencio el texto ya enviado por una
version comprimida. Por eso este skill es un paso previo consciente: el usuario lo corre,
revisa el resultado, y RECIEN AHI manda su pedido real (comprimido) como mensaje aparte.

Ademas, el texto que escribe el usuario suele ser una fraccion minima del gasto de tokens de
una sesion real -- lo que mas pesa es el contexto de archivos leidos, outputs de herramientas,
y el historial de conversacion. Para eso, usar `.claudeignore`, delegar tareas mecanicas a
`cheap-ai`, y correr `/compact` cada tantos turnos (ver `CLAUDE.md`) tiene mucho mas impacto
que comprimir el prompt de entrada.

---

## Ejemplo

```
Usuario: /prompt-compressor "che necesito que me ayudes a armar como que un formulario de contacto
pero que tenga validacion y que cuando se mande se guarde en supabase y tambien capaz que
mande un email de confirmacion, no se si eso ultimo es mucho pedir pero bueno dale intentalo"

Resultado:
1. Prompt optimizado:
Crea formulario de contacto con: (1) validacion de campos, (2) guardado en Supabase al
enviar, (3) email de confirmacion al usuario tras el envio.

2. Ahorro estimado de tokens:
Original: ~55 palabras (~72 tokens) -> Comprimido: ~20 palabras (~26 tokens) -> ~64% menos

3. Bloque de texto listo para copiar:
```
Crea formulario de contacto con: (1) validacion de campos, (2) guardado en Supabase al
enviar, (3) email de confirmacion al usuario tras el envio.
```
```
