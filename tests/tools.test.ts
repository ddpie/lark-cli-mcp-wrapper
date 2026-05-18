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
});
