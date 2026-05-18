# lark-cli-mcp-wrapper

将 [lark-cli](https://github.com/larksuite/cli) 的 200+ 个命令封装为 [MCP](https://modelcontextprotocol.io/) stdio server，让 [Amazon Quick Desktop](https://aws.amazon.com/quick/desktop/) 等支持 MCP 的 AI 助手直接操作飞书/Lark。

配置完成后，你可以用自然语言让 AI 助手：

- 发送飞书消息、管理群聊
- 创建和查询日程、预订会议室
- 读写多维表格（Base）记录
- 操作云文档、知识库
- 管理审批、任务、邮件等

## 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [Git](https://git-scm.com/downloads)
- [`lark-cli`](https://github.com/larksuite/cli)

### macOS

```bash
brew install node git
```

### Ubuntu/Debian

> 注意：`apt` 默认源的 Node.js 版本可能低于 18，推荐使用 [nvm](https://github.com/nvm-sh/nvm) 安装。

```bash
# 方式一：nvm（推荐）
nvm install 18
```

```bash
# 方式二：apt（需确认版本 >= 18）
sudo apt install nodejs npm git
```

### Windows

从以下地址下载安装包：[Node.js](https://nodejs.org/)、[Git](https://git-scm.com/downloads)

### 安装并配置 lark-cli（所有平台）

```bash
npm install -g @larksuite/cli
```

```bash
lark-cli auth login
```

> 执行 `auth login` 后会打开浏览器进行 OAuth 授权，需要飞书管理员预先创建好应用并配置权限。详见 [lark-cli README](https://github.com/larksuite/cli#readme)。

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

> `npx github:user/repo` 会自动从 GitHub 拉取仓库并运行，无需手动 clone。Timeout 单位为秒，设为 300 是因为部分飞书 API 调用涉及网络请求，默认超时可能不够。

![Add MCP 配置](images/mcp-add-config.png)

### 验证

连接成功后，可以在 Capabilities → MCP 中看到 Lark CLI MCP Wrapper 显示为 **Connected**，并列出所有可用工具：

![MCP 连接成功](images/mcp-connected.png)

在 Quick Desktop 对话中输入类似以下内容测试：

```
帮我查一下今天的日程
```

如果 MCP 连接正常，AI 会调用 lark-cli 获取你的日历信息。

## 从源码构建（可选）

如需自定义工具列表或本地开发：

```bash
git clone https://github.com/ddpie/lark-cli-mcp-wrapper.git
cd lark-cli-mcp-wrapper
npm install
npm run generate-tools
npm run build
```

源码构建后，Quick Desktop 配置改为：

| 字段 | 值 |
|---|---|
| Command | `node` |
| Arguments | `/path/to/lark-cli-mcp-wrapper/dist/index.js` |

### 更新工具列表

`lark-cli` 升级后重新生成即可：

```bash
npm run generate-tools && npm run build
```

## License

MIT
