#!/bin/bash
set -euo pipefail

# Configuration
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="lark-cli-mcp-wrapper"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SERVER_NAME="lark-cli-mcp-wrapper"
SECRET_NAME="lark-cli-mcp-wrapper/credentials"
OAUTH_PROVIDER_NAME="${OAUTH_PROVIDER_NAME:-feishu-oauth-provider}"

echo "=== Building TypeScript ==="
npm run build

echo "=== Creating ECR repository (if not exists) ==="
aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" 2>/dev/null || \
  aws ecr create-repository --repository-name "$ECR_REPO" --region "$REGION"

echo "=== Docker build + push ==="
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"
docker build -t "${ECR_URI}:${IMAGE_TAG}" .
docker push "${ECR_URI}:${IMAGE_TAG}"

echo "=== Creating/updating Secrets Manager secret ==="
SECRET_FILE=$(mktemp)
trap 'rm -f "$SECRET_FILE"' EXIT
jq -n --arg id "$LARK_APP_ID" --arg secret "$LARK_APP_SECRET" \
  '{LARK_APP_ID: $id, LARK_APP_SECRET: $secret}' > "$SECRET_FILE"

if ! aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" 2>/dev/null; then
  echo "Creating secret..."
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --region "$REGION" \
    --secret-string "file://$SECRET_FILE"
else
  echo "Secret exists, updating..."
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --region "$REGION" \
    --secret-string "file://$SECRET_FILE"
fi

SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" --query ARN --output text)

echo "=== Registering OAuth credential provider ==="
OAUTH_CONFIG=$(jq -n \
  --arg authz "https://open.feishu.cn/open-apis/authen/v1/authorize" \
  --arg token "https://open.feishu.cn/open-apis/authen/v2/oauth_token" \
  --arg cid "$LARK_APP_ID" \
  --arg csecret "$LARK_APP_SECRET" \
  '{authorizationEndpoint: $authz, tokenEndpoint: $token, clientId: $cid, clientSecret: $csecret}')

aws bedrock-agentcore-control create-oauth2-credential-provider \
  --name "$OAUTH_PROVIDER_NAME" \
  --credential-provider-vendor "Custom" \
  --oauth2-provider-config-custom "$OAUTH_CONFIG" \
  --region "$REGION" 2>/dev/null || \
  echo "OAuth provider already exists or creation requires console setup. See docs."

echo "=== Deploying to AgentCore ==="
echo "Image: ${ECR_URI}:${IMAGE_TAG}"
echo "Secret ARN: ${SECRET_ARN}"
echo ""
echo "Run the following to deploy:"
echo "  pip install bedrock-agentcore"
echo "  agentcore configure --server-name ${SERVER_NAME} --image ${ECR_URI}:${IMAGE_TAG}"
echo "  agentcore launch --server-name ${SERVER_NAME}"
echo ""
echo "Or deploy via AWS Console: Bedrock > AgentCore > Runtime"
