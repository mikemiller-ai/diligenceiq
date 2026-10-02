/**
 * Local E2E server (testing-strategy §6). It serves the static export the way Amplify does
 * (trailing-slash index.html, 404.html) and answers `/api/*` with the REAL api app
 * (`services/api` createApp) over in-memory stores, the committed fixture profile set and the
 * real seed. Only the edges are local: the session secret, the stores, and the queue.
 *
 * The queue is consumed by a TEST-ONLY stub worker. It never calls a model: it walks the real
 * stage names with short pauses and completes the job with the stored result of the seed
 * analysis about the SAME companies (real pipeline output, recorded in advance), so the UI's
 * polling, stages and brief rendering can be exercised end to end. A question about companies
 * no seed covers fails honestly with NO_RELEVANT_EVIDENCE; it never gets an unrelated brief.
 * The real worker is unit-tested in services/api, and the deployed in-region path is verified
 * separately with `pnpm analysis:run` (AWS writes and Bedrock spend: only with Mike's approval).
 * Nothing here is deployed or bundled.
 *
 * Test controls (this server only): GET /__e2e/stats, POST /__e2e/kill-switch?enabled=,
 * POST /__e2e/worker?mode=complete|fail|hang.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { MemoryAnalysisStore } from '../../services/api/src/analyses/store';
import { DEFAULT_CAPS, createApp } from '../../services/api/src/app';
import { createProfileProvider, dirSetReader } from '../../services/api/src/profiles/provider';
import { staticSessionSecret } from '../../services/api/src/session/session';
import { PROFILE_SET_ROOT, SEED } from '../../services/api/src/test-helpers';
import { MemoryWorkspaceStore } from '../../services/api/src/workspace/store';

const PORT = Number(process.env.E2E_PORT ?? 4174);
const OUT = normalize(join(import.meta.dirname, '../../apps/web/out'));
const STAGES = ['claimed', 'analyzing', 'retrieving', 'balancing', 'context', 'generating', 'validating'] as const;
const STAGE_MS = Number(process.env.E2E_STAGE_MS ?? 250);

const analyses = new MemoryAnalysisStore();
const workspace = new MemoryWorkspaceStore(analyses);
const controls = { enabled: true, mode: 'complete' as 'complete' | 'fail' | 'hang' };
const stats = { enqueued: 0 };

/** The companies an analysis asks about: tickers or first names in the question, plus the filter and origin tickers. */
function askedTickers(record: { question: string; filters?: { tickers?: string[] }; origin: unknown }): Set<string> {
  const q = record.question.toLowerCase();
  const out = new Set<string>(record.filters?.tickers ?? []);
  const origin = record.origin as { ticker?: string; tickers?: string[] };
  if (origin.ticker) out.add(origin.ticker);
  for (const t of origin.tickers ?? []) out.add(t);
  for (const a of SEED.analyses) {
    for (const s of (a.interpretation.scopes ?? []) as Array<{ ticker: string; company: string }>) {
      const name = s.company.split(/[\s.]+/)[0]!.toLowerCase();
      if (new RegExp(`\\b(${s.ticker.toLowerCase()}|${name})\\b`).test(q)) out.add(s.ticker);
    }
  }
  return out;
}

/** TEST-ONLY: a stand-in for the worker that reuses a stored seed result and never calls a model. */
async function stubWorker(workspaceId: string, analysisId: string) {
  const token = `e2e-${analysisId}`;
  const record = await analyses.claim(workspaceId, analysisId, token, new Date());
  if (!record) return;
  if (controls.mode === 'hang') return;
  for (const stage of STAGES) {
    await new Promise((r) => setTimeout(r, STAGE_MS));
    if (stage !== 'claimed') await analyses.setStage(workspaceId, analysisId, token, stage).catch(() => undefined);
  }
  if (controls.mode === 'fail') {
    await analyses.fail(workspaceId, analysisId, token, { code: 'GENERATION_TIMEOUT', message: 'The analysis took too long. Run it again.', requestId: `e2e-${analysisId}` }, new Date());
    return;
  }
  // Only a seed analysis about exactly the companies asked about; otherwise an honest failure.
  const asked = askedTickers(record);
  const seed = SEED.analyses.find((a) => {
    const covered = (a.interpretation.companies ?? []) as string[];
    return covered.length === asked.size && covered.every((t) => asked.has(t));
  });
  if (!seed) {
    await analyses.fail(workspaceId, analysisId, token, { code: 'NO_RELEVANT_EVIDENCE', message: 'The filings had no passages relevant to this question.', requestId: `e2e-${analysisId}` }, new Date());
    return;
  }
  const { context, ...result } = seed;
  await analyses.complete(
    workspaceId,
    analysisId,
    token,
    {
      interpretation: result.interpretation as never,
      coverage: result.coverage,
      brief: result.brief,
      citations: result.citations,
      validation: result.validation,
      telemetry: result.telemetry as never,
    },
    new Date(),
  );
  await analyses.putContext(workspaceId, analysisId, context);
}

const app = createApp({
  killSwitch: { analysesEnabled: async () => controls.enabled },
  sessionSecret: staticSessionSecret('e2e-local-session-secret-0123456789abcdef'),
  analyses,
  workspace,
  queue: {
    async send({ workspaceId, analysisId }) {
      stats.enqueued++;
      setTimeout(() => void stubWorker(workspaceId, analysisId), 50);
    },
  },
  profiles: createProfileProvider({ pointer: async () => 'iv-9cf51c066743/fixture-v2', read: dirSetReader(PROFILE_SET_ROOT) }),
  seed: SEED,
  indexVersion: 'iv-9cf51c066743',
  indexAvailable: async () => true,
  secureCookies: false,
  // Every test browser comes from 127.0.0.1, so the per-client creation limit is lifted here only.
  caps: { ...DEFAULT_CAPS, perClientDailyWorkspaceCreations: 100_000, dailyWorkspaceCreations: 100_000 },
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://local');
  let path = normalize(join(OUT, decodeURIComponent(url.pathname)));
  if (!path.startsWith(OUT)) return void res.writeHead(403).end();
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path) && existsSync(`${path}.html`)) path = `${path}.html`;
  if (!existsSync(path)) {
    res.writeHead(404, { 'content-type': TYPES['.html']! });
    return void createReadStream(join(OUT, '404.html')).pipe(res);
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(path).pipe(res);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

let seq = 0;
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname.startsWith('/__e2e/')) {
    if (url.pathname === '/__e2e/kill-switch') controls.enabled = url.searchParams.get('enabled') === 'true';
    if (url.pathname === '/__e2e/worker') controls.mode = (url.searchParams.get('mode') as typeof controls.mode) ?? 'complete';
    res.writeHead(200, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify({ ...stats, ...controls }));
  }
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
  const cookieHeader = req.headers.cookie;
  const event = {
    version: '2.0',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')])),
    ...(cookieHeader ? { cookies: cookieHeader.split(';').map((c) => c.trim()) } : {}),
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: await readBody(req),
    isBase64Encoded: false,
    requestContext: { requestId: `local-${++seq}`, http: { method: req.method ?? 'GET', path: url.pathname, sourceIp: req.socket.remoteAddress ?? '127.0.0.1' } },
  } as unknown as Parameters<typeof app>[0];
  const out = await app(event);
  res.writeHead(out.statusCode, { ...out.headers, ...(out.cookies?.length ? { 'set-cookie': out.cookies } : {}) });
  res.end(out.body);
}).listen(PORT, '127.0.0.1', () => console.log(`e2e local server on http://127.0.0.1:${PORT} (static ${OUT}, api in-process, stub worker)`));
