# lark-cli-mcp-wrapper

将 [lark-cli](https://github.com/larksuite/cli) 的 200+ 个命令封装为 [MCP](https://modelcontextprotocol.io/) stdio server，让 [Amazon Quick Desktop](https://aws.amazon.com/quick/desktop/) 等支持 MCP 的 AI 助手直接操作飞书/Lark。

28 个高频工具直接注册，其余通过 `lark_discover` + `lark_invoke` 按需调用，共 30 个 MCP tools。安装时自动扫描本地 lark-cli 生成工具定义，确保版本完全匹配。

配置完成后，你可以用自然语言让 AI 助手：

- 发送飞书消息、管理群聊
- 创建和查询日程、预订会议室
- 读写多维表格（Base）记录
- 操作云文档、知识库
- 管理审批、任务、邮件等
- 通过 discover/invoke 调用全部 200+ 个 lark-cli 命令

## 为什么用这个？

| | 本项目 | 传统方案 |
|---|---|---|
| 工具数量 | 200+（全部 lark-cli 命令） | 通常 4-85 个 |
| 使用方式 | npx 直接运行，无需克隆代码，无需额外启动服务 | 需克隆仓库、安装依赖、手动启动 |
| 新命令支持 | 安装时自动适配本地 lark-cli 版本 | 需等待项目更新 |
| 认证 | 复用 lark-cli 登录态 | 需单独配置 App 凭证 |
| AI 交互 | 分层架构：高频直达 + 低频按需发现 | 全部工具平铺注入 context |

## 快速安装（仅 macOS）

一键检查并安装所有依赖，引导完成配置：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ddpie/lark-cli-mcp-wrapper/master/scripts/setup.sh)
```

## 手动安装

### 前置条件

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
| Arguments | `lark-cli-mcp-wrapper` |
| Timeout | `300` |

> `npx github:user/repo` 会自动从 GitHub 拉取仓库并运行，无需手动 clone。首次启动需拉取和编译，Timeout 建议设为 300。

<img src="images/mcp-add-config.png" width="400" alt="Add MCP 配置">

### 验证

连接成功后，可以在 Capabilities → MCP 中看到 Lark CLI MCP Wrapper 显示为 **Connected**，并列出 30 个可用工具：

![MCP 连接成功](images/mcp-connected.png)

在 Quick Desktop 对话中输入类似以下内容测试：

```
帮我查一下今天的日程
```

如果 MCP 连接正常，AI 会调用 lark-cli 获取你的日历信息。

## 工具列表

### Tier 1 高频工具（28 个，直接注册）

| 类别 | 工具 |
|---|---|
| IM (5) | 发消息、搜索消息、群列表、聊天记录、搜索群 |
| Calendar (4) | 日程概览、创建日程、查忙闲、找会议室 |
| Docs (4) | 创建、获取、搜索、编辑文档 |
| Base (4) | 获取表、查询数据、批量创建记录、搜索记录 |
| Drive (3) | 搜索、上传、下载文件 |
| Task (3) | 创建任务、我的任务、完成任务 |
| Contact (2) | 搜索用户、获取用户信息 |
| Sheets (2) | 读取、写入单元格 |
| Mail (1) | 发送邮件 |

### Meta Tools（2 个）

| 工具 | 说明 |
|---|---|
| `lark_discover` | 按关键词或分类搜索其余所有 lark-cli 命令，返回名称 + 完整参数 schema |
| `lark_invoke` | 执行 discover 找到的工具（传入 tool_name + args） |

高频操作直接调用即可；其余操作 AI 会自动通过 discover 搜索再 invoke 执行，无需额外配置。

### Tier 2 工具（200+ 个，通过 discover/invoke 调用）

| 类别 | 数量 | 代表功能 |
|---|---|---|
| Base | 70+ | 高级权限管理、复制表格、字段/表单/仪表盘 CRUD、记录导入导出 |
| Sheets | 40+ | 追加行、批量样式、合并单元格、条件格式、数据验证 |
| Mail | 15+ | 草稿管理、回复、转发、全部回复、模板、邮件规则 |
| Task | 15+ | 指派、评论、关注者、提醒、子任务、清单管理 |
| Drive | 10+ | 评论、权限申请、创建文件夹、移动/复制、导出 |
| IM | 9 | 创建群聊、更新群信息、消息回复、书签、下载附件 |
| OKR | 8 | 周期列表、目标详情、进展记录、上传图片 |
| VC | 6 | 会议搜索、入会/离会、纪要、录制、事件列表 |
| Wiki | 6 | 空间列表、节点创建/复制/移动、删除空间 |
| Docs | 5 | 媒体下载/插入/预览、批量操作 |
| Calendar | 3 | 回复邀请(RSVP)、智能时间建议、更新日程 |
| Markdown | 3 | 创建、获取、覆盖 Markdown 文件 |
| Minutes | 3 | 搜索妙记、下载音视频、上传生成妙记 |
| Slides | 3 | 创建演示文稿、上传图片、替换页面元素 |
| Whiteboard | 2 | 导出画板、更新画板内容 |

### 示例对话

**高频操作（直接调用）：**

```
帮我查一下今天的日程
```
```
发一条消息给产品研发群：明天下午3点对齐需求
```
```
搜一下飞书里关于"季度规划"的文档
```

**低频操作（自动 discover → invoke）：**

```
帮我创建一个群聊，名字叫"Q3项目组"，把李四和王五拉进来
```
```
帮我查看收件箱最近的邮件
```
```
查看我的 OKR 周期
```
```
搜索最近的妙记录音
```

## 工具列表自动适配

不同版本的 lark-cli 支持的 shortcut 命令不同。安装时自动扫描本地 lark-cli 的全部命令，生成与当前版本完全匹配的工具定义。

如果遇到 `Usage: lark-cli xxx [command]` 错误，说明 lark-cli 已升级但工具定义是旧的。清除 npx 缓存重新安装即可：

```bash
lark-cli update
rm -rf ~/.npm/_npx
npx lark-cli-mcp-wrapper
```

## License

MIT
