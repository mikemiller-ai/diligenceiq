import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CONFIG, PATHS } from './config';

export interface ApiStackProps extends StackProps {
  table: dynamodb.ITable;
  killSwitch: ssm.IStringParameter;
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
      environment: {
        KILL_SWITCH_PARAM: props.killSwitch.parameterName,
        TABLE_NAME: props.table.tableName,
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

    // Phase 1 reads only the kill switch; table access is granted when routes use it.
    // A hand-written statement instead of grantRead(), which also adds GetParameters,
    // GetParameterHistory and DescribeParameters.
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [props.killSwitch.parameterArn],
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
    new CfnOutput(this, 'ApiEndpoint', { value: this.apiEndpoint });
  }
}
