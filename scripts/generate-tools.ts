/**
 * Build-time script: invokes `lark-cli <service> <+shortcut> --help` for every
 * shortcut command and produces src/generated-tools.json with tool metadata.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../src/generated-tools.json");

interface ToolFlag {
  name: string;
  type: "string" | "boolean" | "number";
  description: string;
  required: boolean;
  enum?: string[];
}

interface ToolDef {
  service: string;
  command: string;
  description: string;
  risk: string;
  flags: ToolFlag[];
}

function run(...args: string[]): string {
  try {
    return execFileSync(args[0], args.slice(1), { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e: any) {
    return e.stdout ?? e.stderr ?? "";
  }
}

function discoverServices(): string[] {
  const help = run("lark-cli", "--help");
  const lines = help.split("\n");
  const services: string[] = [];
  let inCommands = false;
  for (const line of lines) {
    if (line.includes("Available Commands:")) {
      inCommands = true;
      continue;
    }
    if (inCommands) {
      if (line.trim() === "" || line.startsWith("Flags:") || line.startsWith("Use ")) break;
      const match = line.match(/^\s+(\S+)/);
      if (match) {
        const svc = match[1];
        if (!["api", "auth", "config", "doctor", "help", "profile", "schema", "update", "event"].includes(svc)) {
          services.push(svc);
        }
      }
    }
  }
  return services;
}

function discoverShortcuts(service: string): string[] {
  const help = run("lark-cli", service, "--help");
  const shortcuts: string[] = [];
  for (const line of help.split("\n")) {
    const match = line.match(/^\s+(\+\S+)/);
    if (match) {
      shortcuts.push(match[1]);
    }
  }
  return shortcuts;
}


// Check lark-cli is available
try {
  execFileSync("lark-cli", ["--version"], { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
} catch {
  console.error("Error: lark-cli not found. Install it first: npm install -g @larksuite/cli");
  process.exit(1);
}

console.log("Discovering lark-cli shortcuts...");
const services = discoverServices();
console.log(`Found ${services.length} services: ${services.join(", ")}`);

const allShortcuts: { service: string; shortcut: string }[] = [];
for (const service of services) {
  const shortcuts = discoverShortcuts(service);
  console.log(`  ${service}: ${shortcuts.length} shortcuts`);
  for (const shortcut of shortcuts) {
    allShortcuts.push({ service, shortcut });
  }
}

// Parse all shortcuts in parallel (batches of 20)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

async function parseShortcutHelpAsync(service: string, shortcut: string): Promise<ToolDef | null> {
  try {
    const { stdout } = await execFileAsync("lark-cli", [service, shortcut, "--help"], { timeout: 10000 });
    const help = stdout;
    if (!help.trim()) return null;

    const lines = help.split("\n");
    const description = lines[0]?.trim() ?? "";

    const flags: ToolFlag[] = [];
    let inFlags = false;
    for (const line of lines) {
      if (line.startsWith("Flags:")) {
        inFlags = true;
        continue;
      }
      if (inFlags) {
        if (line.trim() === "" || line.startsWith("Risk:")) break;
        const flagMatch = line.match(/(?:-\w,\s+)?--(\S+?)(?:\s+(\S+)\s+|\s+)(.*)/);
        if (flagMatch) {
          const [, name, typeHint, desc] = flagMatch;
          if (["help", "dry-run", "format", "jq", "as", "yes"].includes(name)) continue;
          const knownTypes = ["string", "int", "float", "duration", "stringArray", "strings"];
          const type = typeHint === "int" || typeHint === "float" ? "number"
            : typeHint && knownTypes.includes(typeHint) ? "string"
            : "boolean";
          flags.push({ name, type, description: desc.trim(), required: false });
        }
      }
    }

    const riskLine = lines.find((l) => l.startsWith("Risk:"));
    const risk = riskLine?.replace("Risk:", "").trim() ?? "read";

    return { service, command: shortcut, description, risk, flags };
  } catch {
    return null;
  }
}

async function generateAll() {
  const tools: ToolDef[] = [];
  const batchSize = 20;

  for (let i = 0; i < allShortcuts.length; i += batchSize) {
    const batch = allShortcuts.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(({ service, shortcut }) => parseShortcutHelpAsync(service, shortcut))
    );
    for (const tool of results) {
      if (tool) tools.push(tool);
    }
  }

  console.log(`\nGenerated ${tools.length} tool definitions`);
  writeFileSync(outPath, JSON.stringify(tools, null, 2));
  console.log(`Written to ${outPath}`);
}

await generateAll();
