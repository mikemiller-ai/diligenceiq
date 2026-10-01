import { Match, type Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG, PRODUCTION_URL } from '../lib/config';
import { findCostViolations, formatViolations, grantedActions, type GuardTemplate } from '../lib/cost-guard';
import { SECURITY_HEADERS } from '../lib/web-stack';
import { synthAll } from './synth';

let stacks: ReturnType<typeof synthAll>['stacks'];
let templates: { core: Template; api: Template; web: Template };
let guardInput: GuardTemplate[];

beforeAll(() => {
  ({ stacks, templates, guardInput } = synthAll());
}, 120_000);

type Json = Record<string, unknown>;
const resourcesOf = (t: Template, type: string) => Object.values(t.findResources(type)) as Json[];
const propsOf = (r: Json) => (r.Properties ?? {}) as Json;

describe('cost guard over the real app', () => {
  it('finds no violations in any stack', () => {
    const violations = findCostViolations(guardInput);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('synthesizes all three stacks in us-east-1 with the project tag', () => {
    expect(guardInput.map((g) => g.stackName)).toEqual([
      CONFIG.stackNames.core,
      CONFIG.stackNames.api,
      CONFIG.stackNames.web,
    ]);
    for (const stack of [stacks.core, stacks.api, stacks.web]) {
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

  it('grants the api Lambda only ssm:GetParameter on the kill switch', () => {
    expect(grantedActions(templates.api.toJSON())).toEqual(['ssm:GetParameter']);
    templates.api.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Action: 'ssm:GetParameter',
            Resource: Match.objectLike({
              'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':parameter$')])],
            }),
          },
        ],
      },
    });
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
