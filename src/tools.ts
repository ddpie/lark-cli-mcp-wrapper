import { readFileSync } from "node:fs";
import { execa } from "execa";
import type { ToolDef, McpTool, ToolResult } from "./types.js";
import { logInfo, logError } from "./logger.js";

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

const GATEWAY_TOOLS = new Set([
  // IM (5)
  "lark_im_messages_send",
  "lark_im_messages_search",
  "lark_im_chat_list",
  "lark_im_chat_messages_list",
  "lark_im_chat_search",
  // Calendar (4)
  "lark_calendar_agenda",
  "lark_calendar_create",
  "lark_calendar_freebusy",
  "lark_calendar_room_find",
  // Docs (4)
  "lark_docs_create",
  "lark_docs_fetch",
  "lark_docs_search",
  "lark_docs_update",
  // Base (4)
  "lark_base_base_get",
  "lark_base_data_query",
  "lark_base_record_batch_create",
  "lark_base_record_search",
  // Drive (3)
  "lark_drive_search",
  "lark_drive_upload",
  "lark_drive_download",
  // Task (3)
  "lark_task_create",
  "lark_task_get_my_tasks",
  "lark_task_complete",
  // Contact (2)
  "lark_contact_search_user",
  "lark_contact_get_user",
  // Sheets (2)
  "lark_sheets_read",
  "lark_sheets_write",
  // Raw API (1) — covers everything else
  "lark_raw_api",
]);

export function buildToolList(): McpTool[] {
  const shortcuts = (toolDefs as ToolDef[]).map((def) => ({
    schema: {
      name: toolName(def),
      description: `[${def.risk}] ${def.description}`,
      inputSchema: buildInputSchema(def),
    },
    def,
  }));
  const all = [...shortcuts, RAW_API_TOOL];
  if (process.env.TOOL_MODE === "gateway") {
    return all.filter((t) => GATEWAY_TOOLS.has(t.schema.name));
  }
  return all;
}

async function runLarkCli(cliArgs: string[], userToken?: string): Promise<ToolResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  if (userToken) {
    env.LARKSUITE_CLI_USER_ACCESS_TOKEN = userToken;
  }

  const toolName = cliArgs.slice(0, 2).join(" ");
  const start = Date.now();

  try {
    const result = await execa("lark-cli", cliArgs, {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      env,
    });

    const duration = Date.now() - start;
    const output = result.stdout.trim();

    if (!output) {
      logInfo("Tool executed", { tool: toolName, duration, status: "success" });
      return { content: [{ type: "text", text: '{"ok":true,"data":null}' }] };
    }

    try {
      const parsed = JSON.parse(output);
      if (parsed.ok === false) {
        logError("Tool returned error", { tool: toolName, duration, status: "error" });
        return { content: [{ type: "text", text: output }], isError: true };
      }
      logInfo("Tool executed", { tool: toolName, duration, status: "success" });
      return { content: [{ type: "text", text: output }] };
    } catch {
      logInfo("Tool executed (non-JSON)", { tool: toolName, duration, status: "success" });
      return { content: [{ type: "text", text: output }] };
    }
  } catch (err: any) {
    const duration = Date.now() - start;
    const stderr = err.stderr?.trim() ?? "";
    const stdout = err.stdout?.trim() ?? "";
    const message = stdout || stderr || err.message;
    logError("Tool execution failed", { tool: toolName, duration, status: "error" });
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export async function executeTool(
  tool: McpTool,
  args: Record<string, unknown>,
  userToken?: string
): Promise<ToolResult> {
  const { def } = tool;

  if (def.command === "__raw__") {
    return executeRawApi(args, userToken);
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

  return runLarkCli(cliArgs, userToken);
}

async function executeRawApi(
  args: Record<string, unknown>,
  userToken?: string
): Promise<ToolResult> {
  const method = String(args.method ?? "GET");
  const path = String(args.path ?? "");

  if (!path) {
    return { content: [{ type: "text", text: "Error: path is required" }], isError: true };
  }

  const cliArgs = ["api", method, path, "--format", "json"];

  if (args.params) cliArgs.push("--params", String(args.params));
  if (args.data) cliArgs.push("--data", String(args.data));
  if (args.page_all) cliArgs.push("--page-all");

  return runLarkCli(cliArgs, userToken);
}
