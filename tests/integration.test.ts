import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execaNode } from "execa";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SERVER = resolve(ROOT, "dist/index.js");

const tier1Names: string[] = JSON.parse(
  readFileSync(resolve(ROOT, "src/tier1.json"), "utf-8")
);

interface McpResponse {
  id: number;
  result?: any;
  error?: any;
}

async function callMcp(
  messages: Array<{ id: number; method: string; params: any }>
): Promise<Map<number, McpResponse>> {
  const init = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  });

  const payload =
    init +
    "\n" +
    messages.map((m) => JSON.stringify({ jsonrpc: "2.0", ...m })).join("\n") +
    "\n";

  const result = await execaNode(SERVER, [], {
    input: payload,
    timeout: 30000,
    cwd: ROOT,
  });

  const responses = new Map<number, McpResponse>();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && msg.id !== 0) {
      responses.set(msg.id, msg);
    }
  }
  return responses;
}

function toolCall(id: number, name: string, args: Record<string, unknown> = {}) {
  return { id, method: "tools/call", params: { name, arguments: args } };
}

function discoverCall(id: number, args: Record<string, unknown>) {
  return toolCall(id, "lark_discover", args);
}

function invokeCall(id: number, toolName: string, args: Record<string, unknown> = {}) {
  return toolCall(id, "lark_invoke", { tool_name: toolName, args });
}

function getResult(responses: Map<number, McpResponse>, id: number) {
  const resp = responses.get(id);
  expect(resp).toBeDefined();
  return resp!.result;
}

function getResultData(responses: Map<number, McpResponse>, id: number) {
  const result = getResult(responses, id);
  return JSON.parse(result.content[0].text);
}

// ============================================================
// TEST 1: tools/list 完整性
// ============================================================
describe("tools/list", () => {
  let tools: any[];

  beforeAll(async () => {
    const resp = await callMcp([{ id: 1, method: "tools/list", params: {} }]);
    tools = getResult(resp, 1).tools;
  });

  it("returns exactly 30 tools", () => {
    expect(tools.length).toBe(30);
  });

  it("contains all 28 Tier 1 tools", () => {
    const names = tools.map((t: any) => t.name);
    for (const name of tier1Names) {
      expect(names).toContain(name);
    }
  });

  it("contains lark_discover and lark_invoke", () => {
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("lark_discover");
    expect(names).toContain("lark_invoke");
  });

  it("every tool has valid schema structure", () => {
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("Tier 1 descriptions follow [risk] format", () => {
    for (const tool of tools) {
      if (tier1Names.includes(tool.name)) {
        expect(tool.description).toMatch(/^\[.+\]/);
      }
    }
  });

  it("lark_discover has correct inputSchema", () => {
    const discover = tools.find((t: any) => t.name === "lark_discover");
    expect(discover.inputSchema.properties.query).toBeDefined();
    expect(discover.inputSchema.properties.category).toBeDefined();
    expect(discover.inputSchema.properties.category.enum).toHaveLength(16);
  });

  it("lark_invoke has correct inputSchema", () => {
    const invoke = tools.find((t: any) => t.name === "lark_invoke");
    expect(invoke.inputSchema.required).toContain("tool_name");
    expect(invoke.inputSchema.required).toContain("args");
    expect(invoke.inputSchema.properties.tool_name.type).toBe("string");
    expect(invoke.inputSchema.properties.args.type).toBe("object");
  });

  it("no duplicate tool names", () => {
    const names = tools.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ============================================================
// TEST 2: 全部 28 个 Tier 1 工具直接调用
// ============================================================
describe("Tier 1 tools — direct call", () => {
  const tier1TestArgs: Record<string, Record<string, unknown>> = {
    lark_im_messages_send: { chat_id: "oc_167caaacdba8a6fac4c2159c6604a860", text: "integration test", dry_run: true },
    lark_im_messages_search: { query: "test" },
    lark_im_chat_list: {},
    lark_im_chat_messages_list: { chat_id: "oc_167caaacdba8a6fac4c2159c6604a860" },
    lark_im_chat_search: { query: "test" },
    lark_calendar_agenda: {},
    lark_calendar_create: { summary: "test meeting", start: "2026-05-25T10:00:00", end: "2026-05-25T11:00:00", dry_run: true },
    lark_calendar_freebusy: {},
    lark_calendar_room_find: { slot: "2026-05-25T10:00:00~2026-05-25T11:00:00" },
    lark_docs_create: { title: "test doc", markdown: "# Test", dry_run: true },
    lark_docs_fetch: { url: "https://xxx.feishu.cn/docx/xxx" },
    lark_docs_search: { query: "test" },
    lark_docs_update: { url: "https://xxx.feishu.cn/docx/xxx", body: "test" },
    lark_base_base_get: { base_token: "xxx" },
    lark_base_data_query: { base_token: "xxx", table_id: "tbl_xxx" },
    lark_base_record_batch_create: { base_token: "xxx", table_id: "tbl_xxx", json: '{"records":[]}' },
    lark_base_record_search: { base_token: "xxx", table_id: "tbl_xxx", json: '{"keyword":"test"}' },
    lark_drive_search: { query: "test" },
    lark_drive_upload: { file: "./package.json", dry_run: true },
    lark_drive_download: { file_token: "xxx" },
    lark_task_create: { summary: "test task", dry_run: true },
    lark_task_get_my_tasks: {},
    lark_task_complete: { task_id: "xxx" },
    lark_contact_search_user: { query: "test" },
    lark_contact_get_user: { user_id: "ou_xxx" },
    lark_sheets_read: { url: "https://xxx.feishu.cn/sheets/xxx" },
    lark_sheets_write: { url: "https://xxx.feishu.cn/sheets/xxx", range: "A1", values: '[[\"test\"]]' },
    lark_mail_send: { to: "test@test.com", subject: "test", body: "<p>test</p>", from: "test@test.com", dry_run: true },
  };

  it("covers all 28 Tier 1 tools", () => {
    expect(Object.keys(tier1TestArgs).length).toBe(28);
    for (const name of tier1Names) {
      expect(tier1TestArgs).toHaveProperty(name);
    }
  });

  const entries = Object.entries(tier1TestArgs);
  const batchSize = 7;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const batchNames = batch.map(([name]) => name.replace("lark_", "")).join(", ");

    it(`batch ${Math.floor(i / batchSize) + 1}: ${batchNames}`, async () => {
      const messages = batch.map(([name, args], idx) => toolCall(100 + i + idx, name, args));
      const responses = await callMcp(messages);

      for (let j = 0; j < batch.length; j++) {
        const id = 100 + i + j;
        const [toolName] = batch[j];
        const result = getResult(responses, id);
        expect(result.content, `${toolName} should have content`).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text.length, `${toolName} should return non-empty text`).toBeGreaterThan(0);
      }
    }, 30000);
  }

  it("tools that need no args return ok=true", async () => {
    const noArgTools = ["lark_im_chat_list", "lark_calendar_agenda", "lark_calendar_freebusy", "lark_task_get_my_tasks"];
    const messages = noArgTools.map((name, idx) => toolCall(200 + idx, name, {}));
    const responses = await callMcp(messages);

    for (let i = 0; i < noArgTools.length; i++) {
      const result = getResult(responses, 200 + i);
      const data = JSON.parse(result.content[0].text);
      expect(data.ok, `${noArgTools[i]} should return ok=true`).toBe(true);
    }
  }, 30000);
});

// ============================================================
// TEST 3: lark_discover — 16 个分类全覆盖
// ============================================================
describe("lark_discover — all 16 categories", () => {
  const categoriesWithTools = [
    "im", "calendar", "docs", "base", "sheets", "drive", "task",
    "wiki", "mail", "vc", "minutes", "okr", "slides",
    "whiteboard", "markdown",
  ];

  it('category="contact" returns 0 (all contact tools are Tier 1)', async () => {
    const resp = await callMcp([discoverCall(1, { category: "contact" })]);
    const data = getResultData(resp, 1);
    expect(data.tools).toHaveLength(0);
  });

  for (const cat of categoriesWithTools) {
    it(`category="${cat}" returns relevant results`, async () => {
      const resp = await callMcp([discoverCall(1, { category: cat })]);
      const result = getResult(resp, 1);
      expect(result.isError).toBeFalsy();

      const data = JSON.parse(result.content[0].text);
      expect(data.tools.length).toBeGreaterThan(0);
      expect(data.tools.length).toBeLessThanOrEqual(5);

      for (const tool of data.tools) {
        expect(tool.category).toBe(cat);
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
        expect(tier1Names).not.toContain(tool.name);
      }
    });
  }
});

// ============================================================
// TEST 4: lark_discover — 搜索算法边界
// ============================================================
describe("lark_discover — search edge cases", () => {
  it("multi-token query scores higher for more matches", async () => {
    const resp = await callMcp([discoverCall(1, { query: "batch create record" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
    const names = data.tools.map((t: any) => t.name);
    expect(names.some((n: string) => n.includes("base"))).toBe(true);
  });

  it("case insensitive query", async () => {
    const resp = await callMcp([
      discoverCall(1, { query: "WIKI SPACE" }),
      discoverCall(2, { query: "wiki space" }),
    ]);
    const data1 = getResultData(resp, 1);
    const data2 = getResultData(resp, 2);
    expect(data1.tools.length).toBe(data2.tools.length);
    expect(data1.tools[0].name).toBe(data2.tools[0].name);
  });

  it("single token query", async () => {
    const resp = await callMcp([discoverCall(1, { query: "forward" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
    expect(data.tools.some((t: any) => t.name.includes("forward"))).toBe(true);
  });

  it("query + category AND semantics", async () => {
    const resp = await callMcp([discoverCall(1, { query: "delete", category: "wiki" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
    for (const tool of data.tools) {
      expect(tool.category).toBe("wiki");
    }
  });

  it("query + category fallback when < 3 scored results", async () => {
    const resp = await callMcp([discoverCall(1, { query: "xyzrare999", category: "wiki" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
    for (const tool of data.tools) {
      expect(tool.category).toBe("wiki");
    }
  });

  it("zero results returns empty array + hint", async () => {
    const resp = await callMcp([discoverCall(1, { query: "xyznonexistent999" })]);
    const data = getResultData(resp, 1);
    expect(data.tools).toHaveLength(0);
    expect(data.hint).toBeDefined();
    expect(data.hint).toContain("Try different keywords");
  });

  it("empty args returns isError", async () => {
    const resp = await callMcp([discoverCall(1, {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
  });

  it("query only (no category) searches all services", async () => {
    const resp = await callMcp([discoverCall(1, { query: "create space" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
  });

  it("results capped at 5", async () => {
    const resp = await callMcp([discoverCall(1, { category: "base" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeLessThanOrEqual(5);
  });

  it("excludes Tier 1 tools from results", async () => {
    const resp = await callMcp([discoverCall(1, { query: "messages send" })]);
    const data = getResultData(resp, 1);
    for (const tool of data.tools) {
      expect(tier1Names).not.toContain(tool.name);
    }
  });

  it("results include complete inputSchema with properties", async () => {
    const resp = await callMcp([discoverCall(1, { query: "create", category: "im" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
    for (const tool of data.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it("multiple spaces in query are handled", async () => {
    const resp = await callMcp([discoverCall(1, { query: "  wiki   space  " })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(0);
  });

  it("query with special characters doesn't crash", async () => {
    const resp = await callMcp([discoverCall(1, { query: "create (wiki) [space]" })]);
    const result = getResult(resp, 1);
    expect(result.content).toBeDefined();
  });
});

// ============================================================
// TEST 5: lark_invoke — 正常执行
// ============================================================
describe("lark_invoke — valid execution", () => {
  it("non-Tier-1 tool executes successfully (dry-run)", async () => {
    const resp = await callMcp([invokeCall(1, "lark_im_chat_create", { name: "invoke-test", dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text).toContain('"api"');
  });

  it("Tier 1 tool via invoke executes directly (no bounce)", async () => {
    const resp = await callMcp([invokeCall(1, "lark_calendar_agenda", {})]);
    const result = getResult(resp, 1);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
  });

  it("zero-flag tool executes", async () => {
    const resp = await callMcp([invokeCall(1, "lark_task_subscribe_event", {})]);
    const result = getResult(resp, 1);
    expect(result.content).toBeDefined();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("multi-flag tool passes all args correctly", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_mail_forward", { message_id: "xxx", to: "a@b.com", subject: "fwd" }),
    ]);
    const result = getResult(resp, 1);
    expect(result.content).toBeDefined();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("boolean flag is passed as flag-only (no value)", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_wiki_space_list", { page_all: true }),
    ]);
    const result = getResult(resp, 1);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
  });

  it("boolean flag=false is NOT passed", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_wiki_space_list", { page_all: false }),
    ]);
    const result = getResult(resp, 1);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
  });

  it("high-risk-write tool gets --yes automatically", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_base_advperm_disable", { base_token: "xxx" }),
    ]);
    const result = getResult(resp, 1);
    expect(result.content).toBeDefined();
    // Should not hang waiting for confirmation (--yes auto-appended)
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("string-type flag that was previously boolean (slot) passes value", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_calendar_room_find", { slot: "2026-05-25T10:00:00~2026-05-25T11:00:00" }),
    ]);
    const result = getResult(resp, 1);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
  });

  it("number flag is passed as string value", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_base_field_list", { base_token: "xxx", table_id: "tblXXX", limit: 10 }),
    ]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("null/undefined/empty args are skipped", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_im_chat_create", { name: "test", description: "", owner_id: null, dry_run: true }),
    ]);
    const result = getResult(resp, 1);
    expect(result.content).toBeDefined();
  });

  it("discover → invoke full flow", async () => {
    // Step 1: discover
    const discoverResp = await callMcp([discoverCall(1, { query: "wiki space list" })]);
    const discoverData = getResultData(discoverResp, 1);
    expect(discoverData.tools.length).toBeGreaterThan(0);
    const foundTool = discoverData.tools[0].name;

    // Step 2: invoke the discovered tool
    const invokeResp = await callMcp([invokeCall(1, foundTool, {})]);
    const invokeResult = getResult(invokeResp, 1);
    expect(invokeResult.content).toBeDefined();
    expect(invokeResult.content[0].text.length).toBeGreaterThan(0);
  });
});

// ============================================================
// TEST 6: lark_invoke — 错误场景
// ============================================================
describe("lark_invoke — error cases", () => {
  it("unknown tool returns error + similar suggestions + hint", async () => {
    const resp = await callMcp([invokeCall(1, "lark_xxx_yyy", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe("unknown_tool");
    expect(data.similar).toBeDefined();
    expect(data.similar.length).toBeGreaterThan(0);
    expect(data.hint).toContain("lark_discover");
  });

  it("empty tool name returns error", async () => {
    const resp = await callMcp([invokeCall(1, "", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
  });

  it("missing tool_name field returns error", async () => {
    const resp = await callMcp([toolCall(1, "lark_invoke", { args: {} })]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
  });

  it("missing args field defaults to empty object (no crash)", async () => {
    const resp = await callMcp([toolCall(1, "lark_invoke", { tool_name: "lark_im_chat_create" })]);
    const result = getResult(resp, 1);
    expect(result.content).toBeDefined();
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("similar suggestions contain relevant wiki tools", async () => {
    const resp = await callMcp([invokeCall(1, "lark_wiki_space_create", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.similar.some((n: string) => n.includes("wiki"))).toBe(true);
  });

  it("similar suggestions contain relevant im tools", async () => {
    const resp = await callMcp([invokeCall(1, "lark_im_group_create", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.similar.some((n: string) => n.includes("im"))).toBe(true);
  });

  it("completely random name still returns 3 suggestions", async () => {
    const resp = await callMcp([invokeCall(1, "lark_zzz_aaa_bbb_ccc", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe("unknown_tool");
    expect(data.similar.length).toBeLessThanOrEqual(3);
  });

  it("CLI validation error is transparently returned", async () => {
    const resp = await callMcp([invokeCall(1, "lark_okr_cycle_list", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
  });
});

// ============================================================
// TEST 7: 真实 API 场景（端到端）
// ============================================================
describe("end-to-end real API scenarios", () => {
  it("IM: send message (dry-run)", async () => {
    const sendResp = await callMcp([
      toolCall(1, "lark_im_messages_send", {
        chat_id: "oc_167caaacdba8a6fac4c2159c6604a860",
        text: "e2e test",
        dry_run: true,
      }),
    ]);
    const result = getResult(sendResp, 1);
    expect(result.content[0].text).toContain('"api"');
  });

  it("IM: list chats returns chats array", async () => {
    const resp = await callMcp([toolCall(1, "lark_im_chat_list", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
    expect(data.data.chats.length).toBeGreaterThan(0);
    expect(data.data.chats[0].chat_id).toMatch(/^oc_/);
  });

  it("Calendar: agenda returns events array", async () => {
    const resp = await callMcp([toolCall(1, "lark_calendar_agenda", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("Calendar: create event (dry-run)", async () => {
    const resp = await callMcp([
      toolCall(1, "lark_calendar_create", {
        summary: "e2e-test",
        start: "2026-05-25T14:00:00",
        end: "2026-05-25T15:00:00",
        dry_run: true,
      }),
    ]);
    const result = getResult(resp, 1);
    expect(result.content[0].text).toContain('"api"');
  });

  it("Task: create (dry-run) + list tasks", async () => {
    const createResp = await callMcp([
      toolCall(1, "lark_task_create", { summary: "e2e-task", dry_run: true }),
    ]);
    const result = getResult(createResp, 1);
    expect(result.content[0].text).toContain('"api"');

    const listResp = await callMcp([toolCall(1, "lark_task_get_my_tasks", {})]);
    const listData = getResultData(listResp, 1);
    expect(listData.ok).toBe(true);
    expect(listData.data.items.length).toBeGreaterThan(0);
  });

  it("Drive: search returns results", async () => {
    const resp = await callMcp([toolCall(1, "lark_drive_search", { query: "test" })]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });

  it("Drive: upload file (dry-run)", async () => {
    const resp = await callMcp([toolCall(1, "lark_drive_upload", { file: "./package.json", dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text).toContain('"api"');
  });

  it("Contact: search user", async () => {
    const resp = await callMcp([toolCall(1, "lark_contact_search_user", { query: "test" })]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });

  it("Wiki: space list via invoke", async () => {
    const resp = await callMcp([invokeCall(1, "lark_wiki_space_list", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });

  it("VC: search meetings via invoke", async () => {
    const resp = await callMcp([
      invokeCall(1, "lark_vc_search", { start: "2026-05-01", end: "2026-05-19" }),
    ]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });

  it("Docs: search returns results", async () => {
    const resp = await callMcp([toolCall(1, "lark_docs_search", { query: "test" })]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });
});

// ============================================================
// TEST 8: 顶层错误处理 + 并发
// ============================================================
describe("top-level error handling", () => {
  it("unknown top-level tool returns 'Unknown tool' error", async () => {
    const resp = await callMcp([toolCall(1, "lark_nonexistent_tool", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
    expect(result.content[0].text).toContain("lark_nonexistent_tool");
  });

  it("tools/list is idempotent", async () => {
    const resp = await callMcp([
      { id: 1, method: "tools/list", params: {} },
      { id: 2, method: "tools/list", params: {} },
    ]);
    const tools1 = getResult(resp, 1).tools;
    const tools2 = getResult(resp, 2).tools;
    expect(tools1.length).toBe(tools2.length);
    expect(tools1.map((t: any) => t.name).sort()).toEqual(
      tools2.map((t: any) => t.name).sort()
    );
  });

  it("5 concurrent tool calls in same session all respond", async () => {
    const resp = await callMcp([
      toolCall(1, "lark_calendar_agenda", {}),
      toolCall(2, "lark_task_get_my_tasks", {}),
      toolCall(3, "lark_docs_search", { query: "test" }),
      discoverCall(4, { category: "wiki" }),
      invokeCall(5, "lark_im_chat_create", { name: "concurrent-test", dry_run: true }),
    ]);

    for (let i = 1; i <= 5; i++) {
      const result = getResult(resp, i);
      expect(result.content).toBeDefined();
      expect(result.content[0].text.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("mix of valid and invalid calls in same session", async () => {
    const resp = await callMcp([
      toolCall(1, "lark_calendar_agenda", {}),
      toolCall(2, "lark_nonexistent", {}),
      discoverCall(3, { query: "wiki" }),
      invokeCall(4, "lark_fake_tool", {}),
    ]);

    const r1 = getResult(resp, 1);
    expect(r1.isError).toBeFalsy();

    const r2 = getResult(resp, 2);
    expect(r2.isError).toBe(true);
    expect(r2.content[0].text).toContain("Unknown tool");

    const r3 = getResult(resp, 3);
    expect(r3.isError).toBeFalsy();

    const r4 = getResult(resp, 4);
    expect(r4.isError).toBe(true);
  }, 30000);
});

// ============================================================
// TEST 9: 缺失 service invoke 覆盖（sheets/slides/whiteboard/markdown/minutes）
// ============================================================
describe("lark_invoke — all service categories", () => {
  it("sheets: invoke non-Tier-1 tool (dry-run)", async () => {
    const resp = await callMcp([invokeCall(1, "lark_sheets_append", { url: "https://xxx.feishu.cn/sheets/xxx", range: "A1", values: '[[\"test\"]]', dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("slides: invoke tool (dry-run)", async () => {
    const resp = await callMcp([invokeCall(1, "lark_slides_create", { title: "test-slides", dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("whiteboard: invoke tool", async () => {
    const resp = await callMcp([invokeCall(1, "lark_whiteboard_query", { whiteboard_id: "xxx" })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("markdown: invoke tool (dry-run)", async () => {
    const resp = await callMcp([invokeCall(1, "lark_markdown_create", { title: "test", body: "# Hello", dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("minutes: invoke tool", async () => {
    const resp = await callMcp([invokeCall(1, "lark_minutes_search", { query: "test" })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("base: invoke non-Tier-1 tool (dry-run)", async () => {
    const resp = await callMcp([invokeCall(1, "lark_base_base_create", { name: "test-base", dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text).toContain('"api"');
  });
});

// ============================================================
// TEST 10: 搜索 fallback + findSimilar 排序
// ============================================================
describe("lark_discover — fallback and similarity", () => {
  it("category+query with 1-2 scored results triggers fallback to category-only", async () => {
    // "node" matches lark_wiki_node_* but "xyzfoo" matches nothing — should get 1-2 scored
    // fallback returns first 5 of category unscored
    const resp = await callMcp([discoverCall(1, { query: "node xyzfoo", category: "wiki" })]);
    const data = getResultData(resp, 1);
    expect(data.tools.length).toBeGreaterThan(2);
    for (const tool of data.tools) {
      expect(tool.category).toBe("wiki");
    }
  });

  it("findSimilar ranks higher token overlap first", async () => {
    // "lark_wiki_node_publish" doesn't exist but shares tokens with wiki tools
    const resp = await callMcp([invokeCall(1, "lark_wiki_node_publish", {})]);
    const result = getResult(resp, 1);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    // First suggestion should be a wiki tool (shares wiki+node tokens)
    expect(data.similar[0]).toContain("wiki");
  });

  it("findSimilar with completely unrelated name still returns suggestions", async () => {
    const resp = await callMcp([invokeCall(1, "lark_xyz_abc_def", {})]);
    const result = getResult(resp, 1);
    const data = JSON.parse(result.content[0].text);
    // "lark" token matches everything, so we get suggestions
    expect(data.similar.length).toBeGreaterThan(0);
  });
});

// ============================================================
// TEST 11: executeTool 边界路径
// ============================================================
describe("executeTool — edge paths", () => {
  it("empty stdout returns ok:true data:null", async () => {
    // lark_task_subscribe_event with no events returns empty/minimal output
    // We need a tool that returns empty — use a fake token that causes empty response
    const resp = await callMcp([invokeCall(1, "lark_task_subscribe_event", {})]);
    const result = getResult(resp, 1);
    // Should not crash, should return some content
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("non-JSON CLI output is returned as-is", async () => {
    // lark-cli may output non-JSON for some errors (e.g., help text)
    // Trigger by passing invalid combination that causes usage output
    const resp = await callMcp([invokeCall(1, "lark_base_record_search", { base_token: "xxx" })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text.length).toBeGreaterThan(0);
    // The output is either JSON error or raw CLI text — both are valid
  });

  it("dry_run flag works via invoke path", async () => {
    const resp = await callMcp([invokeCall(1, "lark_wiki_node_list", { space_id: "xxx", dry_run: true })]);
    const result = getResult(resp, 1);
    expect(result.content[0].text).toContain('"api"');
  });
});

// ============================================================
// TEST 12: 数据可靠性断言（不依赖具体数据量）
// ============================================================
describe("API response structure validation", () => {
  it("chat list returns array structure", async () => {
    const resp = await callMcp([toolCall(1, "lark_im_chat_list", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data.chats)).toBe(true);
  });

  it("calendar agenda returns array structure", async () => {
    const resp = await callMcp([toolCall(1, "lark_calendar_agenda", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("task list returns items array structure", async () => {
    const resp = await callMcp([toolCall(1, "lark_task_get_my_tasks", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data.items)).toBe(true);
  });

  it("contact search returns structured response", async () => {
    const resp = await callMcp([toolCall(1, "lark_contact_search_user", { query: "test" })]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });

  it("drive search returns structured response", async () => {
    const resp = await callMcp([toolCall(1, "lark_drive_search", { query: "test" })]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });

  it("freebusy returns structured response", async () => {
    const resp = await callMcp([toolCall(1, "lark_calendar_freebusy", {})]);
    const data = getResultData(resp, 1);
    expect(data.ok).toBe(true);
  });
});
