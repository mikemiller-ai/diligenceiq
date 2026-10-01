import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { log } from './http';

export const KILL_SWITCH_CACHE_MS = 60_000;

/** The slice of SSMClient this module uses, so tests can pass a stub. */
export type SsmLike = Pick<SSMClient, 'send'>;

export interface KillSwitch {
  analysesEnabled(requestId: string): Promise<boolean>;
}

/**
 * Reads `/diligenceiq/analyses-enabled` (architecture §11). Only the exact string "true"
 * enables analyses; anything else, a missing parameter name, or an SSM error reads as off.
 * Successful reads are cached per warm container. Failures are not cached, so the switch
 * recovers on the next request once SSM does; the stage throttle bounds the retry rate.
 */
export function createKillSwitch(opts: {
  ssm: SsmLike;
  parameterName: string | undefined;
  now?: () => number;
  ttlMs?: number;
}): KillSwitch {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? KILL_SWITCH_CACHE_MS;
  let cached: { value: boolean; expiresAt: number } | undefined;

  return {
    async analysesEnabled(requestId) {
      if (cached && now() < cached.expiresAt) return cached.value;
      if (!opts.parameterName) {
        log('warn', 'kill switch parameter name not configured; failing closed', { requestId });
        return false;
      }
      try {
        const out = await opts.ssm.send(new GetParameterCommand({ Name: opts.parameterName }));
        const value = out.Parameter?.Value?.trim() === 'true';
        cached = { value, expiresAt: now() + ttlMs };
        return value;
      } catch (err) {
        log('warn', 'kill switch read failed; failing closed', {
          requestId,
          errorName: err instanceof Error ? err.name : 'Unknown',
        });
        return false;
      }
    },
  };
}
