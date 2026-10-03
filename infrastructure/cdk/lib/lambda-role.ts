import * as iam from 'aws-cdk-lib/aws-iam';
import type * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

/**
 * A Lambda execution role that can write only to its own log group (Phase 7 IAM review;
 * architecture §11). Without it CDK attaches the AWS-managed AWSLambdaBasicExecutionRole, whose
 * logs:CreateLogGroup / CreateLogStream / PutLogEvents apply to every log group in the account
 * (`Resource: *`). Every function here has an explicit log group, so CreateLogGroup is not
 * needed at all. The function's other grants are added to this role by the stack as before.
 */
export function lambdaRole(scope: Construct, id: string, logGroup: logs.ILogGroup): iam.Role {
  const role = new iam.Role(scope, id, { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
  // `logGroupArn` ends in ":*", which covers the group's log streams.
  role.addToPolicy(new iam.PolicyStatement({ actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resources: [logGroup.logGroupArn] }));
  return role;
}
