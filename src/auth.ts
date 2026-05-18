import {
  BedrockAgentCoreClient,
  GetResourceOauth2TokenCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { TokenResult } from "./types.js";

const PROVIDER_NAME = process.env.OAUTH_PROVIDER_NAME ?? "feishu-oauth-provider";
const REGION = process.env.AWS_REGION ?? "us-east-1";
const CALLBACK_URL = process.env.OAUTH_CALLBACK_URL ?? "";
const SCOPES = (process.env.OAUTH_SCOPES ?? "").split(",").filter(Boolean);
const CACHE_TTL_MS = 110 * 60 * 1000; // 110 minutes (token is ~2h, refresh early)
const CACHE_MAX_SIZE = 1000;

let client: BedrockAgentCoreClient | null = null;

function getClient(): BedrockAgentCoreClient {
  if (!client) {
    client = new BedrockAgentCoreClient({ region: REGION });
  }
  return client;
}

interface CacheEntry {
  token: string;
  expiresAt: number;
  lastAccess: number;
}

const tokenCache = new Map<string, CacheEntry>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

function getCached(key: string): string | null {
  const entry = tokenCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tokenCache.delete(key);
    return null;
  }
  entry.lastAccess = Date.now();
  return entry.token;
}

function setCache(key: string, token: string): void {
  if (tokenCache.size >= CACHE_MAX_SIZE) {
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [k, v] of tokenCache) {
      if (v.lastAccess < lruTime) {
        lruTime = v.lastAccess;
        lruKey = k;
      }
    }
    if (lruKey) tokenCache.delete(lruKey);
  }
  tokenCache.set(key, { token, expiresAt: Date.now() + CACHE_TTL_MS, lastAccess: Date.now() });
}

export async function resolveUserToken(workloadAccessToken: string): Promise<TokenResult> {
  if (!workloadAccessToken) {
    throw new Error("WorkloadAccessToken is required for user identity resolution");
  }

  const cached = getCached(workloadAccessToken);
  if (cached) {
    return { token: cached };
  }

  let response;
  try {
    const command = new GetResourceOauth2TokenCommand({
      resourceCredentialProviderName: PROVIDER_NAME,
      scopes: SCOPES.length > 0 ? SCOPES : undefined,
      oauth2Flow: "USER_FEDERATION",
      workloadIdentityToken: workloadAccessToken,
      resourceOauth2ReturnUrl: CALLBACK_URL || undefined,
    });
    response = await getClient().send(command);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[auth] AgentCore Identity error: ${msg}\n`);
    throw new Error("Failed to resolve user token from AgentCore Identity");
  }

  if (response.accessToken) {
    setCache(workloadAccessToken, response.accessToken);
    return { token: response.accessToken };
  }

  if (response.authorizationUrl) {
    return { authUrl: response.authorizationUrl };
  }

  throw new Error("AgentCore Identity returned neither accessToken nor authorizationUrl");
}
