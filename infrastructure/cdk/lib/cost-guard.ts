/**
 * Cost and least-privilege guard over synthesized CloudFormation templates
 * (architecture §13.1, testing-strategy §5). Pure data in, violations out, so the tests can
 * run it against both the real app and a deliberately bad stack.
 */

export interface GuardTemplate {
  stackName: string;
  template: Record<string, unknown>;
}

export interface Violation {
  stack: string;
  logicalId: string;
  rule: GuardRule;
  message: string;
}

export type GuardRule =
  | 'forbidden-resource'
  | 'scheduled-rule'
  | 'reserved-concurrency'
  | 'provisioned-concurrency'
  | 'lambda-log-group'
  | 'log-retention'
  | 'dynamodb-billing'
  | 'iam-wildcard-action'
  | 'iam-wildcard-resource';

export const REQUIRED_LOG_RETENTION_DAYS = 14;

/** Each of these bills around the clock (or, for LogRetention, adds a hidden Lambda). */
export const FORBIDDEN_RESOURCE_TYPES: ReadonlyArray<RegExp> = [
  /^AWS::OpenSearchService::/,
  /^AWS::OpenSearchServerless::/,
  /^AWS::Elasticsearch::/,
  /^AWS::EC2::NatGateway$/,
  /^AWS::EC2::Instance$/,
  /^AWS::EC2::VPC$/,
  /^AWS::ECS::/,
  /^AWS::RDS::/,
  /^AWS::WAFv2::/,
  /^AWS::ElastiCache::/,
  /^AWS::Redshift::/,
  /^AWS::Scheduler::/,
  /^Custom::LogRetention$/,
];

/**
 * Allow statements whose actions are all listed here may use `Resource: '*'`, because the
 * service has no resource-level permissions for them. Empty in Phase 1. A future entry
 * (e.g. X-Ray `xray:PutTraceSegments`) must say why it can't be scoped.
 */
export const WILDCARD_RESOURCE_ALLOWLIST: ReadonlyArray<{ action: string; reason: string }> = [];

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

interface PolicyStatement {
  Effect?: string;
  Action?: unknown;
  NotAction?: unknown;
  Resource?: unknown;
  NotResource?: unknown;
}

export function findCostViolations(templates: readonly GuardTemplate[]): Violation[] {
  const violations: Violation[] = [];
  for (const { stackName, template } of templates) {
    const resources = (template.Resources ?? {}) as Record<string, CfnResource>;
    const add = (logicalId: string, rule: GuardRule, message: string) =>
      violations.push({ stack: stackName, logicalId, rule, message });

    for (const [id, res] of Object.entries(resources)) {
      const props = res.Properties ?? {};

      if (FORBIDDEN_RESOURCE_TYPES.some((re) => re.test(res.Type))) {
        add(id, 'forbidden-resource', `${res.Type} is not allowed (idle cost)`);
      }

      switch (res.Type) {
        case 'AWS::Events::Rule':
          if (props.ScheduleExpression !== undefined) {
            add(id, 'scheduled-rule', 'scheduled EventBridge rules are not allowed');
          }
          break;
        case 'AWS::Lambda::Function': {
          if (props.ReservedConcurrentExecutions !== undefined) {
            add(id, 'reserved-concurrency', 'reserved concurrency takes from the shared account limit');
          }
          const target = refTarget((props.LoggingConfig as Record<string, unknown> | undefined)?.LogGroup);
          if (!target || resources[target]?.Type !== 'AWS::Logs::LogGroup') {
            add(id, 'lambda-log-group', 'function must log to an explicit AWS::Logs::LogGroup in its stack');
          }
          break;
        }
        case 'AWS::Lambda::Alias':
        case 'AWS::Lambda::Version':
          if (props.ProvisionedConcurrencyConfig !== undefined) {
            add(id, 'provisioned-concurrency', 'provisioned concurrency bills while idle');
          }
          break;
        case 'AWS::Logs::LogGroup':
          if (props.RetentionInDays !== REQUIRED_LOG_RETENTION_DAYS) {
            add(id, 'log-retention', `log group retention must be ${REQUIRED_LOG_RETENTION_DAYS} days`);
          }
          break;
        case 'AWS::DynamoDB::Table':
        case 'AWS::DynamoDB::GlobalTable':
          if (props.BillingMode !== 'PAY_PER_REQUEST' || props.ProvisionedThroughput !== undefined) {
            add(id, 'dynamodb-billing', 'DynamoDB tables must be PAY_PER_REQUEST');
          }
          break;
      }

      for (const stmt of policyStatements(res)) checkStatement(id, stmt, add);
    }
  }
  return violations;
}

function checkStatement(
  id: string,
  stmt: PolicyStatement,
  add: (logicalId: string, rule: GuardRule, message: string) => void,
) {
  if (stmt.Effect !== 'Allow') return;
  if (stmt.NotAction !== undefined || stmt.NotResource !== undefined) {
    add(id, 'iam-wildcard-action', 'Allow with NotAction/NotResource is effectively a wildcard');
    return;
  }
  const actions = asArray(stmt.Action);
  if (actions.some((a) => a === '*' || (typeof a === 'string' && a.endsWith(':*')))) {
    add(id, 'iam-wildcard-action', `wildcard action in ${JSON.stringify(stmt.Action)}`);
  }
  if (asArray(stmt.Resource).includes('*')) {
    const allowed = new Set(WILDCARD_RESOURCE_ALLOWLIST.map((e) => e.action));
    const allAllowlisted =
      actions.length > 0 && actions.every((a) => typeof a === 'string' && allowed.has(a));
    if (!allAllowlisted) {
      add(id, 'iam-wildcard-resource', `Resource '*' for ${JSON.stringify(stmt.Action)}`);
    }
  }
}

/** Identity policies only; resource policies (e.g. the bucket's TLS deny) aren't grants. */
function policyStatements(res: CfnResource): PolicyStatement[] {
  const props = res.Properties ?? {};
  const docs: unknown[] = [];
  if (res.Type === 'AWS::IAM::Policy' || res.Type === 'AWS::IAM::ManagedPolicy') {
    docs.push(props.PolicyDocument);
  } else if (res.Type === 'AWS::IAM::Role' || res.Type === 'AWS::IAM::User' || res.Type === 'AWS::IAM::Group') {
    for (const p of asArray(props.Policies)) docs.push((p as Record<string, unknown>)?.PolicyDocument);
  }
  return docs.flatMap((d) => asArray((d as Record<string, unknown> | undefined)?.Statement)) as PolicyStatement[];
}

/** All IAM actions granted (Allow) anywhere in the template. */
export function grantedActions(template: Record<string, unknown>): string[] {
  const resources = (template.Resources ?? {}) as Record<string, CfnResource>;
  return Object.values(resources)
    .flatMap(policyStatements)
    .filter((s) => s.Effect === 'Allow')
    .flatMap((s) => asArray(s.Action))
    .filter((a): a is string => typeof a === 'string');
}

function refTarget(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'Ref' in value) {
    const ref = (value as { Ref: unknown }).Ref;
    return typeof ref === 'string' ? ref : undefined;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.stack}/${v.logicalId} [${v.rule}] ${v.message}`).join('\n');
}
