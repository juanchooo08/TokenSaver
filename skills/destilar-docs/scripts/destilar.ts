/**
 * destilar.ts -- Capa 0 automatica.
 *
 * Convierte los documentos pesados del repo (docs/*.md, estudios, normativa) en notas
 * cortas y accionables dentro de docs/notas/, usando modelos GRATIS de OpenRouter via
 * el skill cheap-ai. El objetivo no es "resumir bonito": es que el agente lea 40 lineas
 * en vez de 500 y siga sabiendo lo mismo que necesita para implementar.
 *
 * NO habla con NotebookLM ni con ningun servicio de Google. La nota vive en el repo,
 * versionada con git, y la lee Claude (regla "Capa 0 en la practica" del CLAUDE.md).
 *
 * Uso:
 *   npx tsx .claude/skills/destilar-docs/scripts/destilar.ts              # todo lo pendiente
 *   npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --file docs/x.md
 *   npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --min-lines 80
 *   npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --force      # re-destila todo
 *   npx tsx .claude/skills/destilar-docs/scripts/destilar.ts --dry-run    # solo lista
 *
 * Idempotente: guarda el hash de cada fuente en docs/notas/.destilado.json y salta las
 * que no cambiaron. Editaste el documento? La proxima corrida lo vuelve a destilar solo.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

const SCRIPT_DIR = path.dirname(path.resolve(process.argv[1] || "."));

// La raiz NO se asume como "cuatro niveles arriba del script": si alguien mueve el skill
// de carpeta, esa cuenta se rompe en silencio y el script termina escribiendo notas en el
// lugar equivocado. Se sube desde el script buscando la marca real de un repo (.git o
// package.json) y, si no aparece, se cae al cwd -- que es donde el usuario lo invoco.
function findProjectRoot(desde: string): string {
  let dir = desde;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "package.json"))) return dir;
    const padre = path.dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  return process.cwd();
}

const ROOT = findProjectRoot(SCRIPT_DIR);
const NOTAS_DIR = path.join(ROOT, "docs", "notas");
const STATE_FILE = path.join(NOTAS_DIR, ".destilado.json");
const CHEAP_AI = path.join(ROOT, ".claude", "skills", "cheap-ai", "scripts", "openrouter-call.ts");

// Archivos que nunca se destilan: son instrucciones del agente o indices, no material
// de consulta. Destilarlos seria destilar las reglas que el agente ya tiene que leer.
const EXCLUDED = new Set(["CLAUDE.md", "GEMINI.md", "AGENTS.md", "README.md", "SAAS-FACTORY.md", "CHANGELOG.md"]);

// Carpetas que nunca se destilan aunque tengan .md largos:
//  - i18n/: traducciones. Duplican el doc original palabra por palabra; destilarlas es
//    pagar (en tiempo y cuota) dos veces por la misma informacion.
//  - sessions/, archive/, changelog/: registros efimeros o historicos. La nota envejece
//    mal y nadie implementa a partir de ellos.
const EXCLUDED_DIRS = ["i18n", "sessions", "archive", "changelog", "vendor", "dist", "build"];


const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const MIN_LINES = Number(getArg("min-lines") || 150);
const FORCE = hasFlag("force");
const DRY = hasFlag("dry-run");

type Estado = Record<string, { hash: string; nota: string; fecha: string; modelo?: string }>;
type JobResult = { id: string; ok: boolean; content?: string; model?: string; costUSD?: number; error?: string };

const SYSTEM = [
  "Sos un destilador tecnico. Recibis documentacion larga y devolves una nota corta que",
  "otro desarrollador usa para implementar sin abrir el original. Nada de introducciones,",
  "nada de 'este documento explica'. Solo hechos accionables, en el idioma del documento.",
  "Si el documento no dice algo, no lo inventes: escribi 'no lo cubre'.",
].join(" ");

const PREGUNTAS = `Respondé estas 5 secciones, con estos titulos exactos y en este orden:

## Lo esencial
Máximo 15 bullets con lo que hay que saber para implementar esto. Sin contexto de negocio.

## Obligatorio (campos / formatos / codigos)
Los campos, codigos, formatos o parametros obligatorios, con su nombre exacto y su tipo.
Si no aplica, escribi "no aplica".

## Validaciones y que pasa si fallan
Reglas de validacion y la consecuencia de incumplirlas. Si no aplica, escribi "no aplica".

## Contradicciones
Lo que se contradice dentro del documento. Si no hay, escribi "ninguna detectada".

## Lo que NO cubre
Lo que quedo afuera y habria que confirmar por fuera.`;

function slug(rel: string): string {
  return rel
    .replace(/^docs\//, "")
    .replace(/\.md$/i, "")
    .replace(/[\/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase();
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "notas") continue;
    if (e.isDirectory() && EXCLUDED_DIRS.includes(e.name.toLowerCase())) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function candidatos(): string[] {
  const uno = getArg("file");
  if (uno) return [path.resolve(ROOT, uno)];
  const raiz = fs.existsSync(ROOT)
    ? fs.readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith(".md") && !EXCLUDED.has(f)).map((f) => path.join(ROOT, f))
    : [];
  return [...walk(path.join(ROOT, "docs")), ...raiz].filter((f) => !EXCLUDED.has(path.basename(f)));
}

function leerEstado(): Estado {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Estado;
  } catch {
    return {};
  }
}

function main(): void {
  if (!fs.existsSync(CHEAP_AI)) {
    console.error("ERROR: falta el skill cheap-ai en .claude/skills/cheap-ai/. Este script delega ahi.");
    process.exit(1);
  }
  fs.mkdirSync(NOTAS_DIR, { recursive: true });
  const estado = leerEstado();

  const pendientes = candidatos()
    .map((abs) => {
      const rel = path.relative(ROOT, abs);
      const texto = fs.readFileSync(abs, "utf-8");
      const lineas = texto.split("\n").length;
      const hash = crypto.createHash("sha256").update(texto).digest("hex").slice(0, 16);
      return { abs, rel, texto, lineas, hash };
    })
    .filter((d) => d.lineas >= MIN_LINES)
    .filter((d) => FORCE || estado[d.rel]?.hash !== d.hash);

  if (pendientes.length === 0) {
    console.log(`Nada que destilar (minimo ${MIN_LINES} lineas, todo lo demas ya esta al dia).`);
    return;
  }

  console.log(`Documentos a destilar (>= ${MIN_LINES} lineas):`);
  for (const d of pendientes) console.log(`  ${String(d.lineas).padStart(5)} lineas  ${d.rel}`);
  if (DRY) return;

  const jobs = pendientes.map((d) => ({
    id: slug(d.rel),
    category: "summarize",
    system: SYSTEM,
    prompt: `${PREGUNTAS}\n\n--- DOCUMENTO: ${d.rel} ---\n${d.texto}`,
  }));

  const tmp = path.join(NOTAS_DIR, ".jobs.tmp.json");
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  let salida = "";
  try {
    salida = execFileSync("npx", ["-y", "tsx", CHEAP_AI, "--batch", tmp], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (e) {
    const err = e as { stdout?: string };
    salida = err.stdout || "";
    if (!salida.trim()) {
      console.error("ERROR: cheap-ai no devolvio nada. Revisa la key de OpenRouter en .env.local.");
      process.exit(1);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  let resultados: JobResult[] = [];
  try {
    resultados = JSON.parse(salida) as JobResult[];
  } catch {
    console.error("ERROR: no se pudo leer la respuesta de cheap-ai.");
    process.exit(1);
  }

  const hoy = new Date().toISOString().slice(0, 10);
  let ok = 0;
  for (const d of pendientes) {
    const r = resultados.find((x) => x.id === slug(d.rel));
    if (!r || !r.ok || !r.content) {
      console.error(`  FALLO  ${d.rel}: ${r?.error || "sin respuesta"}`);
      continue;
    }
    const nota = path.join(NOTAS_DIR, `${slug(d.rel)}.md`);
    const encabezado = [
      `# ${path.basename(d.rel, ".md").replace(/[-_]/g, " ")}`,
      "",
      `> Nota destilada de \`${d.rel}\` (${d.lineas} lineas) · ${hoy} · modelo: ${r.model || "?"}`,
      "> Generada por \`/destilar-docs\`. Si el original cambia, volve a correrlo y esta nota se regenera.",
      "",
      "",
    ].join("\n");
    fs.writeFileSync(nota, encabezado + r.content.trim() + "\n");
    const lineasNota = (encabezado + r.content).split("\n").length;
    estado[d.rel] = { hash: d.hash, nota: path.relative(ROOT, nota), fecha: hoy, modelo: r.model };
    console.log(`  OK     ${d.rel} (${d.lineas}) -> ${path.relative(ROOT, nota)} (${lineasNota})`);
    ok++;
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(estado, null, 2));
  // El costo NO siempre es 0: si los modelos gratis estan caidos o rate-limited, cheap-ai
  // cae a un fallback pago barato. Informar "US$0" a ciegas oculta gasto real, asi que se
  // suma lo que cada job reporto.
  const costo = resultados.reduce((t, r) => t + (r.costUSD || 0), 0);
  const pagos = resultados.filter((r) => (r.costUSD || 0) > 0).length;
  const detalle = costo > 0 ? `US$${costo.toFixed(4)} (${pagos} via fallback pago, el resto gratis)` : "US$0 (todo con modelos :free)";
  console.log(`\n${ok}/${pendientes.length} notas escritas en docs/notas/. Costo: ${detalle}`);
}

main();
