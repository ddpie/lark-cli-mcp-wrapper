import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getLarkCliVersion, generateTools } from "./generate.js";

export interface ToolFlag {
  name: string;
  type: "string" | "boolean" | "number";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolDef {
  service: string;
  command: string;
  description: string;
  risk: string;
  flags: ToolFlag[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedPath = resolve(__dirname, "generated-tools.json");

function loadToolDefs(): ToolDef[] {
  if (!existsSync(generatedPath)) return [];
  const raw = JSON.parse(readFileSync(generatedPath, "utf-8"));
  if (Array.isArray(raw)) return raw;
  return raw.tools ?? [];
}

function getStoredVersion(): string | null {
  if (!existsSync(generatedPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(generatedPath, "utf-8"));
    return raw._larkCliVersion ?? null;
  } catch {
    return null;
  }
}

export async function ensureToolsUpToDate(): Promise<void> {
  const currentVersion = getLarkCliVersion();
  if (!currentVersion) return;

  const storedVersion = getStoredVersion();
  if (storedVersion === currentVersion) return;

  console.error(`[info] lark-cli version changed (${storedVersion} → ${currentVersion}), regenerating tools...`);
  await generateTools(generatedPath);
  // Reload
  const raw = JSON.parse(readFileSync(generatedPath, "utf-8"));
  const newTools: ToolDef[] = raw.tools ?? [];
  toolDefs.splice(0, toolDefs.length, ...newTools);
}

export const toolDefs: ToolDef[] = loadToolDefs();

export const tier1Names: string[] = JSON.parse(
  readFileSync(resolve(__dirname, "tier1.json"), "utf-8")
);

export function toToolName(def: ToolDef): string {
  const cmd = def.command.replace(/^\+/, "");
  return `lark_${def.service}_${cmd.replace(/-/g, "_")}`;
}

export function toSchemaKey(flagName: string): string {
  return flagName.replace(/-/g, "_");
}
