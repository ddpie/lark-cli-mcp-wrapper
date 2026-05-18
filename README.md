# lark-cli-mcp-wrapper

将 [lark-cli](https://github.com/larksuite/cli) 的 200+ 个命令封装为 [MCP](https://modelcontextprotocol.io/) stdio server，让 [Amazon Quick Desktop](https://aws.amazon.com/quick/desktop/) 等支持 MCP 的 AI 助手直接操作飞书/Lark：发消息、管理日历、读写多维表格、操作云文档等。

## 前置条件

- Node.js >= 18
- Git
  - macOS: `brew install git`
  - Ubuntu/Debian: `sudo apt install git`
  - Windows: 从 https://git-scm.com/downloads 下载安装
- [`lark-cli`](https://github.com/larksuite/cli) 已安装并完成 `auth login`（配置文档见 [lark-cli README](https://github.com/larksuite/cli#readme)）

## 使用

### Amazon Quick Desktop 配置

Settings → Capabilities → MCP → **+ Add MCP**：

| 字段 | 值 |
|---|---|
| Connection type | Local |
| Name | Lark CLI MCP Wrapper |
| Command | `npx` |
| Arguments | `github:ddpie/lark-cli-mcp-wrapper` |
| Timeout | `300` |

## 从源码构建（可选）

如需自定义工具列表或本地开发：

```bash
git clone https://github.com/ddpie/lark-cli-mcp-wrapper.git
cd lark-cli-mcp-wrapper
npm install
npm run generate-tools
npm run build
node dist/index.js
```

### 更新工具列表

`lark-cli` 升级后重新生成即可：

```bash
npm run generate-tools && npm run build
```

## License

MIT
