import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  type CompanyIntelligenceProfile,
  CompanyIntelligenceProfileSchema,
  type ProfileSetManifest,
  ProfileSetManifestSchema,
  profileIntegrityIssues,
} from '@diligenceiq/core';
import { log } from '../http';
import type { SsmLike } from '../kill-switch';
import { isMissingObject } from '../s3-missing';

/**
 * Company Intelligence profiles at runtime (DD-16; architecture §4.4). The api only READS: the
 * SSM parameter `/diligenceiq/active-profile-set` names `<indexVersion>/<profileSetId>`, and the
 * set lives at `intelligence/<indexVersion>/<profileSetId>/{manifest.json,<TICKER>.json}`.
 * Switching sets is a parameter change. Nothing here can generate a profile: the api Lambda has
 * no Bedrock permission and imports no model client (tested).
 *
 * The pointer is cached for 60 s; a set's manifest and profiles are cached per warm container
 * for as long as that set stays active (a set is immutable once built). Every profile is
 * schema-checked and integrity-checked on load; a bad file reads as missing, never as content.
 */

export const ACTIVE_SET_CACHE_MS = 60_000;
const SET_POINTER = /^(iv-[a-z0-9]+)\/((?:llm|det|fixture)-v\d+)$/;

export interface ActiveProfileSet {
  indexVersion: string;
  profileSetId: string;
  manifest: ProfileSetManifest;
}

export interface ProfileProvider {
  /** The active set, or null when none is configured or it cannot be read. */
  active(requestId: string): Promise<ActiveProfileSet | null>;
  /** One profile from the active set; null when the set has no profile for the ticker. */
  get(ticker: string, requestId: string): Promise<CompanyIntelligenceProfile | null>;
}

/**
 * Reads set files by key relative to `intelligence/`. Null when the object does not exist,
 * including the 403 S3 returns for a missing key to a role without `s3:ListBucket`.
 */
export type SetReader = (key: string) => Promise<string | null>;

export function s3SetReader(s3: Pick<S3Client, 'send'>, bucket: string): SetReader {
  return async (key) => {
    const full = `intelligence/${key}`;
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: full }));
      return (await out.Body?.transformToString('utf8')) ?? null;
    } catch (err) {
      if (isMissingObject(err, full)) return null;
      throw err;
    }
  };
}

export type PointerReader = (requestId: string) => Promise<string | null>;

export function ssmPointerReader(ssm: SsmLike, parameterName: string | undefined): PointerReader {
  return async (requestId) => {
    if (!parameterName) return null;
    try {
      const out = await ssm.send(new GetParameterCommand({ Name: parameterName }));
      return out.Parameter?.Value?.trim() ?? null;
    } catch (err) {
      log('warn', 'active profile set pointer unreadable', { requestId, errorName: err instanceof Error ? err.name : 'Unknown' });
      throw err;
    }
  };
}

export function createProfileProvider(opts: { pointer: PointerReader; read: SetReader; now?: () => number; ttlMs?: number }): ProfileProvider {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? ACTIVE_SET_CACHE_MS;
  let pointer: { value: string | null; expiresAt: number } | null = null;
  const manifests = new Map<string, ProfileSetManifest>();
  const badSets = new Set<string>();
  const profiles = new Map<string, CompanyIntelligenceProfile | null>();

  const readPointer = async (requestId: string): Promise<string | null> => {
    if (pointer && now() < pointer.expiresAt) return pointer.value;
    try {
      const raw = await opts.pointer(requestId);
      const value = raw && SET_POINTER.test(raw) ? raw : null;
      if (raw && !value && raw !== 'none') log('warn', 'active profile set pointer malformed; no set is active', { requestId, value: raw.slice(0, 80) });
      pointer = { value, expiresAt: now() + ttlMs };
      return value;
    } catch {
      // Not cached: the next request retries. Dashboards show "profile missing" meanwhile.
      return pointer?.value ?? null;
    }
  };

  const active = async (requestId: string): Promise<ActiveProfileSet | null> => {
    const key = await readPointer(requestId);
    if (!key) return null;
    if (badSets.has(key)) return null;
    let manifest = manifests.get(key);
    if (!manifest) {
      let raw: string | null;
      try {
        raw = await opts.read(`${key}/manifest.json`);
      } catch (err) {
        // A transient read error is not cached.
        log('error', 'profile set manifest unreadable', { requestId, set: key, errorName: (err as Error)?.name });
        return null;
      }
      if (!raw) {
        log('warn', 'active profile set has no manifest', { requestId, set: key });
        return null;
      }
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        // fall through: invalid like a schema failure
      }
      const parsed = ProfileSetManifestSchema.safeParse(json);
      if (!parsed.success || `${parsed.data.indexVersion}/${parsed.data.profileSetId}` !== key) {
        // A set is immutable, so a bad manifest stays bad: remembered, logged once.
        log('error', 'profile set manifest invalid', { requestId, set: key });
        badSets.add(key);
        return null;
      }
      manifest = parsed.data;
      manifests.set(key, manifest);
    }
    const [indexVersion, profileSetId] = key.split('/') as [string, string];
    return { indexVersion, profileSetId, manifest };
  };

  return {
    active,
    async get(ticker, requestId) {
      const set = await active(requestId);
      if (!set || !set.manifest.companies.some((c) => c.ticker === ticker)) return null;
      const cacheKey = `${set.indexVersion}/${set.profileSetId}/${ticker}`;
      if (profiles.has(cacheKey)) return profiles.get(cacheKey) ?? null;
      let raw: string | null;
      try {
        raw = await opts.read(`${set.indexVersion}/${set.profileSetId}/${ticker}.json`);
      } catch (err) {
        // A transient read error is not cached.
        log('error', 'profile unreadable', { requestId, ticker, set: `${set.indexVersion}/${set.profileSetId}`, errorName: (err as Error)?.name });
        return null;
      }
      let profile: CompanyIntelligenceProfile | null = null;
      if (raw) {
        // A corrupt file (not JSON) is a bad file like any other: logged, cached as missing, never a 500.
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          log('error', 'profile is not valid JSON; treated as missing', { requestId, ticker, set: `${set.indexVersion}/${set.profileSetId}` });
          profiles.set(cacheKey, null);
          return null;
        }
        const parsed = CompanyIntelligenceProfileSchema.safeParse(json);
        const issues = parsed.success ? profileIntegrityIssues(parsed.data) : ['schema'];
        if (parsed.success && issues.length === 0 && parsed.data.ticker === ticker && parsed.data.version.profileSetId === set.profileSetId) profile = parsed.data;
        else log('error', 'profile failed validation; treated as missing', { requestId, ticker, issues: issues.slice(0, 5) });
      }
      profiles.set(cacheKey, profile);
      return profile;
    },
  };
}

/** Reads a set from a local directory laid out like `intelligence/` (tests and the local server). */
export function dirSetReader(root: string): SetReader {
  return async (key) => {
    const { readFile } = await import('node:fs/promises');
    const { join, normalize } = await import('node:path');
    const path = normalize(join(root, key));
    if (!path.startsWith(normalize(root))) return null;
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  };
}
