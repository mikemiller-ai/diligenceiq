import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKillSwitch, KILL_SWITCH_CACHE_MS, type SsmLike } from './kill-switch';

function stubSsm(impl: () => Promise<unknown>) {
  const send = vi.fn((_cmd: unknown) => impl());
  return { ssm: { send } as unknown as SsmLike, send };
}

const PARAM = '/diligenceiq/analyses-enabled';

describe('kill switch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is enabled only by the exact value "true"', async () => {
    for (const [value, expected] of [
      ['true', true],
      [' true\n', true],
      ['false', false],
      ['TRUE', false],
      ['1', false],
      ['', false],
    ] as const) {
      const { ssm } = stubSsm(async () => ({ Parameter: { Value: value } }));
      const ks = createKillSwitch({ ssm, parameterName: PARAM });
      expect(await ks.analysesEnabled('r')).toBe(expected);
    }
  });

  it('reads the configured parameter', async () => {
    const { ssm, send } = stubSsm(async () => ({ Parameter: { Value: 'true' } }));
    await createKillSwitch({ ssm, parameterName: PARAM }).analysesEnabled('r');
    const cmd = send.mock.calls[0]?.[0] as GetParameterCommand;
    expect(cmd).toBeInstanceOf(GetParameterCommand);
    expect(cmd.input).toEqual({ Name: PARAM });
  });

  it('caches a successful read for 60 s, then refreshes', async () => {
    let t = 1_000;
    let value = 'true';
    const { ssm, send } = stubSsm(async () => ({ Parameter: { Value: value } }));
    const ks = createKillSwitch({ ssm, parameterName: PARAM, now: () => t });

    expect(await ks.analysesEnabled('r')).toBe(true);
    value = 'false';
    t += KILL_SWITCH_CACHE_MS - 1;
    expect(await ks.analysesEnabled('r')).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    t += 1;
    expect(await ks.analysesEnabled('r')).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fails closed with a warning when SSM errors, and retries next time', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let fail = true;
    const { ssm, send } = stubSsm(async () => {
      if (fail) throw Object.assign(new Error('boom'), { name: 'ThrottlingException' });
      return { Parameter: { Value: 'true' } };
    });
    const ks = createKillSwitch({ ssm, parameterName: PARAM });

    expect(await ks.analysesEnabled('req-1')).toBe(false);
    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: 'warn', requestId: 'req-1', errorName: 'ThrottlingException' });

    fail = false;
    expect(await ks.analysesEnabled('req-2')).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the parameter is missing or the name is unset', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ssm } = stubSsm(async () => ({}));
    expect(await createKillSwitch({ ssm, parameterName: PARAM }).analysesEnabled('r')).toBe(false);

    const { ssm: unused, send } = stubSsm(async () => ({ Parameter: { Value: 'true' } }));
    expect(await createKillSwitch({ ssm: unused, parameterName: undefined }).analysesEnabled('r')).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
