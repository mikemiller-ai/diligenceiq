import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CONFIG, PATHS } from './config';
import { lambdaRole } from './lambda-role';
import { METRIC_NAMESPACE, WORKER_METRICS } from './worker-stack';

/** Phase 7 (architecture §12): server errors, from the api's one access line per request. */
export const API_5XX = 'Api5xx';

export interface ApiStackProps extends StackProps {
  table: dynamodb.ITable;
  dataBucket: s3.IBucket;
  killSwitch: ssm.IStringParameter;
  activeProfileSet: ssm.IStringParameter;
  queue: sqs.IQueue;
}

export class ApiStack extends Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly apiEndpoint: string;
  public readonly apiFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Explicit log group via `logGroup`; the deprecated `logRetention` would add a
    // custom-resource Lambda just to set retention.
    const logGroup = new logs.LogGroup(this, 'ApiFunctionLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
      entry: PATHS.apiHandler,
      handler: 'handler',
      projectRoot: PATHS.repoRoot,
      depsLockFilePath: PATHS.lockFile,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup,
      role: lambdaRole(this, 'ApiFunctionRole', logGroup),
      environment: {
        KILL_SWITCH_PARAM: props.killSwitch.parameterName,
        ACTIVE_PROFILE_SET_PARAM: props.activeProfileSet.parameterName,
        SESSION_SECRET_PARAM: CONFIG.sessionSecretParameterName,
        TABLE_NAME: props.table.tableName,
        DATA_BUCKET: props.dataBucket.bucketName,
        INDEX_VERSION: CONFIG.indexVersion,
        QUEUE_URL: props.queue.queueUrl,
        WORKSPACE_HOURLY_ANALYSIS_CAP: String(CONFIG.caps.workspaceHourlyAnalyses),
        GLOBAL_DAILY_ANALYSIS_CAP: String(CONFIG.caps.globalDailyAnalyses),
        DAILY_WORKSPACE_CREATION_CAP: String(CONFIG.caps.dailyWorkspaceCreations),
        PER_IP_DAILY_WORKSPACE_CAP: String(CONFIG.caps.perClientDailyWorkspaceCreations),
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        // No Docker on the build machine; esbuild comes from node_modules.
        forceDockerBundling: false,
        minify: true,
        sourceMap: true,
        target: 'node22',
        format: nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        // Some CJS dependencies call require(); ESM output has no require without this.
        banner:
          "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
        // The Node 22 runtime ships AWS SDK v3.
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Least privilege (architecture §11), hand-written instead of grant*(), which add more
    // actions than the api uses. No Bedrock permission: the api never generates.
    const account = Stack.of(this).account;
    const region = Stack.of(this).region;
    const fn = this.apiFunction;
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          props.killSwitch.parameterArn,
          props.activeProfileSet.parameterArn,
          // The SecureString is decrypted with the AWS-managed aws/ssm key, whose key policy
          // allows any principal in the account via SSM; no kms statement is needed.
          `arn:aws:ssm:${region}:${account}:parameter${CONFIG.sessionSecretParameterName}`,
        ],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:BatchWriteItem'],
        resources: [props.table.tableArn],
      }),
    );
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [props.queue.queueArn] }));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        // Profiles, the index manifest, and (Phase 6) the processed filings and adjacency files behind
        // the source view and adjacent-period evidence, for this index version only. Deliberately no
        // s3:ListBucket: a missing key then answers 403, which the api reads as "missing" with a
        // warning (services/api/src/s3-missing.ts), so the role cannot enumerate the bucket.
        resources: [
          props.dataBucket.arnForObjects('intelligence/*'),
          props.dataBucket.arnForObjects(`index/${CONFIG.indexVersion}/manifest.json`),
          props.dataBucket.arnForObjects(`index/${CONFIG.indexVersion}/adjacency/*`),
          props.dataBucket.arnForObjects(`processed/${CONFIG.indexVersion}/*`),
        ],
      }),
    );

    // The default stage is created explicitly so its throttle is part of the template.
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${CONFIG.project}-api`,
      createDefaultStage: false,
    });
    this.httpApi.addStage('DefaultStage', {
      stageName: '$default',
      autoDeploy: true,
      throttle: {
        rateLimit: CONFIG.api.throttleRateLimit,
        burstLimit: CONFIG.api.throttleBurstLimit,
      },
    });
    // No CORS: the browser reaches this API same-origin through the Amplify rewrite.
    this.httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', this.apiFunction, {
        payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
      }),
    });

    this.apiEndpoint = this.httpApi.apiEndpoint;
    new logs.MetricFilter(this, 'Api5xxFilter', {
      logGroup,
      filterPattern: logs.FilterPattern.all(logs.FilterPattern.stringValue('$.event', '=', 'api_request'), logs.FilterPattern.numberValue('$.status', '>=', 500)),
      metricNamespace: METRIC_NAMESPACE,
      metricName: API_5XX,
      metricValue: '1',
    });
    // An analysis failed lazily on poll (QUEUE_TIMEOUT, or a run past its deadline) logs the same
    // failed summary line as the worker; it feeds the worker's AnalysisFailed series by code.
    new logs.MetricFilter(this, 'AnalysisFailedFilter', {
      logGroup,
      filterPattern: logs.FilterPattern.all(logs.FilterPattern.stringValue('$.event', '=', 'analysis_summary'), logs.FilterPattern.stringValue('$.status', '=', 'failed')),
      metricNamespace: METRIC_NAMESPACE,
      metricName: WORKER_METRICS.failedByCode,
      metricValue: '1',
      dimensions: { Code: '$.code' },
    });

    new CfnOutput(this, 'ApiEndpoint', { value: this.apiEndpoint });
  }
}
