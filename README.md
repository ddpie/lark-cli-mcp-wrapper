# lark-cli-mcp-wrapper

把 [lark-cli](https://github.com/larksuite/cli) 的 200+ 个命令包装为标准 stdio MCP server。

## 前置条件

- Node.js >= 18
- [`lark-cli`](https://github.com/larksuite/cli) 已安装并完成 `auth login`

## 安装

```bash
npm install -g github:ddpie/lark-cli-mcp-wrapper
```

或不全局安装，直接用 npx 启动：

```bash
npx github:ddpie/lark-cli-mcp-wrapper
```

### 从源码构建

```bash
git clone https://github.com/ddpie/lark-cli-mcp-wrapper.git
cd lark-cli-mcp-wrapper
npm install
npm run generate-tools
npm run build
```

## 使用

```bash
# 全局安装后
lark-cli-mcp-wrapper

# 或 npx
npx github:ddpie/lark-cli-mcp-wrapper

# 或源码构建后
node dist/index.js
```

### Amazon Quick Desktop 配置

Settings → Capabilities → MCP → **+ Add MCP**：

| 字段 | 值 |
|---|---|
| Connection type | Local |
| Name | Lark CLI |
| Command | `npx` |
| Arguments | `github:ddpie/lark-cli-mcp-wrapper` |

> 如果是从源码构建，Command 填 `node`，Arguments 填 `/path/to/lark-cli-mcp-wrapper/dist/index.js`。

## 更新工具列表

`lark-cli` 升级后重新生成即可，无需改代码：

```bash
npm run generate-tools && npm run build
```

## License

MIT
