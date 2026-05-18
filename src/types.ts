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

export interface McpTool {
  schema: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  def: ToolDef;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface TokenResult {
  token?: string;
  authUrl?: string;
}
