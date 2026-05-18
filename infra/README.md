# Infrastructure (CDK)

AWS CDK stack for deploying lark-cli-mcp-wrapper infrastructure.

## What it creates

- **ECR Repository** — Container image storage
- **Secrets Manager** — Lark app credentials (APP_ID + APP_SECRET)
- **CloudWatch Log Group** — 30-day log retention
- **CloudWatch Alarms** — Alerts on errors, auth failures, session hijack attempts
- **SNS Topic** — Email notifications (optional)

## Prerequisites

```bash
npm install -g aws-cdk
cd infra
npm install
```

## Deploy

```bash
# With context parameters
cdk deploy -c larkAppId=cli_xxx -c alertEmail=you@example.com

# Or with environment variables
export LARK_APP_ID=cli_xxx
export ALERT_EMAIL=you@example.com
cdk deploy
```

## Alarms

| Alarm | Trigger | Action |
|---|---|---|
| ErrorAlarm | >10 errors in 5min | Email alert |
| AuthFailAlarm | >5 auth failures in 5min | Email alert |
| SessionHijackAlarm | Any session token mismatch | Email alert |

## After CDK deploy

The CDK stack creates supporting infrastructure. To deploy the MCP server itself:

1. Build and push the Docker image to the ECR repo (URI in stack outputs)
2. Deploy to AgentCore using the `agentcore` CLI or AWS Console
3. Update the AgentCore config to reference the Secret ARN from stack outputs
