import { search, findByName, findSimilar } from "./catalog.js";
import { executeTool } from "./tools.js";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

const DISCOVER_SCHEMA = {
  name: "lark_discover",
  description:
    "[read] Discover lark-cli tools not in the high-frequency set. Use when registered tools cannot fulfill the need.",
  inputSchema: {
    type: "object",
    anyOf: [{ required: ["query"] }, { required: ["category"] }],
    properties: {
      query: {
        type: "string",
        description: "Natural language or keyword, e.g. 'create wiki space'",
      },
      category: {
        type: "string",
        enum: [
          "im", "calendar", "docs", "base", "sheets", "drive", "task",
          "contact", "wiki", "mail", "vc", "minutes", "okr", "slides",
          "whiteboard", "markdown",
        ],
      },
    },
  },
};

const INVOKE_SCHEMA = {
  name: "lark_invoke",
  description:
    "[read|write] Invoke a tool discovered via lark_discover. Pass exact tool_name and args.",
  inputSchema: {
    type: "object",
    required: ["tool_name", "args"],
    properties: {
      tool_name: { type: "string" },
      args: { type: "object" },
    },
  },
};

export function getMetaToolSchemas() {
  return [DISCOVER_SCHEMA, INVOKE_SCHEMA];
}

export async function handleMetaTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult | null> {
  if (name === "lark_discover") return handleDiscover(args);
  if (name === "lark_invoke") return handleInvoke(args);
  return null;
}

function handleDiscover(args: Record<string, unknown>): ToolResult {
  const query = args.query as string | undefined;
  const category = args.category as string | undefined;

  if (!query && !category) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "Provide query or category" }) }],
      isError: true,
    };
  }

  const results = search(query, category);

  if (results.length === 0) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          tools: [],
          hint: "Try different keywords or specify a category",
        }),
      }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ tools: results }) }],
  };
}

async function handleInvoke(args: Record<string, unknown>): Promise<ToolResult> {
  const toolName = args.tool_name as string | undefined;
  const toolArgs = (args.args as Record<string, unknown>) ?? {};

  if (!toolName) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "tool_name is required" }) }],
      isError: true,
    };
  }

  const entry = findByName(toolName);
  if (!entry) {
    const similar = findSimilar(toolName);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "unknown_tool",
          tool_name: toolName,
          similar,
          hint: "Use lark_discover to find the correct tool",
        }),
      }],
      isError: true,
    };
  }

  const mcpTool = {
    schema: {
      name: entry.name,
      description: `[${entry.def.risk}] ${entry.def.description}`,
      inputSchema: {},
    },
    def: entry.def,
  };

  return executeTool(mcpTool, toolArgs);
}
