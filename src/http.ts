import type { Server as HttpServer } from "node:http";

export async function startHttp(): Promise<HttpServer> {
  throw new Error("HTTP transport not yet implemented");
}
