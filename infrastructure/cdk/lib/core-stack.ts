import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CONFIG } from './config';

/** Stateful resources. Everything here is RETAIN so a stack delete never loses data. */
export class CoreStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly dataBucket: s3.Bucket;
  public readonly killSwitch: ssm.StringParameter;
  public readonly activeProfileSet: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // On-demand billing and AWS-owned keys cost nothing at idle. PITR is off: demo data is
    // reseedable and expires by TTL, so continuous backups would be pure storage cost.
    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.DEFAULT,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Corpus, processed filings and index artifacts. Rebuildable, so no versioning.
    // No autoDeleteObjects: it would add a custom-resource Lambda.
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Operators flip this with `aws ssm put-parameter --overwrite`. CloudFormation won't
    // revert that drift unless the template value itself changes.
    this.killSwitch = new ssm.StringParameter(this, 'AnalysesEnabled', {
      parameterName: CONFIG.killSwitchParameterName,
      stringValue: 'false',
      description: 'Kill switch for analyses: "true" enables, anything else disables.',
    });

    // Which Company Intelligence profile set the api serves (DD-16). An admin points it at a
    // built set with `aws ssm put-parameter --overwrite`; "none" serves no profiles.
    this.activeProfileSet = new ssm.StringParameter(this, 'ActiveProfileSet', {
      parameterName: CONFIG.activeProfileSetParameterName,
      stringValue: 'none',
      description: 'Active Company Intelligence profile set: "<indexVersion>/<profileSetId>" or "none".',
    });
  }
}
