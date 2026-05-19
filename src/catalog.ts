import { readFileSync } from "node:fs";
import { buildInputSchema, type ToolDef } from "./tools.js";

const tier1Names: string[] = JSON.parse(
  readFileSync(new URL("./tier1.json", import.meta.url), "utf-8")
);

export interface CatalogEntry {
  name: string;
  def: ToolDef;
  nameTokens: string[];
  descTokens: string[];
}

const toolDefs: ToolDef[] = JSON.parse(
  readFileSync(new URL("./generated-tools.json", import.meta.url), "utf-8")
);

function toToolName(def: ToolDef): string {
  const cmd = def.command.replace(/^\+/, "");
  return `lark_${def.service}_${cmd.replace(/-/g, "_")}`;
}

const tier1Set = new Set(tier1Names);

const catalog: CatalogEntry[] = toolDefs.map((def) => {
  const name = toToolName(def);
  return {
    name,
    def,
    nameTokens: name.split("_"),
    descTokens: def.description.toLowerCase().split(/\s+/),
  };
});

export interface SearchResult {
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, unknown>;
}

export function search(query?: string, category?: string): SearchResult[] {
  const tokens = query ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const nonTier1 = catalog.filter((e) => !tier1Set.has(e.name));

  let candidates = nonTier1;
  if (category) {
    candidates = nonTier1.filter((e) => e.def.service === category);
  }

  if (tokens.length === 0) {
    return candidates.slice(0, 5).map(toResult);
  }

  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const entry of candidates) {
    let score = 0;
    for (const tok of tokens) {
      if (entry.nameTokens.includes(tok) || entry.descTokens.includes(tok)) {
        score++;
      }
    }
    if (score > 0) scored.push({ entry, score });
  }

  // If category+query AND yields < 3 results, fallback to category-only (no scoring)
  if (category && query && scored.length < 3) {
    return candidates.slice(0, 5).map(toResult);
  }

  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, 5).map((s) => toResult(s.entry));
}

export function findByName(name: string): CatalogEntry | undefined {
  return catalog.find((e) => e.name === name);
}

export function findSimilar(name: string, limit = 3): string[] {
  const tokens = name.toLowerCase().split("_").filter(Boolean);
  const scored: { name: string; score: number }[] = [];

  for (const entry of catalog) {
    let score = 0;
    for (const tok of tokens) {
      if (entry.nameTokens.includes(tok)) score++;
    }
    if (score > 0) scored.push({ name: entry.name, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.name);
}


function toResult(entry: CatalogEntry): SearchResult {
  return {
    name: entry.name,
    description: `[${entry.def.risk}] ${entry.def.description}`,
    category: entry.def.service,
    inputSchema: buildInputSchema(entry.def),
  };
}

