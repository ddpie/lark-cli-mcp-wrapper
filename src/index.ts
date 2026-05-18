#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { executeTool } from "./tools.js";
import { createMcpServer } from "./server.js";

async function startStdio() {
  const { server, tools } = createMcpServer();

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.schema.name === name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return executeTool(tool, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  const mode = process.env.MCP_TRANSPORT ?? "stdio";
  if (mode === "http") {
    const { startHttp } = await import("./http.js");
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
