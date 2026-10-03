import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as core from './index';

describe('zod config (D10)', () => {
  it('core turns off the Zod JIT, so no `new Function` probe runs under the web CSP', () => {
    expect(Object.keys(core).length).toBeGreaterThan(0);
    expect(z.config().jitless).toBe(true);
  });
});
