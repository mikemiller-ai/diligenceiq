import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The launch film (SPEC §7). Build-time only: the landing is a server component in a static
 * export, so this runs during `next build` and never in the browser. Drop the files into
 * apps/web/public/media/ and rebuild; until the video exists the landing shows a placeholder.
 * Each optional file (poster, captions) is linked only when present, so nothing 404s.
 */
export const LAUNCH_FILM_PATHS = {
  video: '/media/diligenceiq-launch-film.mp4',
  poster: '/media/diligenceiq-launch-film-poster.jpg',
  captions: '/media/diligenceiq-launch-film.vtt',
} as const;

export interface LaunchFilmAssets {
  video: string;
  poster?: string;
  captions?: string;
}

/**
 * The web app's public/ directory. `next build` runs with apps/web as the working directory,
 * but a build or test started from the repository root would otherwise look in ./public, so
 * apps/web/public under the working directory wins when it exists.
 */
export function defaultPublicDir(cwd: string = process.cwd()): string {
  const fromRoot = join(cwd, 'apps', 'web', 'public');
  return existsSync(fromRoot) ? fromRoot : join(cwd, 'public');
}

/** The film's public URLs, or null when the video is not in `publicDir` yet. */
export function launchFilmAssets(publicDir: string = defaultPublicDir()): LaunchFilmAssets | null {
  const has = (url: string) => existsSync(join(publicDir, url));
  if (!has(LAUNCH_FILM_PATHS.video)) return null;
  const captions = has(LAUNCH_FILM_PATHS.captions);
  if (!captions) {
    // A warning, not a failure: the film still ships, but without captions it misses the family standard.
    console.warn(`launch film: ${LAUNCH_FILM_PATHS.video} has no captions file (${LAUNCH_FILM_PATHS.captions}); add WebVTT captions.`);
  }
  return {
    video: LAUNCH_FILM_PATHS.video,
    ...(has(LAUNCH_FILM_PATHS.poster) && { poster: LAUNCH_FILM_PATHS.poster }),
    ...(captions && { captions: LAUNCH_FILM_PATHS.captions }),
  };
}
