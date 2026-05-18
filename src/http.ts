import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import type { RequestContext } from "bedrock-agentcore/runtime";
import { createMcpServer, VERSION } from "./server.js";
import { buildToolList, executeTool } from "./tools.js";
import { resolveUserToken } from "./auth.js";
import type { McpTool } from "./types.js";
import { logInfo, logError } from "./logger.js";

const tools = buildToolList();

async function handleInvocation(payload: unknown, context: RequestContext): Promise<unknown> {
  const { sessionId, workloadAccessToken } = context;

  logInfo("Invocation received", { requestId: sessionId, message: `payload=${JSON.stringify(payload).substring(0, 200)}` });

  const request = payload as { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };

  // Handle MCP initialize
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: (payload as any).id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "lark-cli-mcp-wrapper", version: VERSION },
      },
    };
  }

  // Handle MCP tools/list
  if (request.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: (payload as any).id,
      result: { tools: tools.map((t) => t.schema) },
    };
  }

  // Handle MCP tools/call
  if (request.method === "tools/call") {
    const { name, arguments: args } = request.params ?? {};
    const tool = tools.find((t: McpTool) => t.schema.name === name);

    if (!tool) {
      return {
        jsonrpc: "2.0",
        id: (payload as any).id,
        result: { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true },
      };
    }

    let userToken: string | undefined;
    if (workloadAccessToken) {
      const tokenResult = await resolveUserToken(workloadAccessToken);
      if (tokenResult.authUrl) {
        return {
          jsonrpc: "2.0",
          id: (payload as any).id,
          result: {
            content: [{ type: "text", text: `请先授权飞书访问权限：${tokenResult.authUrl}` }],
            isError: true,
          },
        };
      }
      userToken = tokenResult.token;
    }

    const result = await executeTool(tool, args ?? {}, userToken);
    return {
      jsonrpc: "2.0",
      id: (payload as any).id,
      result,
    };
  }

  // Handle notifications (no response needed) and unknown methods
  if (request.method === "notifications/initialized") {
    return { jsonrpc: "2.0", id: (payload as any).id, result: {} };
  }

  return {
    jsonrpc: "2.0",
    id: (payload as any).id,
    error: { code: -32601, message: `Method not found: ${request.method}` },
  };
}

export async function startHttp(): Promise<void> {
  const app = new BedrockAgentCoreApp({
    invocationHandler: { process: handleInvocation },
    config: {
      contentTypeParsers: [
        {
          contentType: "application/json",
          parseAs: "stream" as const,
          parser: (request: unknown, payload: any, done: (err: Error | null, body?: unknown) => void) => {
            const chunks: Buffer[] = [];
            payload.on("data", (chunk: Buffer) => chunks.push(chunk));
            payload.on("end", () => {
              const raw = Buffer.concat(chunks);
              // Try JSON first
              try {
                const body = JSON.parse(raw.toString("utf-8"));
                done(null, body);
                return;
              } catch {
                // Not valid JSON — try CBOR
              }
              import("@smithy/core/cbor").then(({ cbor }) => {
                try {
                  const decoded = cbor.deserialize(new Uint8Array(raw));
                  done(null, decoded);
                } catch {
                  done(new Error(`Unable to parse body (${raw.length} bytes, hex: ${raw.toString("hex").substring(0, 40)})`));
                }
              }).catch(() => {
                done(new Error(`Unable to parse body (${raw.length} bytes)`));
              });
            });
            payload.on("error", (err: Error) => done(err));
          },
        },
      ],
    },
  });

  const port = parseInt(process.env.PORT ?? "8080", 10);
  logInfo("Server starting", {
    message: `port=${port} | version=${VERSION} | region=${process.env.AWS_REGION ?? "us-east-1"}`,
  });
  await app.run({ port });
}
