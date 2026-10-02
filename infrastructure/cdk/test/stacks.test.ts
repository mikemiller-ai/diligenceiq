import { Match, type Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, PRODUCTION_URL } from '../lib/config';
import { findCostViolations, formatViolations, grantedActions, type GuardTemplate } from '../lib/cost-guard';
import { SECURITY_HEADERS } from '../lib/web-stack';
import { GENERATION_CALLS_OVER_ONE } from '../lib/worker-stack';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { synthAll } from './synth';

let stacks: ReturnType<typeof synthAll>['stacks'];
let templates: { core: Template; api: Template; web: Template; worker: Template };
let app: ReturnType<typeof synthAll>['app'];
let guardInput: GuardTemplate[];

beforeAll(() => {
  ({ app, stacks, templates, guardInput } = synthAll());
}, 120_000);

type Json = Record<string, unknown>;
const resourcesOf = (t: Template, type: string) => Object.values(t.findResources(type)) as Json[];
const propsOf = (r: Json) => (r.Properties ?? {}) as Json;

describe('cost guard over the real app', () => {
  it('finds no violations in any stack', () => {
    const violations = findCostViolations(guardInput);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('synthesizes all four stacks in us-east-1 with the project tag', () => {
    expect(guardInput.map((g) => g.stackName)).toEqual([
      CONFIG.stackNames.core,
      CONFIG.stackNames.api,
      CONFIG.stackNames.web,
      CONFIG.stackNames.worker,
    ]);
    for (const stack of [stacks.core, stacks.api, stacks.web, stacks.worker]) {
      expect(stack.region).toBe('us-east-1');
      expect(stack.account).toBe(CONFIG.account);
      expect(stack.tags.tagValues()).toMatchObject({ project: 'diligenceiq' });
    }
  });
});

describe('CoreStack', () => {
  it('has an on-demand table with PK/SK and TTL on ttl, retained, without PITR', () => {
    templates.core.resourceCountIs('AWS::DynamoDB::Table', 1);
    templates.core.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
        TableName: Match.absent(),
        ProvisionedThroughput: Match.absent(),
      },
    });
  });

  it('has a private, TLS-only, unversioned, retained data bucket', () => {
    templates.core.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
        VersioningConfiguration: Match.absent(),
        LifecycleConfiguration: {
          Rules: [Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } })],
        },
      },
    });
    templates.core.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('adds no auto-delete custom resource', () => {
    expect(resourcesOf(templates.core, 'AWS::Lambda::Function')).toHaveLength(0);
    expect(Object.keys(templates.core.findResources('Custom::S3AutoDeleteObjects'))).toHaveLength(0);
  });

  it('creates the kill switch parameter, off by default', () => {
    templates.core.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/diligenceiq/analyses-enabled',
      Type: 'String',
      Value: 'false',
    });
  });
});

describe('ApiStack', () => {
  it('runs the api Lambda on Node 22 arm64, 256 MB, 10 s, with an explicit 14-day log group', () => {
    const fns = resourcesOf(templates.api, 'AWS::Lambda::Function');
    expect(fns).toHaveLength(1);
    templates.api.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      MemorySize: 256,
      Timeout: 10,
      ReservedConcurrentExecutions: Match.absent(),
      LoggingConfig: { LogGroup: { Ref: Match.anyValue() } },
      Environment: {
        Variables: {
          KILL_SWITCH_PARAM: Match.anyValue(),
          TABLE_NAME: Match.anyValue(),
          NODE_OPTIONS: '--enable-source-maps',
        },
      },
    });
    const logGroups = templates.api.findResources('AWS::Logs::LogGroup');
    const ref = (propsOf(fns[0]!).LoggingConfig as Json).LogGroup as { Ref: string };
    expect(logGroups[ref.Ref]).toMatchObject({ Properties: { RetentionInDays: 14 } });
  });

  it('grants the api Lambda exactly what its routes use (architecture §11; evidence reads from Phase 6)', () => {
    expect(grantedActions(templates.api.toJSON()).sort()).toEqual(
      ['dynamodb:BatchWriteItem', 'dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem', 's3:GetObject', 'sqs:SendMessage', 'ssm:GetParameter'].sort(),
    );
    const statements = Object.values(templates.api.findResources('AWS::IAM::Policy')).flatMap((p) => (propsOf(p).PolicyDocument as { Statement: Json[] }).Statement);
    const s3 = JSON.stringify(statements.find((s) => s.Action === 's3:GetObject'));
    // Profiles, the index manifest, and this index version's adjacency files and processed filings:
    // never the raw corpus, the other index artifacts (vectors, BM25, chunks) or another version.
    const resources = ((statements.find((s) => s.Action === 's3:GetObject')?.Resource ?? []) as Json[]).map((r) => JSON.stringify(r));
    expect(resources).toHaveLength(4);
    expect(s3).toContain('/intelligence/*');
    expect(s3).toContain(`/index/${CONFIG.indexVersion}/manifest.json`);
    expect(s3).toContain(`/index/${CONFIG.indexVersion}/adjacency/*`);
    expect(s3).toContain(`/processed/${CONFIG.indexVersion}/*`);
    expect(s3).not.toMatch(/"\/\*"|index\/\*|corpus\//);
    const ssm = JSON.stringify(statements.find((s) => s.Action === 'ssm:GetParameter'));
    expect(ssm).toContain(`parameter${CONFIG.sessionSecretParameterName}`);
    expect(ssm.match(/parameter/g)?.length).toBeGreaterThanOrEqual(3);
    templates.api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ QUEUE_URL: Match.anyValue(), SESSION_SECRET_PARAM: CONFIG.sessionSecretParameterName, ACTIVE_PROFILE_SET_PARAM: Match.anyValue(), GLOBAL_DAILY_ANALYSIS_CAP: '200', DAILY_WORKSPACE_CREATION_CAP: '500', PER_IP_DAILY_WORKSPACE_CAP: '100' }) },
    });
  });

  it('creates the active-profile-set parameter, "none" by default', () => {
    templates.core.hasResourceProperties('AWS::SSM::Parameter', { Name: CONFIG.activeProfileSetParameterName, Value: 'none', Type: 'String' });
  });

  it('never lets the api Lambda call Bedrock', () => {
    for (const action of grantedActions(templates.api.toJSON())) {
      expect(action.toLowerCase().startsWith('bedrock:')).toBe(false);
      expect(action).not.toBe('*');
    }
  });

  it('routes ANY /api/{proxy+} to the Lambda with payload v2, no CORS', () => {
    templates.api.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.absent(),
    });
    templates.api.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /api/{proxy+}',
    });
    templates.api.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      PayloadFormatVersion: '2.0',
    });
  });

  it('throttles the default stage at 10 rps, burst 20', () => {
    templates.api.resourceCountIs('AWS::ApiGatewayV2::Stage', 1);
    templates.api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
  });

  it('exports the API endpoint', () => {
    templates.api.hasOutput('ApiEndpoint', {});
  });
});

describe('WebStack', () => {
  const app = () => propsOf(resourcesOf(templates.web, 'AWS::Amplify::App')[0]!);

  it('is a WEB-platform Amplify app with no connected repository', () => {
    templates.web.resourceCountIs('AWS::Amplify::App', 1);
    expect(app()).toMatchObject({ Name: 'diligenceiq', Platform: 'WEB' });
    expect(app().Repository).toBeUndefined();
    expect(app().AccessToken).toBeUndefined();
  });

  it('proxies /api/<*> to the HTTP API first and falls back to 404 last', () => {
    const rules = app().CustomRules as Array<{ Source: string; Target: unknown; Status: string }>;
    expect(rules).toHaveLength(2);
    const [apiRule, notFound] = rules;
    expect(apiRule).toMatchObject({ Source: '/api/<*>', Status: '200' });
    const join = (apiRule!.Target as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
    expect(join[1].at(-1)).toBe('/api/<*>');
    expect(join[1].at(0)).toBeTypeOf('object'); // the API endpoint token
    expect(notFound).toEqual({ Source: '/<*>', Target: '/404.html', Status: '404' });
  });

  it('sets the security headers on every path', () => {
    const yaml = app().CustomHeaders as string;
    expect(yaml).toContain("pattern: '**'");
    for (const [key, value] of SECURITY_HEADERS) {
      expect(yaml).toContain(`key: '${key}'`);
      expect(yaml).toContain(`value: "${value}"`);
    }
    expect(yaml).toContain("frame-ancestors 'none'");
  });

  it('has a manual-deploy production main branch', () => {
    templates.web.hasResourceProperties('AWS::Amplify::Branch', {
      BranchName: 'main',
      Stage: 'PRODUCTION',
      Framework: 'Web',
      EnableAutoBuild: false,
    });
  });

  it('maps diligenceiq.mikemiller.ai to main', () => {
    templates.web.hasResourceProperties('AWS::Amplify::Domain', {
      DomainName: 'mikemiller.ai',
      EnableAutoSubDomain: false,
      SubDomainSettings: [{ Prefix: 'diligenceiq', BranchName: Match.anyValue() }],
    });
  });

  it('outputs the app id, branch, production URL and default domain', () => {
    templates.web.hasOutput('ProductionUrl', { Value: PRODUCTION_URL });
    for (const name of ['AmplifyAppId', 'BranchName', 'AmplifyDefaultDomain']) {
      templates.web.hasOutput(name, {});
    }
    expect(PRODUCTION_URL).toBe('https://diligenceiq.mikemiller.ai');
  });
});

describe('WorkerStack (architecture §4.3, §5; DD-04)', () => {
  const fnByEntry = (t: Template, memory: number) => Object.entries(t.findResources('AWS::Lambda::Function')).find(([, r]) => propsOf(r as Json).MemorySize === memory)!;

  it('analysis queue: 1080 s visibility, redrive to the DLQ after 3 receives, SSE, TLS only', () => {
    const queues = templates.worker.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues)).toHaveLength(2);
    templates.worker.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 1080,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
      SqsManagedSseEnabled: true,
    });
    expect(Object.keys(templates.worker.findResources('AWS::SQS::QueuePolicy')).length).toBe(2);
  });

  it('worker: Node 22 arm64, 3008 MB, 180 s, no reserved concurrency, 14-day logs, the index and models from config', () => {
    const [, worker] = fnByEntry(templates.worker, 3008);
    expect(propsOf(worker as Json)).toMatchObject({
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 180,
      Environment: { Variables: { INDEX_VERSION: 'iv-9cf51c066743', GENERATION_MODEL_ID: 'us.anthropic.claude-sonnet-4-6', EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0' } },
    });
    expect(propsOf(worker as Json).ReservedConcurrentExecutions).toBeUndefined();
    // The visibility timeout is 6 × the worker timeout and exceeds the 240 s job deadline.
    expect(CONFIG.worker.visibilityTimeoutSeconds).toBe(6 * CONFIG.worker.timeoutSeconds);
    expect(CONFIG.worker.visibilityTimeoutSeconds * 1000).toBeGreaterThan(240_000);
  });

  it('event source mappings: worker batch 1 with maximum concurrency 2; the DLQ has its own handler', () => {
    const mappings = resourcesOf(templates.worker, 'AWS::Lambda::EventSourceMapping').map(propsOf);
    expect(mappings).toHaveLength(2);
    expect(mappings).toContainEqual(expect.objectContaining({ BatchSize: 1, ScalingConfig: { MaximumConcurrency: 2 } }));
    expect(mappings.filter((m) => m.BatchSize === 10)).toHaveLength(1);
  });

  it('only the worker can call Bedrock: the generation profile and its foundation models, and Titan', () => {
    const statements = resourcesOf(templates.worker, 'AWS::IAM::Policy').flatMap((p) => ((propsOf(p).PolicyDocument as Json).Statement as Json[]));
    const bedrock = statements.filter((s) => String(s.Action).startsWith('bedrock:'));
    expect(bedrock.map((s) => s.Action).sort()).toEqual(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream']);
    const json = JSON.stringify(bedrock);
    expect(json).toContain('inference-profile/us.anthropic.claude-sonnet-4-6');
    for (const r of ['us-east-1', 'us-east-2', 'us-west-2']) expect(json).toContain(`arn:aws:bedrock:${r}::foundation-model/anthropic.claude-sonnet-4-6`);
    expect(json).toContain('foundation-model/amazon.titan-embed-text-v2:0');
    expect(json).not.toContain('"*"');
    for (const t of [templates.core, templates.api, templates.web]) expect(grantedActions(t.toJSON()).some((a) => a.startsWith('bedrock:'))).toBe(false);
    // The DLQ handler's role has no Bedrock action either.
    const roles = Object.keys(templates.worker.findResources('AWS::IAM::Role'));
    expect(roles.length).toBe(2);
  });

  it('the worker reads only index/<version>/* from S3 and touches the table item by item', () => {
    const json = JSON.stringify(templates.worker.toJSON());
    expect(json).toContain('/index/iv-9cf51c066743/*');
    const actions = grantedActions(templates.worker.toJSON());
    expect(actions.filter((a) => a.startsWith('dynamodb:')).sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:UpdateItem'].sort());
    expect(actions.filter((a) => a.startsWith('s3:'))).toEqual(['s3:GetObject']);
  });

  it('alarms if an analysis ever logs generationCallCount > 1 (SPEC §30.1)', () => {
    templates.worker.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '{ ($.event = "analysis_summary") && ($.generationCallCount > 1) }',
      MetricTransformations: [Match.objectLike({ MetricName: GENERATION_CALLS_OVER_ONE, MetricValue: '1' })],
    });
    templates.worker.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: GENERATION_CALLS_OVER_ONE, Threshold: 1, TreatMissingData: 'notBreaching' });
  });

  it('bundles: the worker carries the Deep Analysis prompt; no bundle carries the offline profile builder or its prompt', () => {
    const outdir = app.outdir;
    const bundles: Record<string, string> = {};
    for (const [stack, t] of [['api', templates.api], ['worker', templates.worker]] as const) {
      for (const [id, r] of Object.entries(t.findResources('AWS::Lambda::Function'))) {
        const key = String(((propsOf(r as Json).Code as Json).S3Key as string | undefined) ?? '');
        const file = join(outdir, `asset.${key.replace(/\.zip$/, '')}`, 'index.mjs');
        if (key && existsSync(file)) bundles[`${stack}/${id}`] = readFileSync(file, 'utf8');
      }
    }
    expect(Object.keys(bundles).length).toBe(3);
    for (const [name, code] of Object.entries(bundles)) {
      expect(code, name).not.toMatch(/submit_company_profile|company-intelligence-prompt|scripts\/intelligence|build-profiles/);
    }
    const worker = Object.entries(bundles).find(([n, code]) => n.startsWith('worker/') && code.includes('submit_diligence_brief'));
    expect(worker).toBeDefined();
    expect(Object.entries(bundles).filter(([n]) => n.startsWith('api/')).every(([, code]) => !code.includes('submit_diligence_brief'))).toBe(true);
  });
});
