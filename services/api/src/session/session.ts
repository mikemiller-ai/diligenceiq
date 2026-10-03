import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { log } from '../http';
import type { SsmLike } from '../kill-switch';
import { CLOUDFRONT_RANGES } from './cloudfront-ranges';
import { type Cidr, clientAddressKey, inCidr, parseCidr, parseIp } from './ip';

/**
 * Anonymous demo sessions (SPEC §40, §39; architecture §8 "Demo sessions"). The cookie holds a
 * random 128-bit workspace ID and an HMAC-SHA256 signature over it; the secret is an SSM
 * SecureString. Nothing else is in the cookie, and the server trusts only a verified ID.
 */

/**
 * The cookie name. Production cookies use the `__Host-` prefix, which the browser accepts only
 * with Secure, Path=/ and no Domain, so a sibling subdomain cannot set or shadow it. The local
 * http server (not Secure) uses the plain name.
 */
export const SESSION_COOKIE_SECURE = '__Host-diq_ws';
export const SESSION_COOKIE = 'diq_ws';
export const sessionCookieName = (secure: boolean) => (secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE);
export const SESSION_MAX_AGE_S = 30 * 86_400;
/** A workspace ID: 16 random bytes, base64url (22 characters). */
export const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const MIN_SECRET_BYTES = 32;

export function newWorkspaceId(): string {
  return randomBytes(16).toString('base64url');
}

function sign(secret: string, workspaceId: string): string {
  return createHmac('sha256', secret).update(`ws.v1.${workspaceId}`).digest('base64url');
}

export function encodeSessionValue(secret: string, workspaceId: string): string {
  return `${workspaceId}.${sign(secret, workspaceId)}`;
}

/** The workspace ID of a correctly signed cookie value, else null. Constant-time comparison. */
export function verifySessionValue(secret: string, value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const workspaceId = value.slice(0, dot);
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) return null;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(secret, workspaceId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? workspaceId : null;
}

export interface CookieOptions {
  /** False only for the local http server (tests and `pnpm dev:local`); production is always Secure. */
  secure: boolean;
}

export function sessionSetCookie(value: string, opts: CookieOptions): string {
  return [`${sessionCookieName(opts.secure)}=${value}`, 'Path=/', `Max-Age=${SESSION_MAX_AGE_S}`, 'HttpOnly', ...(opts.secure ? ['Secure'] : []), 'SameSite=Lax'].join('; ');
}

/** Reads one cookie from an API Gateway v2 event (`cookies` array, or a raw Cookie header). */
export function readCookie(event: { cookies?: string[]; headers?: Record<string, string | undefined> }, name: string): string | undefined {
  const pairs = event.cookies ?? (event.headers?.cookie ?? '').split(';');
  for (const raw of pairs) {
    const pair = raw.trim();
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq) === name) return pair.slice(eq + 1);
  }
  return undefined;
}

export interface SessionSecret {
  get(requestId: string): Promise<string>;
}

export class SessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionUnavailableError';
  }
}

/**
 * The HMAC secret from an SSM SecureString, read once per warm container. A failed read is not
 * cached, and a missing or short secret is refused: sessions fail closed rather than sign with
 * a weak key.
 */
export function createSsmSessionSecret(opts: { ssm: SsmLike; parameterName: string | undefined }): SessionSecret {
  let cached: string | null = null;
  return {
    async get(requestId) {
      if (cached) return cached;
      if (!opts.parameterName) throw new SessionUnavailableError('session secret parameter not configured');
      let value: string | undefined;
      try {
        const out = await opts.ssm.send(new GetParameterCommand({ Name: opts.parameterName, WithDecryption: true }));
        value = out.Parameter?.Value;
      } catch (err) {
        log('error', 'session secret read failed', { requestId, errorName: err instanceof Error ? err.name : 'Unknown' });
        throw new SessionUnavailableError('session secret unreadable');
      }
      if (!value || Buffer.byteLength(value) < MIN_SECRET_BYTES) throw new SessionUnavailableError('session secret missing or too short');
      cached = value;
      return value;
    },
  };
}

export function staticSessionSecret(secret: string): SessionSecret {
  if (Buffer.byteLength(secret) < MIN_SECRET_BYTES) throw new Error('session secret too short');
  return { get: async () => secret };
}

/**
 * A per-client key for the workspace-creation limit (architecture §11): a salted SHA-256 of the
 * source IP, 16 hex characters. The salt is the session secret, so the stored key cannot be
 * reversed by hashing candidate addresses without it. The raw IP is never stored or logged.
 */
export function clientKey(secret: string, sourceIp: string | undefined): string {
  return createHmac('sha256', secret).update(`ip.v1.${sourceIp ?? 'unknown'}`).digest('hex').slice(0, 16);
}

/** The CloudFront ranges, parsed once per container. */
const CLOUDFRONT_CIDRS: Cidr[] = [...CLOUDFRONT_RANGES.ipv4, ...CLOUDFRONT_RANGES.ipv6].map(parseCidr);

/** True when the address is in AWS's published CloudFront ranges (services CLOUDFRONT and CLOUDFRONT_ORIGIN_FACING). */
export function isCloudFrontAddress(address: string | undefined): boolean {
  const ip = parseIp(address);
  return ip !== null && CLOUDFRONT_CIDRS.some((cidr) => inCidr(ip, cidr));
}

function splitHops(header: string | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
}

export interface ViewerAddress {
  /** The normalised address the key is made from (`clientAddressKey`): IPv4, or an IPv6 /64. */
  address: string | undefined;
  source: 'viewer_hop' | 'source_ip';
  /** Whether `sourceIp` is a CloudFront address, the only case in which a forwarded hop is trusted. */
  viaCloudFront: boolean;
}

/**
 * The address the per-client workspace-creation cap is keyed on (assumptions D12, Mike's choice
 * 2026-10-03). Through Amplify's `/api/<*>` rewrite, `sourceIp` is a proxy address that changes
 * between requests, and `X-Forwarded-For` read `viewer, edge, proxy` in production (API Gateway
 * appends the proxy, which is `sourceIp`).
 *
 * `X-Forwarded-For` is trusted ONLY when `sourceIp` is itself a CloudFront address: only then did
 * infrastructure we rely on append the hops nearest the end. A caller of the execute-api URL can
 * forge any hops it likes, but its `sourceIp` is its own (unforgeable TCP) address, so it is keyed
 * on that. The check is fail-safe: if the real proxy address is missing from the bundled list
 * (`pnpm fixtures:cloudfront`), every request keys on `sourceIp`, never on a forgeable hop.
 *
 * Via CloudFront, the viewer is the first hop from the right that is not itself a CloudFront
 * address: each CloudFront layer (edge, origin-facing proxy, any added later) appends the address
 * it received from, so walking left past CloudFront hops reaches the first address no CloudFront
 * layer vouched for as its own, which CloudFront appended itself. Hops a client sends sit further
 * left and are never reached. A walk that finds only CloudFront hops falls back to `sourceIp`.
 * The keyed form is normalised: IPv4-mapped IPv6 is the IPv4, and IPv6 keys on its /64.
 */
export function viewerAddress(sourceIp: string | undefined, forwardedFor: string | undefined): ViewerAddress {
  const viaCloudFront = isCloudFrontAddress(sourceIp);
  if (viaCloudFront) {
    const hops = splitHops(forwardedFor);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isCloudFrontAddress(hops[i])) return { address: clientAddressKey(hops[i]), source: 'viewer_hop', viaCloudFront };
    }
  }
  return { address: clientAddressKey(sourceIp), source: 'source_ip', viaCloudFront };
}

/** At most this many `X-Forwarded-For` hops are keyed; a client can send a long forged header. */
const MAX_FORWARDED_HOPS = 5;

/**
 * Assumption D12's production check: the `clientKey` of each of the LAST 5 `X-Forwarded-For` hops,
 * in header order (the hops infrastructure appended are at the end; a client's forged hops are at
 * the start), plus the total hop count, so the "workspace created" line shows which hop carries the
 * same key as a direct request from the same visitor. Keys only: the raw addresses are never logged.
 */
export function forwardedForKeys(secret: string, header: string | undefined): { keys: string[]; hops: number } {
  const hops = splitHops(header);
  return { keys: hops.slice(-MAX_FORWARDED_HOPS).map((hop) => clientKey(secret, clientAddressKey(hop))), hops: hops.length };
}
