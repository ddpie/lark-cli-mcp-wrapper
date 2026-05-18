#!/bin/bash
set -euo pipefail

# ============================================================
# lark-cli-mcp-wrapper — Deploy to AWS Bedrock AgentCore
# ============================================================
#
# Prerequisites:
#   - docker, aws (CLI v2), jq
#   - AWS credentials configured (aws configure / SSO / env vars)
#   - Feishu app with App ID + App Secret
#
# Usage:
#   bash deploy/deploy.sh              # interactive
#   LARK_APP_ID=xxx LARK_APP_SECRET=yyy bash deploy/deploy.sh  # non-interactive
#
# ============================================================

# --- Check dependencies ---
for cmd in docker aws jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "错误：需要安装 $cmd"
    case "$cmd" in
      docker) echo "  安装：https://docs.docker.com/get-docker/" ;;
      aws)    echo "  安装：https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" ;;
      jq)     echo "  安装：macOS: brew install jq | Ubuntu: sudo apt install jq" ;;
    esac
    exit 1
  fi
done

# --- Check AWS credentials ---
if ! aws sts get-caller-identity &>/dev/null; then
  echo "错误：AWS CLI 未配置凭证"
  echo "  运行：aws configure"
  echo "  或设置：AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY"
  exit 1
fi

# --- Collect Lark credentials ---
if [ -z "${LARK_APP_ID:-}" ]; then
  read -p "请输入飞书 App ID: " LARK_APP_ID
  export LARK_APP_ID
fi
if [ -z "${LARK_APP_SECRET:-}" ]; then
  read -s -p "请输入飞书 App Secret: " LARK_APP_SECRET
  echo ""
  export LARK_APP_SECRET
fi

# --- Configuration ---
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="lark-cli-mcp-wrapper"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SERVER_NAME="${AGENTCORE_RUNTIME_NAME:-larkCliMcp}"
GATEWAY_NAME="${AGENTCORE_GATEWAY_NAME:-lark-mcp-gateway}"
SECRET_NAME="lark-cli-mcp-wrapper/credentials"
RUNTIME_ROLE_NAME="LarkMcpAgentCoreRole"
GATEWAY_ROLE_NAME="LarkMcpGatewayRole"

echo ""
echo "=========================================="
echo " lark-cli-mcp-wrapper 部署"
echo "=========================================="
echo " Account:  $ACCOUNT_ID"
echo " Region:   $REGION"
echo " App ID:   $LARK_APP_ID"
echo " Runtime:  $SERVER_NAME"
echo "=========================================="
echo ""

# ============================================================
# Step 1: Build
# ============================================================
echo "=== [1/6] 构建 ==="
npm run build

# ============================================================
# Step 2: ECR + Docker
# ============================================================
echo "=== [2/6] Docker 镜像 ==="
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"

aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" &>/dev/null || \
  aws ecr create-repository --repository-name "$ECR_REPO" --region "$REGION" >/dev/null

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI" 2>/dev/null
docker build -t "${ECR_URI}:${IMAGE_TAG}" . --quiet
docker push "${ECR_URI}:${IMAGE_TAG}" 2>/dev/null || docker push "${ECR_URI}:${IMAGE_TAG}"
echo "  ✓ ${ECR_URI}:${IMAGE_TAG}"

# ============================================================
# Step 3: Secrets Manager
# ============================================================
echo "=== [3/6] Secrets Manager ==="
SECRET_FILE=$(mktemp)
trap 'rm -f "$SECRET_FILE"' EXIT
jq -n --arg id "$LARK_APP_ID" --arg secret "$LARK_APP_SECRET" \
  '{LARK_APP_ID: $id, LARK_APP_SECRET: $secret}' > "$SECRET_FILE"

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
  aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" --region "$REGION" --secret-string "file://$SECRET_FILE" >/dev/null
else
  aws secretsmanager create-secret --name "$SECRET_NAME" --region "$REGION" --secret-string "file://$SECRET_FILE" >/dev/null
fi
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query ARN --output text)
echo "  ✓ $SECRET_ARN"

# ============================================================
# Step 4: IAM Roles
# ============================================================
echo "=== [4/6] IAM 角色 ==="

TRUST_POLICY=$(jq -n '{
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { Service: "bedrock-agentcore.amazonaws.com" },
    Action: "sts:AssumeRole"
  }]
}')

# Runtime Role
if ! aws iam get-role --role-name "$RUNTIME_ROLE_NAME" &>/dev/null; then
  aws iam create-role --role-name "$RUNTIME_ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  aws iam attach-role-policy --role-name "$RUNTIME_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
  aws iam attach-role-policy --role-name "$RUNTIME_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
  aws iam attach-role-policy --role-name "$RUNTIME_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
fi
echo "  ✓ $RUNTIME_ROLE_NAME"

# Gateway Role
if ! aws iam get-role --role-name "$GATEWAY_ROLE_NAME" &>/dev/null; then
  aws iam create-role --role-name "$GATEWAY_ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  # Inline policy for invoking runtimes
  aws iam put-role-policy --role-name "$GATEWAY_ROLE_NAME" --policy-name InvokeRuntime \
    --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock-agentcore:InvokeAgentRuntime","bedrock-agentcore:InvokeAgent"],"Resource":"*"}]}'
fi
echo "  ✓ $GATEWAY_ROLE_NAME"

# Wait for IAM propagation
sleep 10

# ============================================================
# Step 5: AgentCore Runtime
# ============================================================
echo "=== [5/6] AgentCore Runtime ==="
RUNTIME_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${RUNTIME_ROLE_NAME}"

EXISTING_RUNTIME=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" 2>/dev/null | \
  jq -r ".agentRuntimes[]? | select(.agentRuntimeName==\"$SERVER_NAME\") | .agentRuntimeId" 2>/dev/null || echo "")

if [ -n "$EXISTING_RUNTIME" ]; then
  RUNTIME_ID="$EXISTING_RUNTIME"
  echo "  已存在: $RUNTIME_ID"
else
  RUNTIME_ID=$(aws bedrock-agentcore-control create-agent-runtime \
    --agent-runtime-name "$SERVER_NAME" \
    --description "MCP server wrapping lark-cli for Feishu/Lark integration" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:${IMAGE_TAG}\"}}" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --role-arn "$RUNTIME_ROLE_ARN" \
    --protocol-configuration '{"serverProtocol":"MCP"}' \
    --environment-variables "{\"MCP_TRANSPORT\":\"http\",\"PORT\":\"8000\",\"NO_COLOR\":\"1\",\"TOOL_MODE\":\"gateway\",\"LARKSUITE_CLI_BRAND\":\"feishu\",\"LARKSUITE_CLI_APP_ID\":\"${LARK_APP_ID}\",\"LARKSUITE_CLI_APP_SECRET\":\"${LARK_APP_SECRET}\"}" \
    --region "$REGION" --output text --query 'agentRuntimeId')
  echo "  创建中: $RUNTIME_ID"

  # Wait for ready
  for i in $(seq 1 30); do
    STATUS=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RUNTIME_ID" --region "$REGION" --output text --query 'status' 2>/dev/null || echo "UNKNOWN")
    if [ "$STATUS" = "READY" ]; then break; fi
    if [ "$STATUS" = "FAILED" ]; then echo "  ✗ Runtime 创建失败"; exit 1; fi
    sleep 5
  done
  if [ "$STATUS" != "READY" ]; then echo "  ✗ Runtime 创建超时"; exit 1; fi
fi
echo "  ✓ Runtime: $RUNTIME_ID (READY)"

# ============================================================
# Step 6: AgentCore Gateway
# ============================================================
echo "=== [6/6] AgentCore Gateway ==="
GATEWAY_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${GATEWAY_ROLE_NAME}"

EXISTING_GATEWAY=$(aws bedrock-agentcore-control list-gateways --region "$REGION" 2>/dev/null | \
  jq -r ".items[]? | select(.name==\"$GATEWAY_NAME\") | .gatewayId" 2>/dev/null || echo "")

if [ -n "$EXISTING_GATEWAY" ]; then
  GATEWAY_ID="$EXISTING_GATEWAY"
else
  GATEWAY_ID=$(aws bedrock-agentcore-control create-gateway \
    --name "$GATEWAY_NAME" \
    --protocol-type MCP \
    --role-arn "$GATEWAY_ROLE_ARN" \
    --authorizer-type AWS_IAM \
    --region "$REGION" --output text --query 'gatewayId' 2>/dev/null || echo "")
  if [ -z "$GATEWAY_ID" ]; then
    echo "  ⚠ Gateway 创建失败（可能名称格式不支持），跳过"
  else
    sleep 15
  fi
fi

GATEWAY_URL=""
if [ -n "$GATEWAY_ID" ]; then
  GATEWAY_URL=$(aws bedrock-agentcore-control get-gateway --gateway-id "$GATEWAY_ID" --region "$REGION" --output text --query 'gatewayUrl' 2>/dev/null || echo "")
  echo "  ✓ Gateway: $GATEWAY_ID"

  # Create Gateway Target linking to Runtime
  RUNTIME_ARN="arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${RUNTIME_ID}"
  ENCODED_ARN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${RUNTIME_ARN}', safe=''))")
  TARGET_ENDPOINT="https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${ENCODED_ARN}/invocations?qualifier=DEFAULT"

  EXISTING_TARGET=$(aws bedrock-agentcore-control list-gateway-targets --gateway-identifier "$GATEWAY_ID" --region "$REGION" 2>/dev/null | \
    jq -r '.items[]? | select(.status=="READY" or .status=="CREATING") | .targetId' 2>/dev/null | head -1 || echo "")

  if [ -z "$EXISTING_TARGET" ]; then
    TARGET_ID=$(aws bedrock-agentcore-control create-gateway-target \
      --gateway-identifier "$GATEWAY_ID" \
      --name lark-mcp-runtime \
      --target-configuration "{\"mcp\":{\"mcpServer\":{\"endpoint\":\"${TARGET_ENDPOINT}\"}}}" \
      --credential-provider-configurations '[{"credentialProviderType":"GATEWAY_IAM_ROLE","credentialProvider":{"iamCredentialProvider":{"service":"bedrock-agentcore"}}}]' \
      --region "$REGION" --output text --query 'targetId' 2>/dev/null || echo "")

    if [ -n "$TARGET_ID" ]; then
      echo "  ✓ Target: $TARGET_ID (创建中，等待验证...)"
      for i in $(seq 1 12); do
        TSTATUS=$(aws bedrock-agentcore-control get-gateway-target --gateway-identifier "$GATEWAY_ID" --target-id "$TARGET_ID" --region "$REGION" --output text --query 'status' 2>/dev/null)
        if [ "$TSTATUS" = "READY" ]; then echo "  ✓ Target READY"; break; fi
        if [ "$TSTATUS" = "FAILED" ]; then echo "  ⚠ Target 验证失败"; break; fi
        sleep 10
      done
    fi
  else
    echo "  ✓ Target 已存在: $EXISTING_TARGET"
  fi

  echo "  ✓ URL: $GATEWAY_URL"
fi

# ============================================================
# Done
# ============================================================
RUNTIME_ARN="arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${RUNTIME_ID}"

echo ""
echo "=========================================="
echo " ✓ 部署完成"
echo "=========================================="
echo ""
echo " Runtime ARN:  $RUNTIME_ARN"
echo " Runtime ID:   $RUNTIME_ID"
if [ -n "$GATEWAY_URL" ]; then
  echo " Gateway URL:  $GATEWAY_URL"
fi
echo ""
echo " 测试命令："
echo "   aws bedrock-agentcore invoke-agent-runtime \\"
echo "     --cli-binary-format raw-in-base64-out \\"
echo "     --agent-runtime-arn \"$RUNTIME_ARN\" \\"
echo "     --payload '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}' \\"
echo "     --content-type \"application/json\" \\"
echo "     --accept \"application/json\" \\"
echo "     --region $REGION \\"
echo "     /dev/stdout"
echo ""
echo "=========================================="
