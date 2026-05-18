import { readFileSync } from "node:fs";
import { execa } from "execa";
import type { ToolDef, McpTool, ToolResult } from "./types.js";

const toolDefs = JSON.parse(
  readFileSync(new URL("./generated-tools.json", import.meta.url), "utf-8")
);

function toolName(def: ToolDef): string {
  const cmd = def.command.replace(/^\+/, "");
  return `lark_${def.service}_${cmd.replace(/-/g, "_")}`;
}

function toSchemaKey(flagName: string): string {
  return flagName.replace(/-/g, "_");
}

function buildInputSchema(def: ToolDef): Record<string, unknown> {
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

const RAW_API_TOOL: McpTool = {
  schema: {
    name: "lark_raw_api",
    description: "Call any Lark OpenAPI endpoint directly (2500+ APIs). Use when no shortcut covers your need.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          description: "HTTP method",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        },
        path: {
          type: "string",
          description: "API path, e.g. /open-apis/calendar/v4/calendars",
        },
        params: {
          type: "string",
          description: "Query/URL parameters as JSON string",
        },
        data: {
          type: "string",
          description: "Request body as JSON string (for POST/PUT/PATCH/DELETE)",
        },
        page_all: {
          type: "boolean",
          description: "Automatically paginate through all pages",
        },
      },
      required: ["method", "path"],
    },
  },
  def: {
    service: "api",
    command: "__raw__",
    description: "Raw Lark API call",
    risk: "write",
    flags: [],
  },
};

export function buildToolList(): McpTool[] {
  const shortcuts = (toolDefs as ToolDef[]).map((def) => ({
    schema: {
      name: toolName(def),
      description: `[${def.risk}] ${def.description}`,
      inputSchema: buildInputSchema(def),
    },
    def,
  }));
  return [...shortcuts, RAW_API_TOOL];
}

export async function executeTool(
  tool: McpTool,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const { def } = tool;

  // Raw API tool has a different invocation pattern
  if (def.command === "__raw__") {
    return executeRawApi(args);
  }

  const cliArgs = [def.service, def.command, "--format", "json"];

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

    // Validate JSON envelope
    try {
      const parsed = JSON.parse(output);
      if (parsed.ok === false) {
        return {
          content: [{ type: "text", text: output }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: output }] };
    } catch {
      return { content: [{ type: "text", text: output }] };
    }
  } catch (err: any) {
    const stderr = err.stderr?.trim() ?? "";
    const stdout = err.stdout?.trim() ?? "";
    const message = stdout || stderr || err.message;

    // Exit code 10 = confirmation required (should not happen with --yes)
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}

async function executeRawApi(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const method = String(args.method ?? "GET");
  const path = String(args.path ?? "");
  const cliArgs = ["api", method, path, "--format", "json"];

  if (args.params) cliArgs.push("--params", String(args.params));
  if (args.data) cliArgs.push("--data", String(args.data));
  if (args.page_all) cliArgs.push("--page-all");

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
      return { content: [{ type: "text", text: output }] };
    }
  } catch (err: any) {
    const stderr = err.stderr?.trim() ?? "";
    const stdout = err.stdout?.trim() ?? "";
    const message = stdout || stderr || err.message;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
