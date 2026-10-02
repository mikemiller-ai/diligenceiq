import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

/**
 * The data bucket the offline profile build writes its ledger to (SPEC §32.4, DD-16): pinned to
 * CoreStack's DataBucket output, so a typo or another account's bucket can never become a second,
 * empty ledger (which would allow a second call per key). Read-only CloudFormation lookup.
 */
export const CORE_STACK = 'DiligenceIQ-Core';

type Output = { OutputKey?: string; OutputValue?: string };

/** CoreStack's bucket name: the `DataBucket` output, or the cross-stack export CDK publishes for it (`PublishOutputRefDataBucket…`). */
export function dataBucketFromOutputs(outputs: readonly Output[]): string | null {
  const hit = outputs.find((o) => o.OutputKey === 'DataBucket') ?? outputs.find((o) => /^PublishOutputRefDataBucket[0-9A-F]{8}/.test(o.OutputKey ?? ''));
  return hit?.OutputValue ?? null;
}

export async function resolveDataBucket(region: string): Promise<string | null> {
  const out = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: CORE_STACK }));
  return dataBucketFromOutputs(out.Stacks?.[0]?.Outputs ?? []);
}

/**
 * The ledger bucket to use: the stack's bucket when --bucket is omitted; a --bucket that differs
 * from it only with --allow-other-bucket. Returns an error message instead of a bucket otherwise.
 */
export function chooseLedgerBucket(requested: string | undefined, resolved: string | null, allowOther: boolean): { bucket: string } | { error: string } {
  if (requested !== undefined && (requested === '' || requested === 'true')) return { error: '--bucket needs a bucket name' };
  if (resolved === null) {
    if (requested && allowOther) return { bucket: requested };
    return { error: `could not read the DataBucket output of ${CORE_STACK}; pass --bucket <name> --allow-other-bucket to use a bucket explicitly` };
  }
  if (!requested || requested === resolved) return { bucket: resolved };
  if (allowOther) return { bucket: requested };
  return { error: `--bucket ${requested} is not ${CORE_STACK}'s DataBucket (${resolved}); the ledger must live in one place. Pass --allow-other-bucket only if you mean it.` };
}
