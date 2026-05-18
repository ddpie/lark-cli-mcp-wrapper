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

function parseShortcutHelp(service: string, shortcut: string): ToolDef | null {
  const help = run("lark-cli", service, shortcut, "--help");
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
      // Parse flag lines like:
      //       --calendar-id string   calendar ID (default: primary)
      //       --dry-run              print request without executing
      //   -q, --jq string            jq expression to filter JSON output
      const flagMatch = line.match(/(?:-\w,\s+)?--(\S+?)(?:\s+(string|int)\s+|\s+)(.*)/);
      if (flagMatch) {
        const [, name, typeHint, desc] = flagMatch;
        // Skip framework flags that are always present or handled by the wrapper
        if (["help", "dry-run", "format", "jq", "as", "yes"].includes(name)) continue;
        const type = typeHint === "int" ? "number" : name === "dry-run" ? "boolean" : typeHint === "string" ? "string" : "boolean";
        flags.push({
          name,
          type,
          description: desc.trim(),
          required: false,
        });
      }
    }
  }

  // Extract risk level
  const riskLine = lines.find((l) => l.startsWith("Risk:"));
  const risk = riskLine?.replace("Risk:", "").trim() ?? "read";

  return { service, command: shortcut, description, risk, flags };
}

console.log("Discovering lark-cli shortcuts...");
const services = discoverServices();
console.log(`Found ${services.length} services: ${services.join(", ")}`);

const tools: ToolDef[] = [];

for (const service of services) {
  const shortcuts = discoverShortcuts(service);
  console.log(`  ${service}: ${shortcuts.length} shortcuts`);
  for (const shortcut of shortcuts) {
    const tool = parseShortcutHelp(service, shortcut);
    if (tool) {
      tools.push(tool);
    }
  }
}

// Mark required flags based on source code patterns (conservative: only --start/--end for calendar +create etc.)
for (const tool of tools) {
  if (tool.description.toLowerCase().includes("required")) {
    // parse from desc
  }
}

console.log(`\nGenerated ${tools.length} tool definitions`);
writeFileSync(outPath, JSON.stringify(tools, null, 2));
console.log(`Written to ${outPath}`);
