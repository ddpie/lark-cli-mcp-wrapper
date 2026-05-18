import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";

vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '{"ok":true,"data":{}}' }),
}));

const mockedExeca = vi.mocked(execa);

import { buildToolList, executeTool } from "../src/tools.js";

describe("executeTool", () => {
  beforeEach(() => {
    mockedExeca.mockClear();
    mockedExeca.mockResolvedValue({ stdout: '{"ok":true,"data":{}}' } as any);
  });

  it("injects LARKSUITE_CLI_USER_ACCESS_TOKEN when userToken is provided", async () => {
    const tools = buildToolList();
    const tool = tools.find((t) => t.schema.name === "lark_raw_api")!;

    await executeTool(tool, { method: "GET", path: "/open-apis/test" }, "test-user-token-123");

    expect(mockedExeca).toHaveBeenCalledWith(
      "lark-cli",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          LARKSUITE_CLI_USER_ACCESS_TOKEN: "test-user-token-123",
        }),
      }),
    );
  });

  it("does not set LARKSUITE_CLI_USER_ACCESS_TOKEN when userToken is undefined", async () => {
    const tools = buildToolList();
    const tool = tools.find((t) => t.schema.name === "lark_raw_api")!;

    await executeTool(tool, { method: "GET", path: "/open-apis/test" });

    const callEnv = mockedExeca.mock.calls[0][2]?.env as Record<string, string>;
    expect(callEnv).not.toHaveProperty("LARKSUITE_CLI_USER_ACCESS_TOKEN");
  });

  it("returns isError when lark-cli returns ok:false", async () => {
    mockedExeca.mockResolvedValue({ stdout: '{"ok":false,"error":"bad request"}' } as any);
    const tools = buildToolList();
    const tool = tools.find((t) => t.schema.name === "lark_raw_api")!;

    const result = await executeTool(tool, { method: "GET", path: "/open-apis/test" });

    expect(result.isError).toBe(true);
  });

  it("returns isError when lark-cli process fails", async () => {
    mockedExeca.mockRejectedValue({ stderr: "command not found", stdout: "", message: "fail" });
    const tools = buildToolList();
    const tool = tools.find((t) => t.schema.name === "lark_raw_api")!;

    const result = await executeTool(tool, { method: "GET", path: "/open-apis/test" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("command not found");
  });

  it("returns error for raw_api with empty path", async () => {
    const tools = buildToolList();
    const tool = tools.find((t) => t.schema.name === "lark_raw_api")!;

    const result = await executeTool(tool, { method: "GET", path: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("path is required");
  });

  it("handles empty stdout gracefully", async () => {
    mockedExeca.mockResolvedValue({ stdout: "" } as any);
    const tools = buildToolList();
    const tool = tools.find((t) => t.schema.name === "lark_raw_api")!;

    const result = await executeTool(tool, { method: "GET", path: "/open-apis/test" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("ok");
  });
});
