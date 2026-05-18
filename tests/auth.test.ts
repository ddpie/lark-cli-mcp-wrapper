import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();
vi.mock("@aws-sdk/client-bedrock-agentcore", () => ({
  BedrockAgentCoreClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  GetResourceOauth2TokenCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

import { resolveUserToken, clearTokenCache } from "../src/auth.js";

describe("resolveUserToken", () => {
  beforeEach(() => {
    mockSend.mockReset();
    clearTokenCache();
  });

  it("returns token when Token Vault has a cached token", async () => {
    mockSend.mockResolvedValue({ accessToken: "feishu-access-token-xyz" });

    const result = await resolveUserToken("workload-jwt-abc");

    expect(result).toEqual({ token: "feishu-access-token-xyz" });
  });

  it("returns authUrl when user consent is needed", async () => {
    mockSend.mockResolvedValue({ authorizationUrl: "https://open.feishu.cn/authen/..." });

    const result = await resolveUserToken("workload-jwt-abc");

    expect(result).toEqual({ authUrl: "https://open.feishu.cn/authen/..." });
  });

  it("throws when workloadToken is empty", async () => {
    await expect(resolveUserToken("")).rejects.toThrow("WorkloadAccessToken is required");
  });

  it("uses in-memory cache on repeated calls with same workloadToken", async () => {
    mockSend.mockResolvedValue({ accessToken: "cached-token" });

    await resolveUserToken("same-jwt");
    await resolveUserToken("same-jwt");

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("calls API again after cache is cleared", async () => {
    mockSend.mockResolvedValue({ accessToken: "token-1" });
    await resolveUserToken("jwt-1");

    clearTokenCache();
    mockSend.mockResolvedValue({ accessToken: "token-2" });
    const result = await resolveUserToken("jwt-1");

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ token: "token-2" });
  });

  it("does not cache authUrl responses", async () => {
    mockSend.mockResolvedValue({ authorizationUrl: "https://auth.example.com" });
    await resolveUserToken("jwt-needs-auth");

    mockSend.mockResolvedValue({ accessToken: "now-has-token" });
    const result = await resolveUserToken("jwt-needs-auth");

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ token: "now-has-token" });
  });
});
