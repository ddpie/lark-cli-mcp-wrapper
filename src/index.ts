#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTierOneTools, executeTool } from "./tools.js";
import { getMetaToolSchemas, handleMetaTool } from "./meta-tools.js";

const server = new Server(
  { name: "lark-cli-mcp-wrapper", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

const tier1Tools = buildTierOneTools();
const metaSchemas = getMetaToolSchemas();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...tier1Tools.map((t) => t.schema), ...metaSchemas],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const metaResult = await handleMetaTool(name, args ?? {});
  if (metaResult) return metaResult;

  const tool = tier1Tools.find((t) => t.schema.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  return executeTool(tool, args ?? {});
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
