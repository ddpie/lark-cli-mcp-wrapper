/**
 * Build-time script: generates src/generated-tools.json from local lark-cli.
 * Also used by the runtime auto-regeneration in src/data.ts.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTools, getLarkCliVersion } from "../src/generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../src/generated-tools.json");

const version = getLarkCliVersion();
if (!version) {
  console.error("Error: lark-cli not found. Install it first: npm install -g @larksuite/cli");
  process.exit(1);
}

console.log(`lark-cli version: ${version}`);
console.log("Generating tools...");
await generateTools(outPath);
console.log("Done.");
