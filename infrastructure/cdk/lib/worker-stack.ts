import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CONFIG, PATHS } from './config';
import { lambdaRole } from './lambda-role';

export interface WorkerStackProps extends StackProps {
  table: dynamodb.ITable;
  dataBucket: s3.IBucket;
  killSwitch: ssm.IStringParameter;
  /** Where both alarms notify (Phase 8). */
  alertTopic: sns.ITopic;
}

/** Metric namespace for the single-call alarm (SPEC §30.1). */
export const METRIC_NAMESPACE = 'DiligenceIQ';
export const GENERATION_CALLS_OVER_ONE = 'GenerationCallsOverOne';
/** Phase 7 metrics from the worker's `analysis_summary` line (architecture §12). */
export const WORKER_METRICS = {
  generationDurationMs: 'GenerationDurationMs',
  estimatedCostUsd: 'AnalysisEstimatedCostUsd',
  citationsRemoved: 'CitationsRemovedByValidation',
  failedByCode: 'AnalysisFailed',
} as const;

/**
 * The async analysis plane (architecture §4.1, §4.3, §5; DD-03, DD-04, DD-14): the analysis
 * queue, the worker (the only Lambda that can call Bedrock), the DLQ and its handler.
 * Everything scales to zero: no reserved or provisioned concurrency, no schedules.
 */
export class WorkerStack extends Stack {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly workerFunction: nodejs.NodejsFunction;
  public readonly dlqFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: WorkerStackProps) {
    super(scope, id, props);
    const w = CONFIG.worker;

    this.deadLetterQueue = new sqs.Queue(this, 'AnalysisDlq', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(4),
    });
    this.queue = new sqs.Queue(this, 'AnalysisQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // 6 × the worker timeout, and far past the 240 s job deadline: a redelivered message
      // always finds its analysis past the deadline and is acknowledged without work (DD-04).
      visibilityTimeout: Duration.seconds(w.visibilityTimeoutSeconds),
      retentionPeriod: Duration.days(1),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: w.maxReceiveCount },
    });

    const bundling: nodejs.BundlingOptions = {
      forceDockerBundling: false,
      minify: true,
      sourceMap: true,
      target: 'node22',
      format: nodejs.OutputFormat.ESM,
      mainFields: ['module', 'main'],
      banner: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
      // The pinned AWS SDK is bundled (not the runtime's), so the Bedrock client's maxAttempts
      // and stream handling are the versions the tests ran against.
      externalModules: [],
    };
    const fn = (name: string, entry: string, logGroup: logs.LogGroup, extra: Partial<nodejs.NodejsFunctionProps>) =>
      new nodejs.NodejsFunction(this, name, {
        entry,
        handler: 'handler',
        projectRoot: PATHS.repoRoot,
        depsLockFilePath: PATHS.lockFile,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        logGroup,
        role: lambdaRole(this, `${name}Role`, logGroup),
        bundling,
        ...extra,
      });

    const workerLogs = new logs.LogGroup(this, 'WorkerFunctionLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY });
    this.workerFunction = fn('WorkerFunction', PATHS.workerHandler, workerLogs, {
      memorySize: w.memoryMb,
      timeout: Duration.seconds(w.timeoutSeconds),
      environment: {
        TABLE_NAME: props.table.tableName,
        DATA_BUCKET: props.dataBucket.bucketName,
        INDEX_VERSION: CONFIG.indexVersion,
        KILL_SWITCH_PARAM: props.killSwitch.parameterName,
        GENERATION_MODEL_ID: CONFIG.models.generationProfile,
        EMBEDDING_MODEL_ID: CONFIG.models.embedding,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });
    this.workerFunction.addEventSource(new SqsEventSource(this.queue, { batchSize: 1, maxConcurrency: w.maxConcurrency }));

    const account = Stack.of(this).account;
    const wp = this.workerFunction;
    wp.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:PutItem'],
        resources: [props.table.tableArn],
      }),
    );
    wp.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [props.dataBucket.arnForObjects(`index/${CONFIG.indexVersion}/*`)] }));
    wp.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [props.killSwitch.parameterArn] }));
    // Generation: the inference profile and the foundation models it routes to (assumptions D3).
    wp.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:${CONFIG.region}:${account}:inference-profile/${CONFIG.models.generationProfile}`,
          ...CONFIG.models.generationRegions.map((r) => `arn:aws:bedrock:${r}::foundation-model/${CONFIG.models.generationFoundationModel}`),
        ],
      }),
    );
    // Retrieval: one query embedding per analysis.
    wp.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [`arn:aws:bedrock:${CONFIG.region}::foundation-model/${CONFIG.models.embedding}`] }));

    const dlqLogs = new logs.LogGroup(this, 'DlqFunctionLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY });
    this.dlqFunction = fn('DlqFunction', PATHS.dlqHandler, dlqLogs, {
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: { TABLE_NAME: props.table.tableName, NODE_OPTIONS: '--enable-source-maps' },
    });
    this.dlqFunction.addEventSource(new SqsEventSource(this.deadLetterQueue, { batchSize: 10 }));
    this.dlqFunction.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:UpdateItem'], resources: [props.table.tableArn] }));

    // SPEC §30.1: generationCallCount must never exceed 1. The metric filter is free; the alarm
    // is about $0.10 a month. It notifies the alert topic (Phase 8).
    const overOne = new logs.MetricFilter(this, 'GenerationCallsOverOneFilter', {
      logGroup: workerLogs,
      filterPattern: logs.FilterPattern.all(logs.FilterPattern.stringValue('$.event', '=', 'analysis_summary'), logs.FilterPattern.numberValue('$.generationCallCount', '>', 1)),
      metricNamespace: METRIC_NAMESPACE,
      metricName: GENERATION_CALLS_OVER_ONE,
      metricValue: '1',
      defaultValue: 0,
    });
    const overOneAlarm = new cloudwatch.Alarm(this, 'GenerationCallsOverOneAlarm', {
      metric: overOne.metric({ statistic: 'Sum', period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'An analysis made more than one generation call (SPEC §30.1). This must never happen.',
    });

    // Phase 7 (architecture §12). Metric filters cost nothing to define and publish only when a
    // matching line arrives, so an idle app publishes nothing. All read the one summary line.
    const summaryOf = (status?: string) =>
      status
        ? logs.FilterPattern.all(logs.FilterPattern.stringValue('$.event', '=', 'analysis_summary'), logs.FilterPattern.stringValue('$.status', '=', status))
        : logs.FilterPattern.stringValue('$.event', '=', 'analysis_summary');
    new logs.MetricFilter(this, 'GenerationDurationFilter', {
      logGroup: workerLogs,
      filterPattern: summaryOf('complete'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: WORKER_METRICS.generationDurationMs,
      metricValue: '$.generationDurationMs',
      unit: cloudwatch.Unit.MILLISECONDS,
    });
    // Every status: a failed or timed-out generation is still billed (a lower bound when costIncomplete).
    new logs.MetricFilter(this, 'EstimatedCostFilter', {
      logGroup: workerLogs,
      filterPattern: summaryOf(),
      metricNamespace: METRIC_NAMESPACE,
      metricName: WORKER_METRICS.estimatedCostUsd,
      metricValue: '$.estimatedCostUsd',
    });
    new logs.MetricFilter(this, 'CitationsRemovedFilter', {
      logGroup: workerLogs,
      filterPattern: summaryOf('complete'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: WORKER_METRICS.citationsRemoved,
      metricValue: '$.citationsRemoved',
    });
    // Malformed outputs, generation timeouts and other failures, one series per error code.
    new logs.MetricFilter(this, 'AnalysisFailedFilter', {
      logGroup: workerLogs,
      filterPattern: summaryOf('failed'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: WORKER_METRICS.failedByCode,
      metricValue: '1',
      dimensions: { Code: '$.code' },
    });
    // The dlq-handler's failed lines (the worker gave up on the message) feed the same series.
    new logs.MetricFilter(this, 'AnalysisFailedDlqFilter', {
      logGroup: dlqLogs,
      filterPattern: summaryOf('failed'),
      metricNamespace: METRIC_NAMESPACE,
      metricName: WORKER_METRICS.failedByCode,
      metricValue: '1',
      dimensions: { Code: '$.code' },
    });
    // The dlq-handler drains the DLQ within seconds, so the queue's depth would almost never be
    // seen at 1; the handler's invocations are the signal instead: each one is at least one
    // analysis message the worker gave up on (the handler marks it failed). Lambda metrics are
    // free; the alarm is about $0.10 a month. It notifies the alert topic (Phase 8).
    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqHandlerInvokedAlarm', {
      metric: this.dlqFunction.metricInvocations({ statistic: 'Sum', period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'An analysis message reached the dead-letter queue and the dlq-handler ran (architecture §12).',
    });

    for (const alarm of [overOneAlarm, dlqAlarm]) alarm.addAlarmAction(new cloudwatchActions.SnsAction(props.alertTopic));

    new CfnOutput(this, 'AnalysisQueueUrl', { value: this.queue.queueUrl });
    new CfnOutput(this, 'WorkerFunctionName', { value: this.workerFunction.functionName });
    new CfnOutput(this, 'TableName', { value: props.table.tableName });
  }
}
