/**
 * sync-key.ts -- Reparte la key COMPARTIDA de cheap-ai a todos los proyectos.
 *
 * La key de cheap-ai es una sola para toda la maquina y vive en
 * ~/.claude/secrets/openrouter (permisos 600). Este script la copia al .env.local de
 * cada proyecto que tenga el skill instalado.
 *
 * Lo que toca y lo que NO:
 *   - Reescribe UNICAMENTE el bloque delimitado de cheap-ai (las dos variables
 *     OPENROUTER_CHEAP_*). Todo lo demas del .env.local queda intacto: las keys propias
 *     de cada proyecto (Supabase, Resend, Huli, OPENROUTER_API_KEY, etc.) son suyas y
 *     no se tocan nunca.
 *
 * Para ROTAR la key: cambiar ~/.claude/secrets/openrouter y correr esto.
 *
 * Uso:
 *   npx tsx .claude/skills/cheap-ai/scripts/sync-key.ts            # reparte a todos
 *   npx tsx .claude/skills/cheap-ai/scripts/sync-key.ts --dry-run  # solo muestra
 *   npx tsx .claude/skills/cheap-ai/scripts/sync-key.ts --root ~/otra/carpeta
 */

import fs from "fs";
import os from "os";
import path from "path";

const SECRET_FILE = path.join(os.homedir(), ".claude", "secrets", "openrouter");
const CAP_DEFAULT = "0.70";

const INICIO = "# --- cheap-ai (compartida entre todos los proyectos) ---";
// Cualquier bloque previo se reemplaza entero: desde el marcador hasta la linea del cap.
const BLOQUE_RE = /^# --- cheap-ai \(compartida[\s\S]*?OPENROUTER_CHEAP_WEEKLY_CAP_USD=.*\n?/m;
// Variables sueltas de versiones anteriores (sin marcador), para no dejar duplicados.
const SUELTAS = [/^OPENROUTER_CHEAP_API_KEY=.*\n?/m, /^OPENROUTER_CHEAP_WEEKLY_CAP_USD=.*\n?/m];

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const rootArg = args[args.indexOf("--root") + 1];
const ROOT = args.includes("--root") && rootArg ? path.resolve(rootArg.replace(/^~/, os.homedir())) : path.resolve(process.cwd(), "..");

// Proyectos que a proposito quedan fuera del reparto, por nombre de carpeta.
// Se configuran por entorno para que este archivo no tenga que editarse:
//   CHEAP_AI_SYNC_EXCLUDE="MiProyecto,otro-repo" npx tsx .../sync-key.ts
const EXCLUIDOS = (process.env.CHEAP_AI_SYNC_EXCLUDE || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

function bloque(key: string, cap: string): string {
  return [
    INICIO,
    "# Se sincroniza desde ~/.claude/secrets/openrouter. No editar a mano: para rotarla,",
    "# cambiar ese archivo y correr sync-key.ts.",
    `OPENROUTER_CHEAP_API_KEY=${key}`,
    `OPENROUTER_CHEAP_WEEKLY_CAP_USD=${cap}`,
    "",
  ].join("\n");
}

// Busca .claude/skills/cheap-ai a cualquier profundidad razonable: varios proyectos
// viven anidados un nivel mas adentro (carpeta contenedora + repo real).
function buscarProyectos(dir: string, prof = 0, out: string[] = []): string[] {
  if (prof > 4) return out;
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (fs.existsSync(path.join(dir, ".claude", "skills", "cheap-ai"))) {
    out.push(dir);
    return out; // no se sigue bajando: el proyecto ya es este
  }
  for (const e of entradas) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    buscarProyectos(path.join(dir, e.name), prof + 1, out);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(SECRET_FILE)) {
    console.error(`ERROR: no existe ${SECRET_FILE}. Guarda ahi la key de cheap-ai (chmod 600).`);
    process.exit(1);
  }
  const key = fs.readFileSync(SECRET_FILE, "utf-8").trim();
  if (!key) {
    console.error(`ERROR: ${SECRET_FILE} esta vacio.`);
    process.exit(1);
  }

  // Se valida ANTES de repartir: propagar una key muerta a 10 proyectos deja el skill
  // roto en todos y el error que produce ("todos los modelos fallaron") no dice por que.
  const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    console.error(`ERROR: la key no es valida (HTTP ${res.status}: ${body.error?.message || "sin detalle"}). No se repartio nada.`);
    process.exit(1);
  }
  const info = (await res.json()) as { data?: { limit?: number | null; usage?: number } };
  const limite = info.data?.limit;
  const cap = limite ? Math.max(0.05, Number((limite * 0.875).toFixed(2))).toString() : CAP_DEFAULT;
  console.log(`Key valida. Limite en OpenRouter: ${limite ? "US$" + limite : "sin limite"} | usado: US$${(info.data?.usage || 0).toFixed(4)}`);
  console.log(`Tope local que se va a escribir: US$${cap} (por debajo del limite real, para frenar antes del 402)\n`);

  const proyectos = buscarProyectos(ROOT).filter((p) => !EXCLUIDOS.includes(path.basename(p)) && !EXCLUIDOS.some((x) => p.includes(path.sep + x + path.sep)));
  if (proyectos.length === 0) {
    console.error(`No se encontro ningun proyecto con cheap-ai bajo ${ROOT}.`);
    process.exit(1);
  }

  for (const proj of proyectos) {
    const f = path.join(proj, ".env.local");
    const nombre = path.relative(ROOT, proj);
    let t = fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : "";
    const antes = t;
    t = t.replace(BLOQUE_RE, "");
    for (const re of SUELTAS) t = t.replace(re, "");
    t = t.replace(/\n{3,}/g, "\n\n");
    if (t && !t.endsWith("\n")) t += "\n";
    const nuevo = t + (t ? "\n" : "") + bloque(key, cap);
    const otras = [...nuevo.matchAll(/^([A-Z0-9_]+)=/gm)].filter((m) => !m[1].startsWith("OPENROUTER_CHEAP")).length;
    if (DRY) {
      console.log(`  [dry] ${nombre.padEnd(42)} ${antes === nuevo ? "sin cambios" : "se actualizaria"} (${otras} vars propias intactas)`);
      continue;
    }
    fs.writeFileSync(f, nuevo);
    console.log(`  ${nombre.padEnd(42)} ${antes === nuevo ? "ya estaba al dia" : "actualizado"} (${otras} vars propias intactas)`);
  }
  console.log(`\n${proyectos.length} proyectos${DRY ? " (dry-run, no se escribio nada)" : ""}.`);
}

main();
