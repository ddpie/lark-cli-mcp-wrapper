import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpServer, VERSION } from "./server.js";
import { buildToolList, executeTool } from "./tools.js";
import { resolveUserToken } from "./auth.js";
import type { McpTool } from "./types.js";
import { logInfo, logWarn, logError } from "./logger.js";

interface Session {
  server: Server;
  transport: InstanceType<typeof StreamableHTTPServerTransport>;
  workloadToken: string;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, Session>();
const tools = buildToolList();

function cleanStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close?.();
      sessions.delete(id);
      logInfo("Session expired and cleaned up", { requestId: id });
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

    if (!workloadToken) {
      return executeTool(tool, args ?? {});
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = (req.headers["mcp-session-id"] ?? req.headers["x-amzn-bedrock-agentcore-runtime-session-id"]) as string | undefined;
  const workloadToken = (req.headers["workloadaccesstoken"] ?? "") as string;

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    try {
      await session.transport.handleRequest(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError("Error handling session request", { requestId: sessionId, message: msg });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
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

  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("Error handling new session request", { message: msg });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }

  if (transport.sessionId) {
    sessions.set(transport.sessionId, {
      server,
      transport,
      workloadToken,
      lastActivity: Date.now(),
    });
    logInfo("New session created", { requestId: transport.sessionId });
  }
}

export async function startHttp(): Promise<HttpServer> {
  const port = parseInt(process.env.PORT ?? "8080", 10);
  const bindAddress = process.env.BIND_ADDRESS ?? "0.0.0.0";

  const httpServer = createServer(async (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";

    // Health check — AgentCore uses /ping
    if ((url === "/ping" || url === "/health") && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "lark-cli-mcp-wrapper", version: VERSION }));
      return;
    }

    // MCP endpoint — AgentCore sends to /invocations, standard MCP uses /mcp
    if (method === "POST") {
      const body = await readBody(req);
      const bodyHex = Buffer.from(body).toString("hex").substring(0, 200);
      logInfo("POST request", {
        message: `path=${url} content-type=${req.headers["content-type"]} len=${body.length} hex=${bodyHex} utf8=${body.substring(0, 200)}`,
      });

      // Reconstruct request stream for transport
      const { Readable } = await import("node:stream");
      const fakeReq = Object.assign(Readable.from(Buffer.from(body)), {
        method: req.method,
        url: "/mcp",
        headers: req.headers,
        socket: req.socket,
        connection: req.connection,
      }) as any;

      try {
        await handleMcpRequest(fakeReq, res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError("Unhandled error in MCP handler", { message: msg });
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      }
      return;
    }

    // SSE/GET for existing sessions (MCP Streamable HTTP spec)
    if (method === "GET" && (url === "/mcp" || url === "/invocations")) {
      try {
        await handleMcpRequest(req, res);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  return new Promise((resolve) => {
    httpServer.listen(port, bindAddress, () => {
      logInfo("Server started", {
        message: `http://${bindAddress}:${port} | version=${VERSION} | region=${process.env.AWS_REGION ?? "us-east-1"} | provider=${process.env.OAUTH_PROVIDER_NAME ?? "feishu-oauth-provider"}`,
      });
      resolve(httpServer);
    });
  });
}
