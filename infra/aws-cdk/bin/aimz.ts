#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AimzStack } from "../lib/aimz-stack";

const app = new cdk.App();

/**
 * Environment resolution.
 *
 * Account/region are taken from the standard CDK env vars that the AWS CLI /
 * `cdk` populate (CDK_DEFAULT_ACCOUNT, CDK_DEFAULT_REGION). Everything the
 * migration needs to be tuned per-environment is read from CDK context
 * (`-c key=value`) or environment variables, with production-sane defaults.
 */
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "eu-north-1";

const envName = app.node.tryGetContext("env") ?? process.env.AIMZ_ENV ?? "production";

// By default CDK assumes the bootstrap publishing/deploy roles. Where the
// deploying identity cannot assume them (a plain IAM user without sts:AssumeRole
// on the account-root-trusted roles), `-c cliCredentials=true` publishes assets
// and deploys with the CLI's own credentials directly instead.
const useCliCredentials = app.node.tryGetContext("cliCredentials") === "true";

new AimzStack(app, `Aimz-${envName}`, {
  ...(useCliCredentials
    ? { synthesizer: new cdk.CliCredentialsStackSynthesizer() }
    : {}),
  env: { account, region },
  description: `AIMZ Egypt — AWS platform (${envName}): VPC, RDS Postgres, ElastiCache Redis, EC2/ALB API, S3+CloudFront web.`,
  envName,
  // The domain the mobile web build will be served from. Leave undefined to use
  // the CloudFront-generated domain; set a value once you attach a custom domain.
  webDomainName: app.node.tryGetContext("webDomainName") ?? process.env.AIMZ_WEB_DOMAIN,
  // ACM certificate ARN (in us-east-1) for the CloudFront custom domain, if any.
  webCertificateArn:
    app.node.tryGetContext("webCertificateArn") ?? process.env.AIMZ_WEB_CERT_ARN,
  // ACM certificate ARN (in the stack region) for the API ALB HTTPS listener.
  apiCertificateArn:
    app.node.tryGetContext("apiCertificateArn") ?? process.env.AIMZ_API_CERT_ARN,
  tags: {
    Project: "aimz-egypt",
    Environment: envName,
    ManagedBy: "aws-cdk",
  },
});

app.synth();
