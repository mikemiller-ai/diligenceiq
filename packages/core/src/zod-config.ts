import { z } from 'zod';

/**
 * Zod without its JIT (assumptions D10). Zod 4 compiles object parsers with `new Function`, and
 * probes for it the first time an object schema is built. Under the web's strict CSP
 * (`script-src` without `'unsafe-eval'`) that probe is reported as a violation even though Zod
 * catches it and falls back. Turning the JIT off skips the probe; parsing stays correct and the
 * cost is negligible at this app's payload sizes. The setting is global to the zod instance and
 * takes effect once core is loaded, so it covers the web, where every schema comes through core.
 * In the api and worker, a module that imports zod directly may build its schemas before core's
 * index runs, so those can be built with the JIT; harmless there, as no CSP applies outside the
 * browser.
 *
 * **It must be the first import of `index.ts`:** schemas are built at module load, and the probe
 * runs on the first one.
 */
z.config({ jitless: true });
