#!/usr/bin/env npx tsx
/**
 * Delega una o varias tareas a modelos gratis/baratos de OpenRouter, con tope de
 * gasto semanal (default $1) compartido entre todos los proyectos de esta maquina.
 *
 * Orden de intento por tarea: modelos gratis de la categoria (":free") -> si todos
 * fallan y queda presupuesto, modelos pagos baratos (fallback) -> si no queda
 * presupuesto, error (el modelo principal debe hacer la tarea el mismo).
 *
 * Modo simple (una tarea):
 *   npx tsx openrouter-call.ts --prompt "texto" [--system "..."] [--category code] [--file input.txt]
 *
 * Modo batch (N tareas EN PARALELO real, cada una con su propia categoria):
 *   npx tsx openrouter-call.ts --batch jobs.json
 *   jobs.json = [{ "id": "job1", "prompt": "...", "system": "...", "category": "translation" }, ...]
 *   Imprime a stdout un JSON array: [{ id, ok, content, model, costUSD, error }]
 *
 * Categorias: translation | code | implement | summarize | reasoning | auto | assist
 *   (assist = ayuda con auth/RLS/seguridad/arquitectura/debugging complejo -- SIEMPRE
 *    usa el modelo fijo de scripts/models.json, nunca auto-ruteo gratis, y su output
 *    es un borrador/segunda opinion, no la decision final)
 *
 * Cada llamada (simple o batch) deja un renglon en ~/.claude/openrouter-usage-log.jsonl
 * para poder medir cuantas tareas se estan delegando de verdad.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

// Compat CJS/ESM: en proyectos con "type": "module" en package.json, tsx corre este
// archivo como ESM y SCRIPT_DIR no existe (ReferenceError antes de leer nada). argv[1]
// es la ruta de este script en ambos modos, asi que de ahi sale el directorio.
const SCRIPT_DIR = path.dirname(path.resolve(process.argv[1] || "."));

// `npx tsx` no carga .env.local solo (a diferencia de Next.js) -- sin esto, el script
// SIEMPRE fallaba con "falta OPENROUTER_CHEAP_API_KEY" porque nada exportaba la variable
// al entorno antes de leer process.env. Busca .env.local en la raiz del proyecto (relativo
// a la ubicacion fija de este script: scripts/ -> cheap-ai/ -> skills/ -> .claude/ -> raiz)
// y, si no esta ahi, en el cwd desde donde se invoco. No pisa variables ya exportadas.
// Raiz del proyecto relativa a la ubicacion fija de este script (scripts/ -> cheap-ai/ ->
// skills/ -> .claude/ -> raiz), con fallback al cwd -- mismo criterio que loadEnvLocal, pero
// devuelve el path en vez de leer un archivo especifico (lo usan logDelegatedTask y otros).
function findProjectRoot(): string {
  const fixed = path.join(SCRIPT_DIR, "..", "..", "..", "..");
  return fs.existsSync(path.join(fixed, ".git")) || fs.existsSync(path.join(fixed, "package.json")) ? fixed : process.cwd();
}

// Orden de busqueda, de mas especifico a mas general. El .env.local del proyecto gana
// (permite que un proyecto use otra cuenta o su propio tope), y ~/.claude/cheap-ai.env
// es el default de la maquina: gracias a el, un proyecto RECIEN CREADO que todavia no
// tiene .env.local ya puede usar cheap-ai sin configurar nada.
function envCandidates(): string[] {
  return [
    path.join(SCRIPT_DIR, "..", "..", "..", "..", ".env.local"),
    path.join(process.cwd(), ".env.local"),
    path.join(os.homedir(), ".claude", "cheap-ai.env"),
  ];
}

function loadEnvLocal() {
  // NO corta en el primero que encuentre: recorre todos y solo completa lo que falta,
  // asi el archivo global aporta las variables que el .env.local del proyecto no define
  // (tipicamente el tope de gasto) sin pisar las que si define.
  for (const file of envCandidates()) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
loadEnvLocal();

// Ultimo recurso para la key: el archivo plano ~/.claude/secrets/openrouter (permisos 600).
// Es la misma fuente que usan otros scripts de la maquina, asi la key vive en UN solo lugar
// y rotarla no obliga a editar el .env.local de cada proyecto.
function loadGlobalKey() {
  // Solo se respeta OPENROUTER_CHEAP_API_KEY (la variable dedicada). Un OPENROUTER_API_KEY
  // generico del proyecto NO bloquea este fallback: varios .env.local arrastran keys viejas
  // y muertas con ese nombre, y darlas por buenas hacia fallar el skill entero con un error
  // enganoso ("todos los modelos fallaron") en vez de usar la key global que si sirve.
  if (process.env.OPENROUTER_CHEAP_API_KEY) return;
  const file = path.join(os.homedir(), ".claude", "secrets", "openrouter");
  if (!fs.existsSync(file)) return;
  const key = fs.readFileSync(file, "utf-8").trim();
  if (key) process.env.OPENROUTER_CHEAP_API_KEY = key;
}
loadGlobalKey();

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const API_KEY = process.env.OPENROUTER_CHEAP_API_KEY || process.env.OPENROUTER_API_KEY;
const WEEKLY_CAP_USD = Number(process.env.OPENROUTER_CHEAP_WEEKLY_CAP_USD || 1);
const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const BUDGET_FILE = path.join(CLAUDE_HOME, "openrouter-budget.json");
const MODELS_CACHE_FILE = path.join(CLAUDE_HOME, "openrouter-models-cache.json");
const USAGE_LOG_FILE = path.join(CLAUDE_HOME, "openrouter-usage-log.jsonl");
const CONFIG_FILE = path.join(SCRIPT_DIR, "models.json");

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

type Job = { id: string; prompt: string; system?: string; category?: string };
type JobResult = { id: string; ok: boolean; content?: string; model?: string; costUSD?: number; error?: string };
type RouteConfig = {
  paidProviderKeywords: string[];
  codeCategoryKeywords: string[];
  codeLikeCategories: string[];
  maxFreeAttempts: number;
  maxPaidFallbackAttempts: number;
  modelsCacheTTLHours: number;
  pinnedModels: Record<string, string | string[]>;
  maxPaidCompletionPricePerM: number;
  maxConcurrentJobs: number;
  forbiddenPathPatterns: string[];
};
type OpenRouterModel = {
  id: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  benchmarks?: { artificial_analysis?: { intelligence_index?: number | null; coding_index?: number | null } };
};
type ModelsCache = { fetchedAt: string; models: OpenRouterModel[] };
type Budget = { weekStart: string; spentUSD: number; capUSD: number };

function loadRouteConfig(): RouteConfig {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
}

// Criterio de Interrupcion (deadman switch): auth/RLS/migraciones son criterio de
// arquitecto, no trabajo mecanico -- ni siquiera como borrador de `assist`. Si el
// prompt/system/archivo de entrada de la tarea menciona una de estas rutas, el script
// se niega a correrla en vez de dejar que un modelo barato la toque por error.
function touchesForbiddenPath(text: string, config: RouteConfig): string | null {
  const lower = text.toLowerCase();
  for (const pattern of config.forbiddenPathPatterns) {
    if (lower.includes(pattern.toLowerCase())) return pattern;
  }
  return null;
}

// Extrae el primer bloque de codigo con fence (```lang\n...\n```) de una respuesta en
// markdown. Si el modelo no devolvio ningun fence, no hay nada que typechequear.
function extractCodeBlock(content: string): { lang: string; code: string } | null {
  const match = content.match(/```(\w+)?\r?\n([\s\S]*?)```/);
  if (!match) return null;
  return { lang: (match[1] || "").toLowerCase(), code: match[2] };
}

const TS_LIKE_EXT: Record<string, string> = {
  ts: ".ts",
  typescript: ".ts",
  tsx: ".tsx",
  js: ".js",
  javascript: ".js",
  jsx: ".jsx",
};

// Busca el binario en node_modules/.bin del proyecto en vez de `npx tsc` -- npx puede
// intentar descargar el paquete si no esta instalado, lo que es lento y hace red sin que
// lo pidamos. Si el proyecto no tiene tsc instalado, no hay typecheck posible: se salta
// la validacion en vez de fallar la tarea por una herramienta que no existe.
function findLocalBin(name: string): string | null {
  const binName = process.platform === "win32" ? `${name}.cmd` : name;
  const candidate = path.join(process.cwd(), "node_modules", ".bin", binName);
  return fs.existsSync(candidate) ? candidate : null;
}

type ValidationResult = { ok: boolean; skipped: boolean; details?: string };

// Fase de "Validation-as-a-Service": si la categoria es code-like y el modelo devolvio
// un bloque de codigo TS/JS, lo tipeamos con el `tsc` local del proyecto ANTES de
// mostrarle el resultado al modelo principal. Un error de sintaxis/tipos hace que este
// intento cuente como fallido y el caller (runJob) prueba el siguiente modelo -- asi
// nunca se pierde tiempo revisando a mano un borrador que ni compila.
function validateCodeOutput(content: string, category: string, config: RouteConfig): ValidationResult {
  if (!config.codeLikeCategories.includes(category)) return { ok: true, skipped: true };
  const block = extractCodeBlock(content);
  const ext = block ? TS_LIKE_EXT[block.lang] : undefined;
  if (!block || !ext) return { ok: true, skipped: true }; // sin bloque TS/JS reconocible, nada que validar

  const tscBin = findLocalBin("tsc");
  if (!tscBin) return { ok: true, skipped: true };

  const tmpFile = path.join(os.tmpdir(), `cheap-ai-validate-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tmpFile, block.code);
  try {
    execFileSync(
      tscBin,
      ["--noEmit", "--skipLibCheck", "--allowJs", "--jsx", "react-jsx", "--moduleResolution", "bundler", "--esModuleInterop", tmpFile],
      { stdio: "pipe", timeout: 30_000 }
    );
    return { ok: true, skipped: false };
  } catch (err: any) {
    const details = (err.stdout?.toString() || err.stderr?.toString() || err.message || "").slice(0, 2000);
    return { ok: false, skipped: false, details };
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

// Rastro local de que se delego (vs se escribio a mano) -- vive en el repo, no en
// ~/.claude, para que cualquiera que abra el proyecto (incluido el propio Claude en 3
// dias) sepa que tareas paso por un modelo barato y con que prompt/modelo exacto.
function logDelegatedTask(job: Job, result: JobResult) {
  if (!result.ok) return; // solo interesa lo que efectivamente se delego, no los intentos fallidos
  const memoryDir = path.join(findProjectRoot(), ".claude", "memory");
  const file = path.join(memoryDir, "DELEGATED_TASKS.md");
  const promptPreview = job.prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  const line = `- ${new Date().toISOString()} | id=${job.id} | category=${job.category || "auto"} | model=${result.model} | cost=$${(result.costUSD || 0).toFixed(4)} | prompt: "${promptPreview}${job.prompt.length > 80 ? "..." : ""}"\n`;
  fs.mkdirSync(memoryDir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      "# Delegated Tasks\n\nHistorial de tareas delegadas a modelos baratos via cheap-ai. Generado automaticamente -- no editar a mano.\n\n"
    );
  }
  fs.appendFileSync(file, line);
}

function isTextModel(m: OpenRouterModel): boolean {
  const inputs = m.architecture?.input_modalities || [];
  const outputs = m.architecture?.output_modalities || [];
  return inputs.includes("text") && outputs.includes("text");
}

async function fetchModelCatalog(): Promise<OpenRouterModel[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`No se pudo listar modelos de OpenRouter: ${res.status}`);
  const data = (await res.json()) as { data: OpenRouterModel[] };
  return data.data;
}

async function loadModelCatalog(ttlHours: number): Promise<OpenRouterModel[]> {
  if (fs.existsSync(MODELS_CACHE_FILE)) {
    const cache: ModelsCache = JSON.parse(fs.readFileSync(MODELS_CACHE_FILE, "utf-8"));
    const ageHours = (Date.now() - new Date(cache.fetchedAt).getTime()) / 3_600_000;
    if (ageHours < ttlHours) return cache.models;
  }
  const models = await fetchModelCatalog();
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  fs.writeFileSync(MODELS_CACHE_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), models }, null, 2));
  return models;
}

// Ranquea por calidad real (benchmarks de Artificial Analysis que expone OpenRouter),
// NO por tamano de contexto -- una ventana grande no implica que el modelo razone bien
// o escriba codigo correcto. Si un modelo no tiene benchmark (muchos modelos free no lo
// tienen todavia), cae al final en vez de competir a ciegas contra los que si lo tienen.
function modelQualityScore(m: OpenRouterModel, category: string, config: RouteConfig): number {
  const isCodeLike = config.codeLikeCategories.includes(category);
  const b = m.benchmarks?.artificial_analysis;
  const raw = isCodeLike ? b?.coding_index : b?.intelligence_index;
  let score = typeof raw === "number" ? raw : -1;
  if (isCodeLike && config.codeCategoryKeywords.some((k) => m.id.toLowerCase().includes(k))) {
    score += 5; // pequeno empujon a especialistas de codigo por nombre, aunque falte el benchmark
  }
  return score;
}

function pickFreeModels(catalog: OpenRouterModel[], category: string, config: RouteConfig): string[] {
  const free = catalog.filter((m) => m.id.endsWith(":free") && isTextModel(m));
  return free
    .sort(
      (a, b) =>
        modelQualityScore(b, category, config) - modelQualityScore(a, category, config) ||
        (b.context_length || 0) - (a.context_length || 0)
    )
    .slice(0, config.maxFreeAttempts)
    .map((m) => m.id);
}

function pickPaidFallback(catalog: OpenRouterModel[], category: string, config: RouteConfig): OpenRouterModel[] {
  // El techo de precio es DURO y se aplica antes que la calidad: con un tope semanal de
  // centavos, un modelo "mejor" a $3/M vacia el presupuesto en tres llamadas. Los :batch
  // y :online se excluyen porque no responden a una llamada sincrona normal.
  const maxOut = config.maxPaidCompletionPricePerM / 1e6;
  const candidates = catalog.filter(
    (m) =>
      !m.id.endsWith(":free") &&
      !m.id.includes(":batch") &&
      !m.id.includes(":online") &&
      isTextModel(m) &&
      parseFloat(m.pricing?.completion || "0") > 0 &&
      parseFloat(m.pricing?.completion || "0") <= maxOut &&
      config.paidProviderKeywords.some((k) => m.id.toLowerCase().includes(k))
  );
  // Primero la escalera fijada a mano en models.json (pinnedModels.paidFallback), en su
  // orden: de menos a mas caro. Es una preferencia, no una atadura -- un modelo que ya no
  // existe en el catalogo, o que subio de precio por encima del techo, simplemente no esta
  // entre los candidatos y se saltea solo.
  const fijados = ([] as string[])
    .concat(config.pinnedModels?.paidFallback || [])
    .map((id) => candidates.find((m) => m.id === id))
    .filter((m): m is OpenRouterModel => Boolean(m));

  // El resto se completa con la seleccion automatica por benchmark, que es lo que cubre el
  // hueco cuando la escalera queda corta (los modelos baratos rotan seguido).
  const resto = candidates
    .filter((m) => !fijados.some((f) => f.id === m.id))
    .sort((a, b) => {
      const scoreDiff = modelQualityScore(b, category, config) - modelQualityScore(a, category, config);
      if (scoreDiff !== 0) return scoreDiff;
      return parseFloat(a.pricing?.prompt || "0") - parseFloat(b.pricing?.prompt || "0");
    });

  return [...fijados, ...resto].slice(0, config.maxPaidFallbackAttempts);
}

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function loadBudget(): Budget {
  const thisMonday = mondayOf(new Date());
  if (!fs.existsSync(BUDGET_FILE)) {
    return { weekStart: thisMonday, spentUSD: 0, capUSD: WEEKLY_CAP_USD };
  }
  const budget: Budget = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf-8"));
  if (budget.weekStart !== thisMonday) {
    return { weekStart: thisMonday, spentUSD: 0, capUSD: WEEKLY_CAP_USD };
  }
  return { ...budget, capUSD: WEEKLY_CAP_USD };
}

function saveBudget(budget: Budget) {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2));
}

function logUsage(job: Job, result: JobResult) {
  const line = {
    ts: new Date().toISOString(),
    project: path.basename(process.cwd()),
    id: job.id,
    category: job.category || "auto",
    ok: result.ok,
    model: result.model,
    costUSD: result.costUSD || 0,
  };
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  fs.appendFileSync(USAGE_LOG_FILE, JSON.stringify(line) + "\n");
}

async function callModel(model: string, prompt: string, system: string | undefined) {
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter respondio ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Sin contenido en la respuesta: ${JSON.stringify(data)}`);
  return { content, model: data.model || model, usage: data.usage };
}

async function callPaidAndTrackCost(
  model: OpenRouterModel,
  job: Job,
  budget: Budget
): Promise<{ content: string; realModel: string; costUSD: number }> {
  const { content, model: realModel, usage } = await callModel(model.id, job.prompt, job.system);
  const promptPrice = parseFloat(model.pricing?.prompt || "0");
  const completionPrice = parseFloat(model.pricing?.completion || "0");
  const costUSD = (usage?.prompt_tokens || 0) * promptPrice + (usage?.completion_tokens || 0) * completionPrice;
  budget.spentUSD += costUSD;
  return { content, realModel, costUSD };
}

// Categoria "assist": IA barata como asistente en tareas sensibles (auth, RLS, seguridad,
// arquitectura, debugging complejo) -- ayuda con borradores/segundas opiniones, pero la
// decision final y el codigo que se aplica siempre los reviso yo (Claude). Por eso usa un
// modelo FIJO elegido a mano (calidad > auto-ruteo gratis) en vez de competir por el mas barato.
async function runAssistJob(job: Job, catalog: OpenRouterModel[], config: RouteConfig, budget: Budget): Promise<JobResult> {
  const pinnedIds = ([] as string[]).concat(config.pinnedModels.assist || []);
  const pinned = pinnedIds.map((id) => catalog.find((m) => m.id === id)).filter(Boolean) as OpenRouterModel[];
  if (pinned.length === 0) {
    return { id: job.id, ok: false, error: `Ningun modelo fijo para 'assist' (${pinnedIds.join(", ")}) esta disponible en OpenRouter ahora mismo.` };
  }
  if (budget.spentUSD >= budget.capUSD) {
    return {
      id: job.id,
      ok: false,
      error: `Presupuesto semanal (US$${budget.capUSD}) agotado -- no se puede usar el asistente de tareas sensibles. Hazlo tu mismo.`,
    };
  }
  // Se prueban en orden: el primero es la variante :free del mismo modelo (mismos pesos,
  // US$0). El pago solo entra si el gratis esta caido o rate-limited.
  let ultimoError = "";
  for (const modelo of pinned) {
    try {
      const { content, realModel, costUSD } = await callPaidAndTrackCost(modelo, job, budget);
      return { id: job.id, ok: true, content, model: realModel, costUSD };
    } catch (err) {
      ultimoError = err instanceof Error ? err.message : String(err);
    }
  }
  return { id: job.id, ok: false, error: `Todos los modelos de 'assist' fallaron. Ultimo error: ${ultimoError}` };
}

type Variant = { model: string; content?: string; ok: boolean; error?: string };

// Consulta varios modelos gratis EN PARALELO sobre la MISMA tarea, en vez de probar uno
// y quedarse con el primero que responda. Util para tareas donde la calidad importa
// (ej. `implement`) y queres comparar/elegir el mejor borrador en vez de confiar a ciegas
// en uno solo -- sigue costando $0 porque son todos modelos ":free".
async function runVariants(job: Job, catalog: OpenRouterModel[], config: RouteConfig, n: number): Promise<Variant[]> {
  const category = job.category || "auto";
  const models = pickFreeModels(catalog, category, config).slice(0, n);
  const settled = await Promise.allSettled(models.map((m) => callModel(m, job.prompt, job.system)));
  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? { model: r.value.model, content: r.value.content, ok: true }
      : { model: models[i], ok: false, error: r.reason?.message || String(r.reason) }
  );
}

async function runJob(job: Job, catalog: OpenRouterModel[], config: RouteConfig, budget: Budget): Promise<JobResult> {
  const category = job.category || "auto";

  // Criterio de Interrupcion: auth/RLS/migraciones son criterio de arquitecto. Se
  // bloquea ANTES de gastar una sola llamada, salvo en `assist` (que es la via
  // sancionada para pedir ayuda/segunda opinion en esas areas, nunca para aplicar codigo).
  if (category !== "assist") {
    const hit = touchesForbiddenPath(`${job.prompt}\n${job.system || ""}`, config);
    if (hit) {
      return {
        id: job.id,
        ok: false,
        error: `Error: Esta tarea requiere criterio de arquitecto. Ejecuta con Claude Code local. (ruta protegida detectada: "${hit}")`,
      };
    }
  }

  if (category === "assist") {
    return runAssistJob(job, catalog, config, budget);
  }

  const freeModels = pickFreeModels(catalog, category, config);

  for (const model of freeModels) {
    try {
      const { content, model: realModel } = await callModel(model, job.prompt, job.system);
      const validation = validateCodeOutput(content, category, config);
      if (!validation.ok) {
        console.error(`[openrouter] ${model} devolvio codigo que no pasa el typecheck -- reintentando con otro modelo. Detalle: ${validation.details?.slice(0, 300)}`);
        continue;
      }
      return { id: job.id, ok: true, content, model: realModel, costUSD: 0 };
    } catch {
      continue; // probar el siguiente modelo gratis (puede estar rate-limited o descontinuado)
    }
  }

  if (budget.spentUSD >= budget.capUSD) {
    return {
      id: job.id,
      ok: false,
      error: `Modelos gratis fallaron y el presupuesto semanal (US$${budget.capUSD}) ya se agoto. Hazlo tu mismo.`,
    };
  }

  for (const paid of pickPaidFallback(catalog, category, config)) {
    try {
      const { content, realModel, costUSD } = await callPaidAndTrackCost(paid, job, budget);
      const validation = validateCodeOutput(content, category, config);
      if (!validation.ok) {
        console.error(`[openrouter] ${paid.id} (pago) devolvio codigo que no pasa el typecheck -- reintentando con otro modelo. Detalle: ${validation.details?.slice(0, 300)}`);
        continue;
      }
      return { id: job.id, ok: true, content, model: realModel, costUSD };
    } catch {
      continue;
    }
  }

  return { id: job.id, ok: false, error: "Todos los modelos gratis y de fallback pago fallaron, no pasaron el typecheck, o no estan disponibles." };
}

async function runBatch(batchFile: string) {
  const jobs: Job[] = JSON.parse(fs.readFileSync(path.resolve(batchFile), "utf-8"));
  const config = loadRouteConfig();
  const catalog = await loadModelCatalog(config.modelsCacheTTLHours);
  const budget = loadBudget();

  console.error(`[openrouter] presupuesto semanal: US$${budget.spentUSD.toFixed(4)} / US$${budget.capUSD} gastado`);
  console.error(`[openrouter] lanzando ${jobs.length} tareas EN PARALELO...`);

  // Paralelo real: todas comparten el mismo objeto `budget` en memoria, pero como
  // el tope es de solo US$1-2/semana, el peor caso de pasarse por unos centavos
  // (si varias tareas caen al fallback pago en el mismo instante) es aceptable
  // a cambio de la velocidad -- no vale la pena un lock para este monto.
  // De a tandas, NO todos juntos: OpenRouter rate-limitea por cuenta y disparar 100
  // requests en paralelo hace que fallen casi todos y se pierdan los reintentos gratis.
  const limite = config.maxConcurrentJobs || 6;
  const results: JobResult[] = [];
  for (let i = 0; i < jobs.length; i += limite) {
    const tanda = jobs.slice(i, i + limite);
    if (jobs.length > limite) {
      console.error(`[openrouter] tanda ${Math.floor(i / limite) + 1}/${Math.ceil(jobs.length / limite)} (${tanda.length} tareas)`);
    }
    results.push(...(await Promise.all(tanda.map((job) => runJob(job, catalog, config, budget)))));
  }
  jobs.forEach((job, i) => {
    logUsage(job, results[i]);
    logDelegatedTask(job, results[i]);
  });

  saveBudget(budget);
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.error(`[openrouter] listo: ${results.length - failed}/${results.length} ok`);
  console.error(`[openrouter] presupuesto semanal restante: US$${(budget.capUSD - budget.spentUSD).toFixed(4)}`);
  if (failed > 0) process.exitCode = 1;
}

async function runSingle() {
  const prompt = getArg("prompt");
  const system = getArg("system");
  const category = getArg("category") || "auto";
  const inputFile = getArg("file");
  const variants = Number(getArg("variants") || 1);

  const userContent = inputFile
    ? fs.readFileSync(path.resolve(inputFile), "utf-8") + (prompt ? `\n\n${prompt}` : "")
    : prompt!;

  const config = loadRouteConfig();
  const catalog = await loadModelCatalog(config.modelsCacheTTLHours);
  const budget = loadBudget();
  const job: Job = { id: "single", prompt: userContent, system, category };

  if (variants > 1 && category !== "assist") {
    const results = await runVariants(job, catalog, config, variants);
    logUsage(job, { id: job.id, ok: results.some((r) => r.ok), costUSD: 0 });
    console.log(JSON.stringify(results, null, 2));
    console.error(`\n[openrouter] ${results.filter((r) => r.ok).length}/${results.length} borradores gratis generados -- elegi/combina el mejor.`);
    return;
  }

  const result = await runJob(job, catalog, config, budget);
  logUsage(job, result);
  logDelegatedTask(job, result);
  saveBudget(budget);

  if (!result.ok) {
    console.error(`ERROR: ${result.error}`);
    process.exit(1);
  }

  console.log(result.content);
  console.error(`\n[openrouter] modelo real: ${result.model} | costo: US$${(result.costUSD || 0).toFixed(6)}`);
  console.error(`[openrouter] presupuesto semanal restante: US$${(budget.capUSD - budget.spentUSD).toFixed(4)}`);
}

// Invocacion sin --prompt/--batch/--file: en vez de fallar con un error de uso, reporta el
// estado del modo de delegacion ambiental (presupuesto + creditos del gate PreToolUse) --
// util como chequeo rapido de "/cheap-ai" a secas, ya que la delegacion en si no depende de
// invocar el script con argumentos: el hook cheap-ai-gate.sh la fuerza en cada Write/Edit.
async function runStatus() {
  const budget = loadBudget();
  const heartbeatFile = path.join(findProjectRoot(), ".claude", ".cheap-ai-heartbeat");
  let credits = 0;
  if (fs.existsSync(heartbeatFile)) {
    const raw = fs.readFileSync(heartbeatFile, "utf-8").trim();
    credits = /^\d+$/.test(raw) ? Number(raw) : 0;
  }

  console.log(`[cheap-ai] presupuesto semanal: US$${budget.spentUSD.toFixed(4)} / US$${budget.capUSD} gastado (reinicia el proximo lunes)`);
  console.log(`[cheap-ai] creditos de delegacion disponibles: ${credits} (1 credito = 1 Write/Edit permitido por .claude/hooks/cheap-ai-gate.sh)`);
  console.log("");
  console.log("Este proyecto ya delega en modo ambiental: cada llamada exitosa a este script otorga");
  console.log("creditos (cheap-ai-heartbeat.sh) y el gate bloquea Write/Edit sin creditos disponibles");
  console.log("(salvo rutas sensibles de auth/RLS/pagos, que siempre pasan gratis). No hace falta");
  console.log('invocar nada mas "para activarlo" -- ya esta activo.');
  console.log("");
  console.log("Para delegar una tarea puntual:");
  console.log('  npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts --prompt "texto" [--category translation|code|implement|summarize|reasoning|auto|assist]');
  console.log("Para varias tareas EN PARALELO (genera varios creditos de una sola llamada):");
  console.log("  npx tsx .claude/skills/cheap-ai/scripts/openrouter-call.ts --batch jobs.json");
}

async function main() {
  const batchFile = getArg("batch");
  const prompt = getArg("prompt");
  const inputFile = getArg("file");

  if (!batchFile && !prompt && !inputFile) {
    await runStatus();
    return;
  }

  if (!API_KEY) {
    console.error(
      "ERROR: falta OPENROUTER_CHEAP_API_KEY (o OPENROUTER_API_KEY).\n" +
        "Se busco, en orden: .env.local del proyecto, .env.local del cwd,\n" +
        "~/.claude/cheap-ai.env y ~/.claude/secrets/openrouter."
    );
    process.exit(1);
  }

  if (batchFile) {
    await runBatch(batchFile);
  } else {
    await runSingle();
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
