import { vi } from 'vitest';

/**
 * Test helper: captures what `log` (http.ts) writes. Each call is one raw JSON line on stdout
 * (architecture §12), so the spy's `mock.calls[i][0]` is that line, newline included.
 */
export function spyOnLog() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

/** The JSON objects logged through a `spyOnLog` spy, in order. */
export function loggedLines(spy: ReturnType<typeof spyOnLog>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
}
