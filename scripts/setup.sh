#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}▶${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

ISSUES=()

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   lark-cli-mcp-wrapper 安装向导 (macOS)  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ─── Check Homebrew ──────────────────────────────────────────────────────────

HAS_BREW=false
if command -v brew &>/dev/null; then
  HAS_BREW=true
fi

# ─── Check Node.js ───────────────────────────────────────────────────────────

info "检查 Node.js..."
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    success "Node.js $NODE_VERSION 已安装"
  else
    warn "Node.js $NODE_VERSION 版本过低，需要 >= 18"
    if [ "$HAS_BREW" = true ]; then
      read -p "  是否通过 brew 升级? [Y/n] " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        if brew install node; then
          success "Node.js 已升级"
        else
          ISSUES+=("Node.js 升级失败，请手动运行：brew install node")
        fi
      else
        ISSUES+=("Node.js 版本过低，需要 >= 18：brew install node")
      fi
    else
      ISSUES+=("Node.js 版本过低，需要 >= 18。建议先安装 Homebrew (https://brew.sh)")
    fi
  fi
else
  warn "未检测到 Node.js"
  if [ "$HAS_BREW" = true ]; then
    read -p "  是否通过 brew 安装? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      if brew install node; then
        success "Node.js 已安装"
      else
        ISSUES+=("Node.js 安装失败，请手动运行：brew install node")
      fi
    else
      ISSUES+=("需要安装 Node.js >= 18：brew install node")
    fi
  else
    ISSUES+=("需要安装 Node.js >= 18。建议先安装 Homebrew (https://brew.sh)")
  fi
fi

# ─── Check lark-cli ──────────────────────────────────────────────────────────

info "检查 lark-cli..."
if command -v lark-cli &>/dev/null; then
  LARK_VERSION=$(lark-cli --version 2>&1 | awk '{print $NF}')
  success "lark-cli $LARK_VERSION 已安装"
else
  warn "未检测到 lark-cli"
  if command -v npm &>/dev/null; then
    read -p "  是否安装 lark-cli? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      info "安装中..."
      if npm install -g @larksuite/cli; then
        success "lark-cli 已安装"
      else
        ISSUES+=("lark-cli 安装失败，请手动运行：npm install -g @larksuite/cli")
      fi
    else
      ISSUES+=("需要安装 lark-cli：npm install -g @larksuite/cli")
    fi
  else
    ISSUES+=("需要先安装 Node.js，然后运行：npm install -g @larksuite/cli")
  fi
fi

# ─── Check lark-cli config ───────────────────────────────────────────────────

if command -v lark-cli &>/dev/null; then
  info "检查 lark-cli 应用配置..."
  AUTH_OUTPUT=$(lark-cli auth status 2>&1)
  HAS_APP_ID=$(echo "$AUTH_OUTPUT" | grep -o '"appId"' || true)

  if [ -z "$HAS_APP_ID" ]; then
    warn "未配置飞书应用"
    echo ""
    echo "  需要先配置飞书应用的 App ID 和 App Secret。"
    echo "  （在飞书开放平台创建应用后获取：https://open.feishu.cn）"
    echo ""
    read -p "  是否现在配置? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      lark-cli config init
      if lark-cli auth status 2>&1 | grep -q '"appId"'; then
        success "应用配置完成"
      else
        ISSUES+=("应用配置未完成，请手动运行：lark-cli config init")
      fi
    else
      ISSUES+=("需要配置飞书应用：lark-cli config init")
    fi
  else
    success "飞书应用已配置"
  fi
fi

# ─── Check lark-cli auth ─────────────────────────────────────────────────────

if command -v lark-cli &>/dev/null; then
  info "检查 lark-cli 登录状态..."
  AUTH_OUTPUT=$(lark-cli auth status 2>&1)
  HAS_USER=$(echo "$AUTH_OUTPUT" | grep -o '"identity": *"user"' || true)

  if [ -n "$HAS_USER" ]; then
    USER_NAME=$(echo "$AUTH_OUTPUT" | grep -o '"userName": *"[^"]*"' | sed 's/.*: *"//;s/"//')
    success "lark-cli 已登录（$USER_NAME）"
  else
    warn "lark-cli 未完成用户登录"
    echo ""
    echo "  需要完成飞书 Device Flow 授权（会显示一个链接和验证码，在浏览器中打开并输入）。"
    read -p "  是否现在执行 lark-cli auth login? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      lark-cli auth login
      AUTH_OUTPUT=$(lark-cli auth status 2>&1)
      if echo "$AUTH_OUTPUT" | grep -q '"identity": *"user"'; then
        success "lark-cli 登录成功"
      else
        ISSUES+=("lark-cli 登录未完成，请手动执行：lark-cli auth login")
      fi
    else
      ISSUES+=("需要登录 lark-cli：lark-cli auth login")
    fi
  fi
fi

# ─── Test MCP wrapper ────────────────────────────────────────────────────────

if [ ${#ISSUES[@]} -eq 0 ] && command -v npx &>/dev/null; then
  info "测试 MCP wrapper..."
  if echo '' | npx --yes lark-cli-mcp-wrapper 2>/dev/null; then
    success "MCP wrapper 可用"
  else
    warn "MCP wrapper 测试未通过（首次运行可能需要等待安装）"
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
if [ ${#ISSUES[@]} -gt 0 ]; then
  echo -e "${YELLOW}══════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  以下问题需要手动解决：${NC}"
  echo -e "${YELLOW}══════════════════════════════════════════${NC}"
  echo ""
  for issue in "${ISSUES[@]}"; do
    echo -e "  ${RED}•${NC} $issue"
  done
  echo ""
  echo "  解决后重新运行本脚本即可。"
  echo ""
else
  echo -e "${GREEN}══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✓ 全部就绪！${NC}"
  echo -e "${GREEN}══════════════════════════════════════════${NC}"
  echo ""
fi

echo "  下一步：在 MCP 客户端中添加配置"
echo ""
echo "  方式一：Quick Desktop"
echo "  Settings → Capabilities → MCP → + Add MCP"
echo ""
echo "    Connection type:  Local"
echo "    Name:             Lark CLI MCP Wrapper"
echo "    Command:          npx"
echo "    Arguments:        lark-cli-mcp-wrapper"
echo ""
echo "  方式二：JSON 配置（其他支持 MCP 的客户端）"
echo ""
echo '    {
      "mcpServers": {
        "lark": {
          "command": "npx",
          "args": ["lark-cli-mcp-wrapper"]
        }
      }
    }'
echo ""
echo "  配置完成后，对话中输入「帮我查一下今天的日程」测试。"
echo ""
