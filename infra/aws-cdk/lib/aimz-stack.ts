import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";

export interface AimzStackProps extends cdk.StackProps {
  /** Logical environment name (production, staging, ...). */
  readonly envName: string;
  /** Custom domain for the web frontend (optional). */
  readonly webDomainName?: string;
  /** ACM cert ARN in us-east-1 for the CloudFront custom domain (optional). */
  readonly webCertificateArn?: string;
  /** ACM cert ARN in the stack region for the API ALB HTTPS listener (optional). */
  readonly apiCertificateArn?: string;
}

/**
 * Single, self-contained stack for the whole AIMZ AWS platform. Deploying it
 * with `cdk deploy` stands up every piece the migration needs:
 *
 *   Network   VPC across 2 AZs, public + private-with-egress subnets, 1 NAT GW.
 *   Data      RDS PostgreSQL (managed credentials) + ElastiCache Redis.
 *   Secrets   App secrets (JWT, admin, invite, SMTP) in Secrets Manager.
 *   API       ECR image -> EC2 Auto Scaling Group behind an internet-facing ALB.
 *   Web       Private S3 bucket + CloudFront (OAC) for the Expo web export.
 *   Media     Private S3 bucket the API presigns for uploads/downloads.
 *
 * Defaults are sized for ~500 concurrent users; every instance class and count
 * is overridable through CDK context so you can scale up or trim cost.
 */
export class AimzStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AimzStackProps) {
    super(scope, id, props);

    const ctx = (key: string, fallback: string): string =>
      (this.node.tryGetContext(key) as string | undefined) ?? fallback;

    // Whether the S3 buckets survive a stack teardown. Retained in production so
    // uploaded media/web assets are never lost — but during an initial bring-up,
    // where the buckets are still empty and a failed deploy would otherwise
    // orphan them (blocking the retry on their fixed names), `-c retainBuckets=false`
    // lets a rollback clean them up.
    const retainBuckets =
      ctx("retainBuckets", props.envName === "production" ? "true" : "false") === "true";
    const bucketRemoval = retainBuckets
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    // ElastiCache is a speculative cache the app does not yet use. `-c
    // enableRedis=false` skips it entirely, so the rest of the platform can come
    // up even when ElastiCache is unavailable in the region/account.
    const enableRedis = ctx("enableRedis", "true") === "true";

    // Whether the database resists teardown (deletion protection + a final
    // snapshot). On in production; `-c retainData=false` during bring-up so a
    // failed deploy can roll the still-empty database back cleanly.
    const retainData =
      ctx("retainData", props.envName === "production" ? "true" : "false") === "true";

    // ---------------------------------------------------------------------
    // Network
    // ---------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1, // one NAT is plenty for ~500 users; bump to 2 for AZ-independent egress
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "app",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "data",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Security groups: ALB -> app -> data. Nothing in data is reachable from
    // the internet; the app tier is only reachable through the ALB.
    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "AIMZ ALB - public ingress",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    const appSg = new ec2.SecurityGroup(this, "AppSg", {
      vpc,
      description: "AIMZ API instances",
      allowAllOutbound: true,
    });
    // Descriptions avoid ">": EC2 rejects it (allowed set is
    // a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*), which fails stack creation.
    appSg.addIngressRule(albSg, ec2.Port.tcp(8000), "ALB to API");

    const dataSg = new ec2.SecurityGroup(this, "DataSg", {
      vpc,
      description: "AIMZ RDS + Redis",
      allowAllOutbound: true,
    });
    dataSg.addIngressRule(appSg, ec2.Port.tcp(5432), "API to Postgres");
    if (enableRedis) {
      dataSg.addIngressRule(appSg, ec2.Port.tcp(6379), "API to Redis");
    }

    // ---------------------------------------------------------------------
    // Secrets
    // ---------------------------------------------------------------------
    // RDS manages the DB master credentials in its own secret.
    const dbCredentials = new secretsmanager.Secret(this, "DbCredentials", {
      secretName: `aimz/${props.envName}/db`,
      description: "AIMZ RDS master credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "aimz" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // Application secrets consumed by the FastAPI container at boot.
    const appSecret = new secretsmanager.Secret(this, "AppSecret", {
      secretName: `aimz/${props.envName}/app`,
      description: "AIMZ API application secrets (JWT, admin, invite, SMTP)",
      generateSecretString: {
        // JWT_SECRET is generated. ADMIN_PASSWORD must be set by you after deploy
        // (see the runbook) — hosted envs reject the placeholder value.
        secretStringTemplate: JSON.stringify({
          ADMIN_NAME: "AIMZ Admin",
          ADMIN_EMAIL: "admin@aimz.example",
          ADMIN_PASSWORD: "CHANGE-ME-AFTER-DEPLOY",
          INITIAL_INVITE_CODE: "AIMZ-PLAY",
          SMTP_HOST: "",
          SMTP_USERNAME: "",
          SMTP_PASSWORD: "",
          SMTP_FROM_EMAIL: "scores@aimz.example",
        }),
        generateStringKey: "JWT_SECRET",
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    // ---------------------------------------------------------------------
    // Data tier: RDS Postgres
    // ---------------------------------------------------------------------
    const dbInstanceClass = ctx("dbInstanceClass", "t3.medium"); // e.g. m6g.large for more headroom
    const multiAz = ctx("dbMultiAz", "false") === "true";

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        // Kept on 16.x; the app's Alembic migrations are dialect-agnostic, so the
        // exact minor is transparent. Built with `.of()` (not the CDK enum) and
        // context-driven because RDS retires old minors — override with
        // `-c dbEngineVersion=16.15` when the default is no longer offered.
        version: rds.PostgresEngineVersion.of(ctx("dbEngineVersion", "16.9"), "16"),
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dataSg],
      instanceType: new ec2.InstanceType(dbInstanceClass),
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: "aimz",
      // Free tier allows 20 GB; override with `-c dbAllocatedStorage=50` for more.
      allocatedStorage: Number(ctx("dbAllocatedStorage", "50")),
      // Storage autoscaling headroom. The free-tier plan disallows it — set
      // `-c dbMaxStorage=0` to turn it off (max = allocated).
      maxAllocatedStorage:
        ctx("dbMaxStorage", "200") === "0" ? undefined : Number(ctx("dbMaxStorage", "200")),
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz,
      // The free-tier plan caps backup retention; `-c dbBackupRetentionDays=0`
      // disables automated backups to stay within it.
      backupRetention: cdk.Duration.days(Number(ctx("dbBackupRetentionDays", "7"))),
      // Data protection defaults on in production, but blocks a rollback from
      // cleaning up a half-built stack. During bring-up (before real data is in
      // it) `-c retainData=false` lets a failed deploy tear the database down.
      deletionProtection: retainData,
      removalPolicy: retainData ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ["postgresql"],
    });

    // ---------------------------------------------------------------------
    // Data tier: ElastiCache Redis (optional quick-hit cache)
    // ---------------------------------------------------------------------
    let redisEndpoint: string | undefined;
    if (enableRedis) {
      const redisSubnets = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
        description: "AIMZ Redis subnet group",
        subnetIds: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
      });

      // High-availability Redis (a replica + automatic failover across AZs) means
      // two nodes; a single node keeps the cache within the free tier. Defaults to
      // HA in production, turned off with `-c redisHa=false`.
      const redisHa =
        ctx("redisHa", props.envName === "production" ? "true" : "false") === "true";
      const redis = new elasticache.CfnReplicationGroup(this, "Redis", {
        replicationGroupDescription: "AIMZ quick-hit cache",
        engine: "redis",
        cacheNodeType: ctx("redisNodeType", "cache.t4g.small"),
        // Cluster mode DISABLED: a single primary (+ one replica for HA), read via
        // its PrimaryEndPoint below. `numNodeGroups` would instead enable cluster
        // mode — whose endpoint is the ConfigurationEndpoint, not the primary, and
        // which creates less reliably on a micro node.
        numCacheClusters: redisHa ? 2 : 1,
        automaticFailoverEnabled: redisHa,
        multiAzEnabled: redisHa,
        cacheSubnetGroupName: redisSubnets.ref,
        securityGroupIds: [dataSg.securityGroupId],
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: false,
        port: 6379,
      });
      redis.addDependency(redisSubnets);
      redisEndpoint = redis.attrPrimaryEndPointAddress;
    }

    // ---------------------------------------------------------------------
    // Media bucket (private; API presigns objects)
    // ---------------------------------------------------------------------
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      bucketName: `aimz-${props.envName}-media-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"], // tighten to your web origin once the domain is fixed
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      removalPolicy: bucketRemoval,
      // No auto-delete Lambda: during bring-up the buckets are empty, so a
      // DESTROY policy removes them on rollback without a flaky custom resource.
      // Empty them by hand before a teardown once they hold migrated media.
      autoDeleteObjects: false,
    });

    // ---------------------------------------------------------------------
    // API image (built from ../../backend) pushed to ECR by CDK assets
    // ---------------------------------------------------------------------
    const apiImage = new ecrAssets.DockerImageAsset(this, "ApiImage", {
      directory: "../../backend",
      platform: ecrAssets.Platform.LINUX_AMD64,
    });

    // ---------------------------------------------------------------------
    // API compute: EC2 Auto Scaling Group behind an ALB
    // ---------------------------------------------------------------------
    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ), // SSM shell + Run Command (used for migrations)
      ],
    });
    dbCredentials.grantRead(instanceRole);
    appSecret.grantRead(instanceRole);
    mediaBucket.grantReadWrite(instanceRole);
    apiImage.repository.grantPull(instanceRole);

    const region = cdk.Stack.of(this).region;

    // Boot script: install docker, pull the API image, assemble the runtime
    // environment from Secrets Manager + RDS + Redis, and run uvicorn.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -euo pipefail",
      "dnf install -y docker jq || yum install -y docker jq",
      "systemctl enable --now docker",
      `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${region}.amazonaws.com`,
      `DB_SECRET=$(aws secretsmanager get-secret-value --region ${region} --secret-id ${dbCredentials.secretArn} --query SecretString --output text)`,
      `APP_SECRET=$(aws secretsmanager get-secret-value --region ${region} --secret-id ${appSecret.secretArn} --query SecretString --output text)`,
      `DB_USER=$(echo "$DB_SECRET" | jq -r .username)`,
      `DB_PASS=$(echo "$DB_SECRET" | jq -r .password)`,
      `DATABASE_URL="postgresql+asyncpg://$DB_USER:$DB_PASS@${database.dbInstanceEndpointAddress}:5432/aimz"`,
      ...(redisEndpoint ? [`REDIS_URL="redis://${redisEndpoint}:6379/0"`] : []),
      "echo \"$APP_SECRET\" | jq -r 'to_entries[] | \"\\(.key)=\\(.value)\"' > /etc/aimz.env",
      "echo \"DATABASE_URL=$DATABASE_URL\" >> /etc/aimz.env",
      ...(redisEndpoint ? ['echo "REDIS_URL=$REDIS_URL" >> /etc/aimz.env'] : []),
      `echo "ENVIRONMENT=${props.envName}" >> /etc/aimz.env`,
      `echo "S3_BUCKET=${mediaBucket.bucketName}" >> /etc/aimz.env`,
      `echo "S3_REGION=${region}" >> /etc/aimz.env`,
      "echo 'MEDIA_ENABLED=true' >> /etc/aimz.env",
      `docker pull ${apiImage.imageUri}`,
      "docker rm -f aimz-api 2>/dev/null || true",
      `docker run -d --restart always --name aimz-api -p 8000:8000 --env-file /etc/aimz.env ${apiImage.imageUri}`
    );

    const asg = new autoscaling.AutoScalingGroup(this, "ApiAsg", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: new ec2.InstanceType(ctx("apiInstanceType", "t3.medium")),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      role: instanceRole,
      securityGroup: appSg,
      userData,
      minCapacity: Number(ctx("apiMinCapacity", "2")),
      maxCapacity: Number(ctx("apiMaxCapacity", "4")),
      healthCheck: autoscaling.HealthCheck.elb({
        grace: cdk.Duration.minutes(5),
      }),
    });
    asg.scaleOnCpuUtilization("CpuScaling", { targetUtilizationPercent: 60 });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const httpsEnabled = Boolean(props.apiCertificateArn);
    const listener = alb.addListener("ApiListener", {
      port: httpsEnabled ? 443 : 80,
      protocol: httpsEnabled
        ? elbv2.ApplicationProtocol.HTTPS
        : elbv2.ApplicationProtocol.HTTP,
      certificates: httpsEnabled
        ? [
            certificatemanager.Certificate.fromCertificateArn(
              this,
              "ApiCert",
              props.apiCertificateArn!
            ),
          ]
        : undefined,
    });

    listener.addTargets("ApiTargets", {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [asg],
      healthCheck: {
        path: "/api/v1/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
      },
      deregistrationDelay: cdk.Duration.seconds(15),
    });

    if (httpsEnabled) {
      // Redirect plain HTTP to HTTPS when a cert is attached.
      alb.addListener("HttpRedirect", {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
          permanent: true,
        }),
      });
    }

    // ---------------------------------------------------------------------
    // Web frontend: private S3 + CloudFront (OAC)
    // ---------------------------------------------------------------------
    const webBucket = new s3.Bucket(this, "WebBucket", {
      bucketName: `aimz-${props.envName}-web-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: bucketRemoval,
      // No auto-delete Lambda: during bring-up the buckets are empty, so a
      // DESTROY policy removes them on rollback without a flaky custom resource.
      // Empty them by hand before a teardown once they hold migrated media.
      autoDeleteObjects: false,
    });

    // The API is served through the same CloudFront distribution under /api/*,
    // so the web app calls it same-origin over HTTPS (no mixed content) and the
    // ALB can stay plain HTTP behind the CDN.
    const albOrigin = new origins.LoadBalancerV2Origin(alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });

    // SPA routing done in a viewer function rather than distribution-wide error
    // responses: the latter would also rewrite the API's own 403/404 JSON into
    // index.html. This only rewrites extensionless, non-/api paths to the shell;
    // real missing assets and API errors pass through untouched.
    const spaRouter = new cloudfront.Function(this, "SpaRouter", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        [
          "function handler(event) {",
          "  var request = event.request;",
          "  var uri = request.uri;",
          "  if (uri.indexOf('/api/') === 0) { return request; }",
          "  var last = uri.substring(uri.lastIndexOf('/') + 1);",
          "  if (last.indexOf('.') === -1) { request.uri = '/index.html'; }",
          "  return request;",
          "}",
        ].join("\n")
      ),
    });

    const distribution = new cloudfront.Distribution(this, "WebCdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: spaRouter,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: "index.html",
      domainNames: props.webDomainName ? [props.webDomainName] : undefined,
      certificate:
        props.webDomainName && props.webCertificateArn
          ? certificatemanager.Certificate.fromCertificateArn(
              this,
              "WebCert",
              props.webCertificateArn
            )
          : undefined,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // ---------------------------------------------------------------------
    // Outputs (consumed by the deploy scripts and the runbook)
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", {
      value: `${httpsEnabled ? "https" : "http"}://${alb.loadBalancerDnsName}`,
      description: "Public API base URL (point EXPO_PUBLIC_API_URL here).",
    });
    new cdk.CfnOutput(this, "WebUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront URL for the web frontend.",
    });
    new cdk.CfnOutput(this, "WebBucketName", { value: webBucket.bucketName });
    new cdk.CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.bucketName,
    });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, "DbEndpoint", {
      value: database.dbInstanceEndpointAddress,
    });
    if (redisEndpoint) {
      new cdk.CfnOutput(this, "RedisEndpoint", { value: redisEndpoint });
    }
    new cdk.CfnOutput(this, "DbSecretArn", { value: dbCredentials.secretArn });
    new cdk.CfnOutput(this, "AppSecretArn", { value: appSecret.secretArn });
    new cdk.CfnOutput(this, "AsgName", {
      value: asg.autoScalingGroupName,
      description: "Auto Scaling Group name (used by run-migrations.sh).",
    });
  }
}
