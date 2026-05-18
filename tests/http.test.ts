import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Server as HttpServer } from "node:http";

vi.mock("../src/auth.js", () => ({
  resolveUserToken: vi.fn().mockResolvedValue({ token: "mock-feishu-token" }),
  clearTokenCache: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '{"ok":true,"data":{"test":1}}' }),
}));

describe("HTTP transport", () => {
  let httpServer: HttpServer;

  beforeAll(async () => {
    process.env.MCP_TRANSPORT = "http";
    process.env.PORT = "18765";
    process.env.BIND_ADDRESS = "127.0.0.1";
    const { startHttp } = await import("../src/http.js");
    httpServer = await startHttp();
  });

  afterAll(() => {
    httpServer?.close();
    delete process.env.MCP_TRANSPORT;
    delete process.env.PORT;
    delete process.env.BIND_ADDRESS;
  });

  it("/ping returns 200 with server info", async () => {
    const res = await fetch("http://127.0.0.1:18765/ping");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.name).toBe("lark-cli-mcp-wrapper");
  });

  it("/health also returns 200", async () => {
    const res = await fetch("http://127.0.0.1:18765/health");
    expect(res.status).toBe(200);
  });

  it("GET /unknown returns 404", async () => {
    const res = await fetch("http://127.0.0.1:18765/unknown");
    expect(res.status).toBe(404);
  });

  it("POST /invocations accepts MCP requests", async () => {
    const res = await fetch("http://127.0.0.1:18765/invocations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    // Should get a valid MCP response (not 401 or 404)
    expect(res.status).toBe(200);
  });
});
