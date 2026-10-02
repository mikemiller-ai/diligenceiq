import { randomBytes } from 'node:crypto';

/**
 * Time-ordered IDs for analyses: 9 base36 characters of milliseconds, then 10 random base64url
 * characters. Sort keys sort by creation time, so a descending Query lists the newest first.
 * Matches the worker's message pattern `^[A-Za-z0-9_-]{1,64}$`.
 */
export function newAnalysisId(now: Date = new Date()): string {
  return `${now.getTime().toString(36).padStart(9, '0')}${randomBytes(8).toString('base64url').slice(0, 10)}`;
}
