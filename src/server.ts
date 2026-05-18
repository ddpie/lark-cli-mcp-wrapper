import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildToolList } from "./tools.js";
import type { McpTool } from "./types.js";

export const VERSION = "0.9.0";

export function createMcpServer(tools?: McpTool[]): { server: Server; tools: McpTool[] } {
  const server = new Server(
    { name: "lark-cli-mcp-wrapper", version: VERSION },
    { capabilities: { tools: {} } }
  );

  const resolvedTools = tools ?? buildToolList();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: resolvedTools.map((t) => t.schema),
  }));

  return { server, tools: resolvedTools };
}
