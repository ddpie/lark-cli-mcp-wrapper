#!/usr/bin/env npx ts-node
import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

interface LarkMcpStackProps extends cdk.StackProps {
  larkAppId: string;
  alertEmail?: string;
}

class LarkMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LarkMcpStackProps) {
    super(scope, id, props);

    // ECR Repository
    const repo = new ecr.Repository(this, "LarkCliMcpRepo", {
      repositoryName: "lark-cli-mcp-wrapper",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 10 }],
    });

    // Secrets Manager — Lark credentials
    const secret = new secretsmanager.Secret(this, "LarkCredentials", {
      secretName: "lark-cli-mcp-wrapper/credentials",
      description: "Feishu/Lark app credentials for MCP server",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ LARK_APP_ID: props.larkAppId }),
        generateStringKey: "LARK_APP_SECRET",
      },
    });

    // CloudWatch Log Group (AgentCore sends container logs here)
    const logGroup = new logs.LogGroup(this, "LarkMcpLogs", {
      logGroupName: "/agentcore/lark-cli-mcp-wrapper",
      retention: logs.RetentionDays.THIRTY_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Metric Filters
    const authErrorFilter = new logs.MetricFilter(this, "AuthErrorFilter", {
      logGroup,
      filterPattern: logs.FilterPattern.literal('"level":"error"'),
      metricNamespace: "LarkMcpWrapper",
      metricName: "ErrorCount",
      metricValue: "1",
    });

    const authFailFilter = new logs.MetricFilter(this, "AuthFailFilter", {
      logGroup,
      filterPattern: logs.FilterPattern.literal('"Failed to resolve user token"'),
      metricNamespace: "LarkMcpWrapper",
      metricName: "AuthFailureCount",
      metricValue: "1",
    });

    const sessionMismatchFilter = new logs.MetricFilter(this, "SessionMismatchFilter", {
      logGroup,
      filterPattern: logs.FilterPattern.literal('"Session token mismatch"'),
      metricNamespace: "LarkMcpWrapper",
      metricName: "SessionMismatchCount",
      metricValue: "1",
    });

    // CloudWatch Alarms
    const errorAlarm = new cloudwatch.Alarm(this, "ErrorAlarm", {
      metric: authErrorFilter.metric({ statistic: "Sum", period: cdk.Duration.minutes(5) }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: "More than 10 errors in 5 minutes",
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    const authFailAlarm = new cloudwatch.Alarm(this, "AuthFailAlarm", {
      metric: authFailFilter.metric({ statistic: "Sum", period: cdk.Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: "More than 5 auth failures in 5 minutes — possible token/provider issue",
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    const hijackAlarm = new cloudwatch.Alarm(this, "SessionHijackAlarm", {
      metric: sessionMismatchFilter.metric({ statistic: "Sum", period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "Session token mismatch detected — possible hijack attempt",
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // SNS Topic for alerts
    if (props.alertEmail) {
      const alertTopic = new sns.Topic(this, "AlertTopic", {
        topicName: "lark-mcp-alerts",
      });
      new sns.Subscription(this, "AlertEmail", {
        topic: alertTopic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: props.alertEmail,
      });

      errorAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
      authFailAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
      hijackAlarm.addAlarmAction(new actions.SnsAction(alertTopic));
    }

    // Outputs
    new cdk.CfnOutput(this, "EcrRepoUri", { value: repo.repositoryUri });
    new cdk.CfnOutput(this, "SecretArn", { value: secret.secretArn });
    new cdk.CfnOutput(this, "LogGroupName", { value: logGroup.logGroupName });
  }
}

// App
const app = new cdk.App();

const larkAppId = app.node.tryGetContext("larkAppId") || process.env.LARK_APP_ID || "";
const alertEmail = app.node.tryGetContext("alertEmail") || process.env.ALERT_EMAIL;

new LarkMcpStack(app, "LarkMcpStack", {
  larkAppId,
  alertEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
