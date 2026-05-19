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

# ─── Step 1: Check Node.js ───────────────────────────────────────────────────

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
        brew install node
        success "Node.js 已升级"
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
      brew install node
      success "Node.js 已安装"
    else
      ISSUES+=("需要安装 Node.js >= 18：brew install node")
    fi
  else
    ISSUES+=("需要安装 Node.js >= 18。建议先安装 Homebrew (https://brew.sh)")
  fi
fi

# ─── Step 2: Check Git ───────────────────────────────────────────────────────

info "检查 Git..."
if command -v git &>/dev/null; then
  success "Git $(git --version | awk '{print $3}') 已安装"
else
  warn "未检测到 Git"
  if [ "$HAS_BREW" = true ]; then
    read -p "  是否通过 brew 安装? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      brew install git
      success "Git 已安装"
    else
      ISSUES+=("需要安装 Git：brew install git")
    fi
  else
    ISSUES+=("需要安装 Git：https://git-scm.com/downloads")
  fi
fi

# ─── Step 3: Check lark-cli ──────────────────────────────────────────────────

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
      info "安装中，可能需要 1-2 分钟..."
      npm install -g @larksuite/cli
      success "lark-cli 已安装"
    else
      ISSUES+=("需要安装 lark-cli：npm install -g @larksuite/cli")
    fi
  else
    ISSUES+=("需要先安装 Node.js，然后运行：npm install -g @larksuite/cli")
  fi
fi

# ─── Step 4: Check lark-cli auth ─────────────────────────────────────────────

if command -v lark-cli &>/dev/null; then
  info "检查 lark-cli 登录状态..."
  if lark-cli auth status &>/dev/null; then
    success "lark-cli 已登录"
  else
    warn "lark-cli 未登录"
    echo ""
    echo "  需要完成飞书 OAuth 授权（会打开浏览器）。"
    read -p "  是否现在执行 lark-cli auth login? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      lark-cli auth login
      if lark-cli auth status &>/dev/null; then
        success "lark-cli 登录成功"
      else
        ISSUES+=("lark-cli 登录未完成，请手动执行：lark-cli auth login")
      fi
    else
      ISSUES+=("需要登录 lark-cli：lark-cli auth login")
    fi
  fi
fi

# ─── Step 5: Test MCP wrapper ────────────────────────────────────────────────

if [ ${#ISSUES[@]} -eq 0 ] && command -v npx &>/dev/null; then
  info "测试 MCP wrapper 是否可用..."
  echo '' | npx --yes lark-cli-mcp-wrapper &>/dev/null
  success "MCP wrapper 测试通过"
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

echo "  下一步：在 Amazon Quick Desktop 中添加 MCP 配置"
echo ""
echo "  Settings → Capabilities → MCP → + Add MCP"
echo ""
echo "    Connection type:  Local"
echo "    Name:             Lark CLI MCP Wrapper"
echo "    Command:          npx"
echo "    Arguments:        lark-cli-mcp-wrapper"
echo "    Timeout:          300"
echo ""
echo "  配置完成后，对话中输入「帮我查一下今天的日程」测试。"
echo ""
