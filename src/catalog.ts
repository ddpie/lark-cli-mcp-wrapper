import { toolDefs, tier1Names, toToolName } from "./data.js";
import { buildInputSchema } from "./tools.js";
import type { ToolDef } from "./data.js";

export interface CatalogEntry {
  name: string;
  def: ToolDef;
  nameTokens: string[];
  descTokens: string[];
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
    return candidates.slice(0, 20).map(toResult);
  }

  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const entry of candidates) {
    let score = 0;
    for (const tok of tokens) {
      const nameHit = entry.nameTokens.some((nt) => nt.startsWith(tok) || tok.startsWith(nt));
      const descHit = entry.descTokens.some((dt) => dt.startsWith(tok) || tok.startsWith(dt));
      if (nameHit || descHit) score++;
    }
    if (score > 0) scored.push({ entry, score });
  }

  if (category && query && scored.length < 3) {
    return candidates.slice(0, 20).map(toResult);
  }

  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, 20).map((s) => toResult(s.entry));
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
