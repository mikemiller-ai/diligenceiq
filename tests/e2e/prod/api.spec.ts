import {
  type AdjacentEvidenceResponse,
  COMPANY_CATALOG,
  type CompaniesResponse,
  type CompanyIntelligenceProfile,
  CompanyIntelligenceProfileSchema,
  type HealthResponse,
  SourceDocumentResponseSchema,
  type WorkspaceResponse,
  profileIntegrityIssues,
} from '@diligenceiq/core';
import { expect, expectApiError, expectSecurityHeaders, test } from './fixtures';
import { SESSION_COOKIE } from './session-state';

/*
 * Production api through the Amplify /api/* rewrite (SPEC §49 Phase 8): HTTPS and headers, the
 * anonymous session, DynamoDB (workspace), S3 (every profile of the active set, a source filing
 * and its adjacency file), the index manifest (health), and error behaviour. GET only, apart from
 * POST /api/session on the run's existing cookie (which confirms, not creates, the workspace).
 */

/** Every corpus company except GE Capital's FY2014 filing, which is outside the review window and gets no profile (assumptions G2). */
const NO_PROFILE = ['GE'];
const EXPECTED = COMPANY_CATALOG.map((c) => c.ticker).filter((t) => !NO_PROFILE.includes(t));

test('health: HTTPS, security headers, request ID, the index reachable and an active profile set on the same index', async ({ anon }) => {
  const res = await anon.get('/api/health');
  expect(res.url()).toMatch(/^https:\/\//);
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expectSecurityHeaders(headers);
  expect(headers['x-request-id']).toBeTruthy();
  expect(headers['cache-control']).toBe('no-store');
  const body = (await res.json()) as HealthResponse;
  test.info().annotations.push({ type: 'health', description: JSON.stringify(body) });
  expect(body.status).toBe('ok');
  expect(body.indexVersion).toMatch(/^iv-[a-z0-9]+$/);
  expect(body.indexAvailable).toBe(true);
  expect(body.profileSetId).toMatch(/^(llm|det)-v\d+$/);
  expect(body.profileIndexVersion).toBe(body.indexVersion);
});

test('plain HTTP redirects to HTTPS', async ({ anon }) => {
  const res = await anon.get(test.info().project.use.baseURL!.replace(/^https:/, 'http:') + '/');
  expect(res.status()).toBe(301);
  expect(res.headers()['location']).toMatch(/^https:\/\//);
});

test('anonymous session: POST /api/session sets a Secure, HttpOnly, SameSite __Host- cookie through the rewrite; the workspace needs it', async ({ api, anon }) => {
  const res = await api.session();
  expect(res.status()).toBe(200);
  // The global setup opened (or confirmed) this workspace: this request must not create another.
  expect(((await res.json()) as { created: boolean }).created).toBe(false);
  const cookies = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value);
  expect(cookies).toHaveLength(1);
  const cookie = cookies[0]!;
  expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  expect(cookie).toMatch(/;\s*Secure(;|$)/i);
  expect(cookie).toMatch(/;\s*HttpOnly(;|$)/i);
  expect(cookie).toMatch(/;\s*SameSite=Lax(;|$)/i);
  expect(cookie).toMatch(/;\s*Path=\/(;|$)/);
  expect(cookie).not.toMatch(/;\s*Domain=/i);
  expectSecurityHeaders(res.headers());

  const ws = await api.get('/api/workspace');
  expect(ws.status()).toBe(200);
  const body = (await ws.json()) as WorkspaceResponse;
  expect(body.workspaceId).toBeTruthy();
  expect(body.seedVersion).toBeTruthy();
  expect(body.recentAnalyses.length).toBeGreaterThan(0);

  await expectApiError(await anon.get('/api/workspace'), 401, 'SESSION_REQUIRED');
  await expectApiError(await anon.get('/api/companies'), 401, 'SESSION_REQUIRED');
});

test(`profiles: /api/companies lists the ${EXPECTED.length} profiled companies and every one serves a valid profile from the active set`, async ({ api }) => {
  test.setTimeout(180_000);
  const health = (await (await api.get('/api/health')).json()) as HealthResponse;
  const res = await api.get('/api/companies');
  expect(res.status()).toBe(200);
  const list = (await res.json()) as CompaniesResponse;
  test.info().annotations.push({ type: 'profile set', description: `${list.indexVersion}/${list.profileSetId}: ${list.companies.length} companies` });
  console.log(`e2e:prod profile set ${list.indexVersion}/${list.profileSetId}: ${list.companies.length} companies`);
  expect(list.profileSetId).toBe(health.profileSetId);
  expect(list.indexVersion).toBe(health.indexVersion);
  expect(list.companies.map((c) => c.ticker).sort()).toEqual([...EXPECTED].sort());

  // Sequential: one request at a time stays far below the throttle (10 rps, burst 20).
  const problems: string[] = [];
  for (const { ticker } of list.companies) {
    const r = await api.get(`/api/companies/${ticker}/intelligence`);
    if (r.status() !== 200) {
      problems.push(`${ticker}: ${r.status()} ${await r.text()}`);
      continue;
    }
    const parsed = CompanyIntelligenceProfileSchema.safeParse(await r.json());
    if (!parsed.success) {
      problems.push(`${ticker}: schema ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    const p: CompanyIntelligenceProfile = parsed.data;
    if (p.ticker !== ticker) problems.push(`${ticker}: profile is for ${p.ticker}`);
    if (p.version.profileSetId !== list.profileSetId) problems.push(`${ticker}: set ${p.version.profileSetId}, expected ${list.profileSetId}`);
    if (p.version.indexVersion !== list.indexVersion) problems.push(`${ticker}: index ${p.version.indexVersion}, expected ${list.indexVersion}`);
    for (const issue of profileIntegrityIssues(p)) problems.push(`${ticker}: ${issue}`);
  }
  expect(problems).toEqual([]);

  // GE Capital is a catalog company without a profile: the documented 404, not a 500.
  for (const t of NO_PROFILE) await expectApiError(await api.get(`/api/companies/${t}/intelligence`), 404, 'PROFILE_MISSING');
});

test('evidence: a cited AAPL passage resolves byte for byte in its source filing (S3 processed text) and has adjacent periods', async ({ api }) => {
  const profile = (await (await api.get('/api/companies/AAPL/intelligence')).json()) as CompanyIntelligenceProfile;
  const citation = profile.citations.find((c) => c.filingType === '10-K') ?? profile.citations[0];
  expect(citation, 'AAPL profile has a citation').toBeTruthy();
  const c = citation!;

  const res = await api.get(`/api/sources/${c.documentId}?indexVersion=${c.indexVersion}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('private, max-age=3600');
  const source = SourceDocumentResponseSchema.parse(await res.json());
  expect(source.indexVersion).toBe(c.indexVersion);
  expect(source.filing.documentId).toBe(c.documentId);
  expect(source.text.length).toBeGreaterThan(10_000);
  expect(source.chunks.some((k) => k.chunkId === c.chunkId)).toBe(true);
  expect(source.text.slice(c.charStart, c.charEnd)).toBe(c.text);

  const adj = await api.get(`/api/evidence/adjacent?chunkId=${encodeURIComponent(c.chunkId)}&indexVersion=${c.indexVersion}`);
  expect(adj.status()).toBe(200);
  const body = (await adj.json()) as AdjacentEvidenceResponse;
  expect(body.chunkId).toBe(c.chunkId);
  expect(body.previous ?? body.next, 'at least one adjacent filing').toBeTruthy();
});

test('errors: unknown ticker, unknown analysis, unknown filing and unknown api route answer their documented codes', async ({ api }) => {
  await expectApiError(await api.get('/api/companies/ZZZZ/intelligence'), 400, 'VALIDATION_ERROR');
  await expectApiError(await api.get('/api/compare?tickers=AAPL,ZZZZ'), 400, 'VALIDATION_ERROR');
  await expectApiError(await api.get('/api/analyses/an_does_not_exist'), 404, 'NOT_FOUND');
  await expectApiError(await api.get('/api/sources/AAPL_10K_1999-01-01'), 404, 'SOURCE_MISSING');
  await expectApiError(await api.get('/api/sources/not-a-document'), 400, 'VALIDATION_ERROR');
  await expectApiError(await api.get('/api/does-not-exist'), 404, 'NOT_FOUND');
  // The development-only retrieval route does not exist in production (architecture §9); probed with GET only.
  await expectApiError(await api.get('/api/retrieval/debug'), 404, 'NOT_FOUND');
});
