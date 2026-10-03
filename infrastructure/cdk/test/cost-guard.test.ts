import { App, Duration, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import { beforeAll, describe, expect, it } from 'vitest';
import { findCostViolations, type GuardRule, type Violation } from '../lib/cost-guard';
import { cdkJsonContext, toGuardTemplates } from './synth';

/** A stack that breaks every rule on purpose, to prove the guard catches each one. */
function buildBadStack(): Stack {
  const app = new App({ context: cdkJsonContext() });
  const stack = new Stack(app, 'Bad', { env: { account: '111111111111', region: 'us-east-1' } });

  new ec2.CfnNatGateway(stack, 'Nat', { subnetId: 'subnet-0123456789abcdef0' });
  new opensearch.CfnDomain(stack, 'Search', {});

  const goodLogs = new logs.LogGroup(stack, 'GoodLogs', { retention: logs.RetentionDays.TWO_WEEKS });
  const reserved = new lambda.Function(stack, 'Reserved', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {}'),
    reservedConcurrentExecutions: 5,
    logGroup: goodLogs,
  });
  new lambda.Alias(stack, 'Warm', {
    aliasName: 'live',
    version: reserved.currentVersion,
    provisionedConcurrentExecutions: 1,
  });

  new lambda.Function(stack, 'LegacyRetention', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {}'),
    logRetention: logs.RetentionDays.ONE_WEEK,
  });

  new events.Rule(stack, 'Nightly', { schedule: events.Schedule.rate(Duration.days(1)) });
  new logs.LogGroup(stack, 'ForeverLogs', { retention: logs.RetentionDays.INFINITE });

  new dynamodb.Table(stack, 'Provisioned', {
    partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PROVISIONED,
  });

  const role = new iam.Role(stack, 'Admin', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
  role.addToPolicy(new iam.PolicyStatement({ actions: ['*'], resources: ['arn:aws:s3:::x'] }));
  role.addToPolicy(new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: ['*'] }));
  return stack;
}

let violations: Violation[];
const rulesFor = (pattern: RegExp) =>
  violations.filter((v) => pattern.test(v.logicalId)).map((v) => v.rule);

beforeAll(() => {
  violations = findCostViolations(toGuardTemplates([buildBadStack()]));
});

describe('cost guard negative tests', () => {
  it.each<[string, RegExp, GuardRule]>([
    ['a NAT gateway', /^Nat$/, 'forbidden-resource'],
    ['an OpenSearch domain', /^Search$/, 'forbidden-resource'],
    ['reserved concurrency', /^Reserved/, 'reserved-concurrency'],
    ['provisioned concurrency', /^Warm/, 'provisioned-concurrency'],
    ['a scheduled EventBridge rule', /^Nightly/, 'scheduled-rule'],
    ['a log group without retention', /^ForeverLogs/, 'log-retention'],
    ['a Lambda without an explicit log group', /^LegacyRetention/, 'lambda-log-group'],
    ['the LogRetention custom resource', /^LegacyRetention/, 'forbidden-resource'],
    ['provisioned DynamoDB billing', /^Provisioned/, 'dynamodb-billing'],
    ['an Action: * grant', /^Admin/, 'iam-wildcard-action'],
    ['a Resource: * grant', /^Admin/, 'iam-wildcard-resource'],
    // CDK's default Lambda role attaches AWSLambdaBasicExecutionRole (logs on every log group).
    ['an AWS-managed policy on a role', /^ReservedServiceRole/, 'iam-managed-policy'],
  ])('reports %s', (_label, logicalId, rule) => {
    expect(rulesFor(logicalId)).toContain(rule);
  });

  it('does not flag the correctly configured log group', () => {
    expect(rulesFor(/^GoodLogs/)).toEqual([]);
  });

  it('flags the hidden LogRetention provider Lambda too', () => {
    const provider = violations.filter((v) => /^LogRetention[0-9a-f]{32}[0-9A-F]{8}$/.test(v.logicalId));
    expect(provider.map((v) => v.rule)).toContain('lambda-log-group');
  });
});

describe('cost guard rule details', () => {
  const guard = (resources: Record<string, unknown>) =>
    findCostViolations([{ stackName: 'T', template: { Resources: resources } }]).map((v) => v.rule);

  it('allows unscheduled (event-pattern) rules', () => {
    expect(guard({ R: { Type: 'AWS::Events::Rule', Properties: { EventPattern: {} } } })).toEqual([]);
  });

  it('flags every forbidden family', () => {
    for (const type of [
      'AWS::OpenSearchServerless::Collection',
      'AWS::Elasticsearch::Domain',
      'AWS::EC2::Instance',
      'AWS::EC2::VPC',
      'AWS::ECS::Cluster',
      'AWS::RDS::DBCluster',
      'AWS::WAFv2::WebACL',
      'AWS::ElastiCache::CacheCluster',
      'AWS::Redshift::Cluster',
      'AWS::Scheduler::Schedule',
    ]) {
      expect(guard({ X: { Type: type, Properties: {} } }), type).toEqual(['forbidden-resource']);
    }
  });

  it('flags a log group reference that is not a LogGroup in the stack', () => {
    expect(
      guard({
        F: { Type: 'AWS::Lambda::Function', Properties: { LoggingConfig: { LogGroup: 'imported' } } },
      }),
    ).toEqual(['lambda-log-group']);
  });

  it('ignores Deny statements and flags NotAction allows', () => {
    const policy = (Statement: unknown[]) => ({
      P: { Type: 'AWS::IAM::Policy', Properties: { PolicyDocument: { Statement } } },
    });
    expect(guard(policy([{ Effect: 'Deny', Action: '*', Resource: '*' }]))).toEqual([]);
    expect(guard(policy([{ Effect: 'Allow', NotAction: 's3:*', Resource: 'arn:x' }]))).toEqual([
      'iam-wildcard-action',
    ]);
    expect(guard(policy([{ Effect: 'Allow', Action: ['s3:*'], Resource: ['arn:x'] }]))).toEqual([
      'iam-wildcard-action',
    ]);
  });
});
