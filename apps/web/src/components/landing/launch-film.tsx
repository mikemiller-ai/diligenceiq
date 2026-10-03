import { ArrowRight, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { NavyAtmosphere } from '@/components/evidence/section';
import type { LaunchFilmAssets } from '@/lib/launch-film';

/**
 * The launch film frame, as on ResolveIQ, TrustResponse, ArchIQ and CareerOps (GenAIQ has no film): a native
 * video, controls on, no autoplay, 16:9. A labeled placeholder holds the slot until the file lands.
 */
export function LaunchFilm({ film }: { film: LaunchFilmAssets | null }) {
  return (
    <figure>
      <div className="overflow-hidden rounded-2xl border border-border bg-navy shadow-lg ring-1 ring-black/5">
        {film ? (
          <video className="block aspect-video w-full" controls preload="metadata" playsInline poster={film.poster}>
            <source src={film.video} type="video/mp4" />
            {/* Not `default`: the film burns in its own caption cards, so the transcript track is opt-in (CC button) rather than stacked on top. */}
            {film.captions && <track kind="captions" src={film.captions} srcLang="en" label="English" />}
            Your browser can’t play this video.{' '}
            <a href={film.video} className="underline">
              Download the film
            </a>
            .
          </video>
        ) : (
          <div className="relative grid aspect-video w-full place-items-center overflow-hidden text-white" data-testid="launch-film-placeholder">
            <NavyAtmosphere subtle />
            <div className="relative flex flex-col items-center gap-3 px-6 text-center">
              <PlayCircle aria-hidden className="size-12 text-white/40" strokeWidth={1.4} />
              <p className="text-lg font-semibold tracking-tight">The launch film is on its way</p>
              <p className="max-w-sm text-sm text-white/60">Until then, the working product is one click away.</p>
              <Link
                href="/intelligence/"
                className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-on-navy-accent underline-offset-4 hover:underline"
              >
                Open Company Intelligence <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        )}
      </div>
      <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {film ? `The working product${film.captions ? ' · captions available' : ''} · public SEC filings` : 'Coming soon · public SEC filings'}
      </figcaption>
    </figure>
  );
}
