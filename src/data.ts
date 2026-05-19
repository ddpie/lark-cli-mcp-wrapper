import { readFileSync } from "node:fs";

export interface ToolFlag {
  name: string;
  type: "string" | "boolean" | "number";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolDef {
  service: string;
  command: string;
  description: string;
  risk: string;
  flags: ToolFlag[];
}

export const toolDefs: ToolDef[] = JSON.parse(
  readFileSync(new URL("./generated-tools.json", import.meta.url), "utf-8")
);

export const tier1Names: string[] = JSON.parse(
  readFileSync(new URL("./tier1.json", import.meta.url), "utf-8")
);

export function toToolName(def: ToolDef): string {
  const cmd = def.command.replace(/^\+/, "");
  return `lark_${def.service}_${cmd.replace(/-/g, "_")}`;
}

export function toSchemaKey(flagName: string): string {
  return flagName.replace(/-/g, "_");
}
