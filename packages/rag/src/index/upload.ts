import { ARTIFACTS, type IndexManifest, type ValidatedMarker } from './format';

/**
 * Immutable index upload (SPEC §24.4; architecture §6.4). Pure decision logic for
 * `scripts/indexing/upload-index.ts`, with the S3 calls behind `ObjectStore` so it is testable:
 * - the build must carry the VALIDATED marker written after validation passed, for this
 *   version and this exact manifest;
 * - every local artifact must match the manifest's bytes and sha256, and every manifest
 *   artifact must be present;
 * - every object carries its sha256 as metadata. An existing key with the same sha256 is
 *   skipped; one with a different or missing sha256 is a conflict, and the whole upload is
 *   refused before anything is written (objects are never overwritten);
 * - writes are conditional (`If-None-Match: *`), and manifest.json is written LAST, so a
 *   reader that finds the manifest finds every artifact it names.
 */
export interface LocalFile {
  /** Path relative to its root (build dir or processed dir), forward slashes. */
  rel: string;
  bytes: number;
  sha256: string;
}

export interface UploadItem extends LocalFile {
  key: string;
  contentType: string;
  /** Where to read the body from: the build dir or the processed dir. */
  source: 'build' | 'processed';
}

export interface ObjectStore {
  /** Null when the key does not exist; otherwise the stored sha256 metadata (undefined if absent). */
  head(key: string): Promise<{ sha256: string | undefined } | null>;
  /** Conditional create (If-None-Match: *). Must fail, not overwrite, if the key exists. */
  putIfAbsent(item: UploadItem): Promise<void>;
}

export function contentTypeOf(key: string): string {
  return key.endsWith('.json') ? 'application/json' : key.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/octet-stream';
}

export interface UploadPlanInput {
  indexVersion: string;
  manifest: IndexManifest;
  manifestSha256: string;
  marker: ValidatedMarker | null;
  /** Every file in the build dir, the manifest and marker included. */
  buildFiles: readonly LocalFile[];
  processedFiles: readonly LocalFile[];
}

/** Checks the build and returns the upload list, manifest.json last. Throws on any problem. */
export function planIndexUpload(i: UploadPlanInput): UploadItem[] {
  const problems: string[] = [];
  if (!i.marker) {
    throw new Error(`index:upload: build ${i.indexVersion} has no ${ARTIFACTS.validatedMarker} marker (never validated, or validation failed); run \`pnpm index:build\``);
  }
  if (i.marker.indexVersion !== i.indexVersion) problems.push(`${ARTIFACTS.validatedMarker} is for ${i.marker.indexVersion}, not ${i.indexVersion}`);
  if (i.marker.manifestSha256 !== i.manifestSha256) problems.push(`manifest.json changed after validation (${ARTIFACTS.validatedMarker} records a different sha256)`);
  if (i.manifest.indexVersion !== i.indexVersion) problems.push(`manifest is for ${i.manifest.indexVersion}, not ${i.indexVersion}`);

  const artifacts = i.buildFiles.filter((f) => f.rel !== ARTIFACTS.manifest && f.rel !== ARTIFACTS.validatedMarker);
  const local = new Map(artifacts.map((f) => [f.rel, f]));
  for (const f of artifacts) {
    const want = i.manifest.artifacts[f.rel];
    if (!want) problems.push(`${f.rel} is not listed in the manifest`);
    else if (want.bytes !== f.bytes || want.sha256 !== f.sha256) problems.push(`${f.rel} differs from the manifest (bytes or sha256)`);
  }
  for (const name of Object.keys(i.manifest.artifacts)) if (!local.has(name)) problems.push(`${name} is in the manifest but missing from the build`);
  if (!i.buildFiles.some((f) => f.rel === ARTIFACTS.manifest)) problems.push('manifest.json is missing from the build');
  if (problems.length) throw new Error(`index:upload: refusing build ${i.indexVersion}:\n  ${problems.join('\n  ')}`);

  const byRel = (a: LocalFile, b: LocalFile) => a.rel.localeCompare(b.rel);
  const item = (f: LocalFile, source: UploadItem['source'], prefix: string): UploadItem => {
    const key = `${prefix}/${i.indexVersion}/${f.rel}`;
    return { ...f, key, source, contentType: contentTypeOf(key) };
  };
  const manifestFile = i.buildFiles.find((f) => f.rel === ARTIFACTS.manifest)!;
  return [
    ...[...artifacts].sort(byRel).map((f) => item(f, 'build', 'index')),
    ...[...i.processedFiles].sort(byRel).map((f) => item(f, 'processed', 'processed')),
    item(manifestFile, 'build', 'index'),
  ];
}

export interface UploadResult {
  sent: string[];
  skipped: string[];
}

/**
 * Executes a plan: checks every key first and refuses on any conflict before writing, then
 * creates the missing objects in plan order (manifest last).
 */
export async function executeIndexUpload(items: readonly UploadItem[], store: ObjectStore): Promise<UploadResult> {
  if (items.at(-1)?.rel !== ARTIFACTS.manifest) throw new Error('index:upload: manifest.json must be the last object in the plan');
  const missing: UploadItem[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  for (const u of items) {
    const head = await store.head(u.key);
    if (!head) missing.push(u);
    else if (head.sha256 === u.sha256) skipped.push(u.key);
    else conflicts.push(`${u.key}: existing object has sha256 ${head.sha256 ?? '(none)'}, local is ${u.sha256}`);
  }
  if (conflicts.length) {
    throw new Error(
      `index:upload: refusing to overwrite ${conflicts.length} existing object(s); objects are immutable per index version:\n  ${conflicts.slice(0, 20).join('\n  ')}`,
    );
  }
  const sent: string[] = [];
  for (const u of missing) {
    await store.putIfAbsent(u);
    sent.push(u.key);
  }
  return { sent, skipped };
}
