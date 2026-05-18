import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpServer, VERSION } from "./server.js";
import { buildToolList, executeTool } from "./tools.js";
import { resolveUserToken } from "./auth.js";
import type { McpTool } from "./types.js";

interface Session {
  server: Server;
  transport: InstanceType<typeof StreamableHTTPServerTransport>;
  workloadToken: string;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessions = new Map<string, Session>();
const tools = buildToolList();

function cleanStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close?.();
      sessions.delete(id);
    }
  }
}

setInterval(cleanStaleSessions, 60_000).unref();

function createSessionServer(workloadToken: string): Server {
  const { server } = createMcpServer(tools);

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t: McpTool) => t.schema.name === name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    const tokenResult = await resolveUserToken(workloadToken);

    if (tokenResult.authUrl) {
      return {
        content: [{ type: "text", text: `请先授权飞书访问权限：${tokenResult.authUrl}` }],
        isError: true,
      };
    }

    return executeTool(tool, args ?? {}, tokenResult.token);
  });

  return server;
}

export async function startHttp(): Promise<HttpServer> {
  const port = parseInt(process.env.PORT ?? "8000", 10);
  const bindAddress = process.env.BIND_ADDRESS ?? "0.0.0.0";

  const httpServer = createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "lark-cli-mcp-wrapper", version: VERSION }));
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const workloadToken = (req.headers["workloadaccesstoken"] as string) ?? "";

    if (!workloadToken) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "WorkloadAccessToken header is required" }));
      return;
    }

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.workloadToken !== workloadToken) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session token mismatch" }));
        return;
      }
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    const server = createSessionServer(workloadToken);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, {
        server,
        transport,
        workloadToken,
        lastActivity: Date.now(),
      });
    }
  });

  return new Promise((resolve) => {
    httpServer.listen(port, bindAddress, () => {
      process.stderr.write(`lark-cli-mcp-wrapper listening on http://${bindAddress}:${port}\n`);
      resolve(httpServer);
    });
  });
}
