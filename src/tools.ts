import { execa } from "execa";
import { toolDefs, tier1Names, toToolName, toSchemaKey } from "./data.js";
import type { ToolDef } from "./data.js";

export type { ToolDef } from "./data.js";

export interface McpTool {
  schema: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
  };
  def: ToolDef;
}

export function buildInputSchema(def: ToolDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const flag of def.flags) {
    const key = toSchemaKey(flag.name);
    const prop: Record<string, unknown> = { description: flag.description };
    if (flag.type === "boolean") prop.type = "boolean";
    else if (flag.type === "number") prop.type = "number";
    else prop.type = "string";
    if (flag.enum && flag.enum.length > 0) prop.enum = flag.enum;
    properties[key] = prop;
    if (flag.required) required.push(key);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export function buildAnnotations(risk: string): Record<string, unknown> {
  if (risk === "read") {
    return { readOnlyHint: true };
  }
  if (risk === "high-risk-write") {
    return { readOnlyHint: false, destructiveHint: true };
  }
  return { readOnlyHint: false, destructiveHint: false };
}

export function buildTierOneTools(): McpTool[] {
  const tier1Set = new Set(tier1Names);
  const tools: McpTool[] = [];

  for (const def of toolDefs) {
    const name = toToolName(def);
    if (!tier1Set.has(name)) continue;
    tools.push({
      schema: {
        name,
        description: `[${def.risk}] ${def.description}`,
        inputSchema: buildInputSchema(def),
        annotations: buildAnnotations(def.risk),
      },
      def,
    });
  }

  const found = new Set(tools.map((t) => t.schema.name));
  for (const name of tier1Names) {
    if (!found.has(name)) {
      console.error(`[warn] Tier 1 tool "${name}" not found in generated-tools.json, skipping`);
    }
  }

  return tools;
}

export async function executeTool(
  tool: McpTool,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { def } = tool;
  const cliArgs = [def.service, def.command];

  for (const flag of def.flags) {
    const key = toSchemaKey(flag.name);
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    if (flag.type === "boolean") {
      if (value) cliArgs.push(`--${flag.name}`);
    } else {
      cliArgs.push(`--${flag.name}`, String(value));
    }
  }

  if (args.dry_run && !cliArgs.includes("--dry-run")) {
    cliArgs.push("--dry-run");
  }

  if (def.risk === "high-risk-write") {
    cliArgs.push("--yes");
  }

  try {
    const result = await execa("lark-cli", cliArgs, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });

    const output = result.stdout.trim();
    if (!output) {
      return { content: [{ type: "text", text: '{"ok":true,"data":null}' }] };
    }

    try {
      const parsed = JSON.parse(output);
      if (parsed.ok === false) {
        return { content: [{ type: "text", text: output }], isError: true };
      }
      return { content: [{ type: "text", text: output }] };
    } catch {
      const isError = output.startsWith("Usage:") || output.startsWith("Error:");
      return { content: [{ type: "text", text: output }], ...(isError && { isError: true }) };
    }
  } catch (err: any) {
    const stderr = err.stderr?.trim() ?? "";
    const stdout = err.stdout?.trim() ?? "";
    const message = stdout || stderr || err.message;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
