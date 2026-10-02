import { ProfileSetManifestSchema, type ProfileSetManifest } from '@diligenceiq/core';

/**
 * The upload checks on a profile set's manifest (scripts/intelligence/upload-set.ts). `partial`
 * (a `--tickers` trial build) is read from the RAW JSON: the manifest schema strips unknown
 * fields, so checking the parsed manifest would never see it.
 */
export function uploadableManifest(raw: unknown, set: string): ProfileSetManifest {
  if (raw !== null && typeof raw === 'object' && (raw as { partial?: unknown }).partial === true) {
    throw new Error('this is a partial set (built with --tickers); build the full set before uploading');
  }
  const manifest = ProfileSetManifestSchema.parse(raw);
  if (`${manifest.indexVersion}/${manifest.profileSetId}` !== set) throw new Error('manifest does not match --set');
  return manifest;
}
