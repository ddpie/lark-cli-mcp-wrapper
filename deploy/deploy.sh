#!/bin/bash
set -euo pipefail

# ============================================================
# lark-cli-mcp-wrapper — One-click deployment to AgentCore
# ============================================================

# --- Check dependencies ---
for cmd in docker aws jq curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "错误：需要安装 $cmd"
    echo ""
    echo "安装方式："
    case "$cmd" in
      docker) echo "  https://docs.docker.com/get-docker/" ;;
      aws)    echo "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" ;;
      jq)     echo "  macOS: brew install jq | Ubuntu: sudo apt install jq" ;;
      curl)   echo "  macOS: brew install curl | Ubuntu: sudo apt install curl" ;;
    esac
    exit 1
  fi
done

# --- Check AWS credentials ---
if ! aws sts get-caller-identity &>/dev/null; then
  echo "错误：AWS CLI 未配置凭证。请先运行 aws configure 或设置 AWS_PROFILE"
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
SERVER_NAME="lark_cli_mcp_wrapper"
GATEWAY_NAME="lark-mcp-gateway"
SECRET_NAME="lark-cli-mcp-wrapper/credentials"
RUNTIME_ROLE_NAME="LarkMcpAgentCoreRole"
GATEWAY_ROLE_NAME="LarkMcpGatewayRole"
LOG_GROUP="/agentcore/lark-cli-mcp-wrapper"

echo ""
echo "=========================================="
echo " lark-cli-mcp-wrapper 部署"
echo "=========================================="
echo " Account:  $ACCOUNT_ID"
echo " Region:   $REGION"
echo " App ID:   $LARK_APP_ID"
echo "=========================================="
echo ""

# ============================================================
# Step 1: Build
# ============================================================
echo "=== [1/7] 构建 TypeScript ==="
npm run build

# ============================================================
# Step 2: ECR
# ============================================================
echo "=== [2/7] 创建 ECR 仓库 + 构建推送镜像 ==="
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"

aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" &>/dev/null || \
  aws ecr create-repository --repository-name "$ECR_REPO" --region "$REGION" --output text --query 'repository.repositoryUri'

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI" 2>/dev/null
docker build -t "${ECR_URI}:${IMAGE_TAG}" . --quiet
docker push "${ECR_URI}:${IMAGE_TAG}" --quiet 2>/dev/null || docker push "${ECR_URI}:${IMAGE_TAG}"
echo "  镜像: ${ECR_URI}:${IMAGE_TAG}"

# ============================================================
# Step 3: Secrets Manager
# ============================================================
echo "=== [3/7] 创建 Secrets Manager 密钥 ==="
SECRET_FILE=$(mktemp)
trap 'rm -f "$SECRET_FILE"' EXIT
jq -n --arg id "$LARK_APP_ID" --arg secret "$LARK_APP_SECRET" \
  '{LARK_APP_ID: $id, LARK_APP_SECRET: $secret}' > "$SECRET_FILE"

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
  aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" --region "$REGION" --secret-string "file://$SECRET_FILE" --output text --query 'Name'
else
  aws secretsmanager create-secret --name "$SECRET_NAME" --region "$REGION" --secret-string "file://$SECRET_FILE" --output text --query 'ARN'
fi
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query ARN --output text)
echo "  Secret ARN: $SECRET_ARN"

# ============================================================
# Step 4: IAM Roles
# ============================================================
echo "=== [4/7] 创建 IAM 角色 ==="

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
  aws iam create-role --role-name "$RUNTIME_ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" --output text --query 'Role.Arn'
  aws iam attach-role-policy --role-name "$RUNTIME_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
  aws iam attach-role-policy --role-name "$RUNTIME_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite
  aws iam attach-role-policy --role-name "$RUNTIME_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess
  echo "  Runtime Role 已创建: $RUNTIME_ROLE_NAME"
else
  echo "  Runtime Role 已存在: $RUNTIME_ROLE_NAME"
fi
RUNTIME_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${RUNTIME_ROLE_NAME}"

# Gateway Role
if ! aws iam get-role --role-name "$GATEWAY_ROLE_NAME" &>/dev/null; then
  aws iam create-role --role-name "$GATEWAY_ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" --output text --query 'Role.Arn'
  echo "  Gateway Role 已创建: $GATEWAY_ROLE_NAME"
else
  echo "  Gateway Role 已存在: $GATEWAY_ROLE_NAME"
fi
GATEWAY_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${GATEWAY_ROLE_NAME}"

# Wait for IAM propagation
sleep 10

# ============================================================
# Step 5: AgentCore Runtime
# ============================================================
echo "=== [5/7] 创建 AgentCore Runtime ==="

EXISTING_RUNTIME=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" 2>/dev/null | jq -r ".agentRuntimeSummaries[]? | select(.agentRuntimeName==\"$SERVER_NAME\") | .agentRuntimeId" 2>/dev/null || echo "")

if [ -n "$EXISTING_RUNTIME" ]; then
  echo "  Runtime 已存在: $EXISTING_RUNTIME，更新镜像..."
  aws bedrock-agentcore-control update-agent-runtime \
    --agent-runtime-id "$EXISTING_RUNTIME" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:${IMAGE_TAG}\"}}" \
    --region "$REGION" --output text --query 'agentRuntimeId' 2>/dev/null || echo "  (更新跳过)"
  RUNTIME_ID="$EXISTING_RUNTIME"
else
  RUNTIME_ID=$(aws bedrock-agentcore-control create-agent-runtime \
    --agent-runtime-name "$SERVER_NAME" \
    --description "MCP server wrapping lark-cli for Feishu/Lark integration" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:${IMAGE_TAG}\"}}" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --role-arn "$RUNTIME_ROLE_ARN" \
    --environment-variables '{"MCP_TRANSPORT":"http","PORT":"8000","NO_COLOR":"1","LARKSUITE_CLI_BRAND":"feishu"}' \
    --region "$REGION" --output text --query 'agentRuntimeId')
  echo "  Runtime 创建中: $RUNTIME_ID"

  # Wait for ready
  for i in $(seq 1 30); do
    STATUS=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RUNTIME_ID" --region "$REGION" --output text --query 'status' 2>/dev/null || echo "UNKNOWN")
    if [ "$STATUS" = "READY" ]; then break; fi
    if [ "$STATUS" = "FAILED" ]; then echo "  错误：Runtime 创建失败"; exit 1; fi
    sleep 5
  done
fi
echo "  Runtime ID: $RUNTIME_ID (READY)"

# ============================================================
# Step 6: AgentCore Gateway
# ============================================================
echo "=== [6/7] 创建 AgentCore Gateway ==="

EXISTING_GATEWAY=$(aws bedrock-agentcore-control list-gateways --region "$REGION" 2>/dev/null | jq -r ".gateways[]? | select(.name==\"$GATEWAY_NAME\") | .gatewayId" 2>/dev/null || echo "")

if [ -n "$EXISTING_GATEWAY" ]; then
  GATEWAY_ID="$EXISTING_GATEWAY"
  echo "  Gateway 已存在: $GATEWAY_ID"
else
  GATEWAY_ID=$(aws bedrock-agentcore-control create-gateway \
    --name "$GATEWAY_NAME" \
    --protocol-type MCP \
    --role-arn "$GATEWAY_ROLE_ARN" \
    --authorizer-type AWS_IAM \
    --region "$REGION" --output text --query 'gatewayId' 2>/dev/null || echo "")

  if [ -z "$GATEWAY_ID" ]; then
    echo "  警告：Gateway 创建失败，可能需要在 AWS Console 手动创建"
    echo "  Bedrock > AgentCore > Gateway > Create"
  else
    echo "  Gateway 创建中: $GATEWAY_ID"
    sleep 15
  fi
fi

# Get gateway endpoint
if [ -n "$GATEWAY_ID" ]; then
  GATEWAY_URL=$(aws bedrock-agentcore-control get-gateway --gateway-id "$GATEWAY_ID" --region "$REGION" --output text --query 'gatewayUrl' 2>/dev/null || echo "")
fi

# ============================================================
# Step 7: CloudWatch 告警
# ============================================================
echo "=== [7/7] 创建 CloudWatch 告警 ==="

# Create log group
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$REGION" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 30 --region "$REGION" 2>/dev/null || true

# Error alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "LarkMcp-ErrorRate" \
  --alarm-description "lark-cli-mcp-wrapper error rate > 10/5min" \
  --namespace "LarkMcpWrapper" \
  --metric-name "ErrorCount" \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --treat-missing-data notBreaching \
  --region "$REGION" 2>/dev/null || true

echo "  告警已创建: LarkMcp-ErrorRate"

# ============================================================
# Done
# ============================================================
echo ""
echo "=========================================="
echo " 部署完成！"
echo "=========================================="
echo ""
echo " Runtime ID:   $RUNTIME_ID"
echo " Secret ARN:   $SECRET_ARN"
echo " ECR Image:    ${ECR_URI}:${IMAGE_TAG}"
if [ -n "${GATEWAY_URL:-}" ]; then
  echo " Gateway URL:  $GATEWAY_URL"
  echo ""
  echo " Quick Desktop Remote MCP 配置："
  echo "   Connection type: Remote"
  echo "   Name: Lark CLI MCP Wrapper"
  echo "   URL: $GATEWAY_URL"
fi
echo ""
echo "=========================================="
