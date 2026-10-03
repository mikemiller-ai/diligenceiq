import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASSAGES, companies, passage } from '@/fixtures';
import { chipLabel } from '@/lib/citations';
import { corpusStats } from '@/lib/corpus-stats';
import { formatCount } from '@/lib/format';
import { SIGNAL_TYPE_LABEL, TRAJECTORY_LABEL } from '@/lib/labels';
import type * as LaunchFilmModule from '@/lib/launch-film';
import { LAUNCH_FILM_PATHS, defaultPublicDir, launchFilmAssets, type LaunchFilmAssets } from '@/lib/launch-film';
import { filingHref } from '@/lib/links';
import { DESCRIPTIVE_LABELS } from './descriptive-labels';
import { LaunchFilm } from './launch-film';
import { riskPreview } from './risk-preview';
import { SEEDED_QUESTIONS } from './seeded-questions';

/** A fresh temporary directory, optionally holding the given launch-film files under public/. */
function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function publicDirWith(...urls: string[]) {
  const dir = tempDir('diq-film-');
  mkdirSync(join(dir, 'media'));
  for (const url of urls) writeFileSync(join(dir, url), '');
  return dir;
}

/**
 * Renders the landing with launchFilmAssets mocked, so no test depends on whether the film
 * happens to be in the working tree. The mock is always removed and the registry reset.
 */
async function renderLanding(film: LaunchFilmAssets | null = null) {
  vi.resetModules();
  vi.doMock('@/lib/launch-film', async (orig) => ({
    ...(await orig<typeof LaunchFilmModule>()),
    launchFilmAssets: () => film,
  }));
  try {
    const { default: LandingPage } = await import('@/app/page');
    return render(<LandingPage />);
  } finally {
    vi.doUnmock('@/lib/launch-film');
    vi.resetModules();
  }
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('launch film assets (SPEC §7)', () => {
  it('is null until the video exists, even when the poster and captions do', () => {
    expect(launchFilmAssets(publicDirWith())).toBeNull();
    expect(launchFilmAssets(publicDirWith(LAUNCH_FILM_PATHS.poster, LAUNCH_FILM_PATHS.captions))).toBeNull();
  });

  it('links only the optional files that are present, so nothing 404s', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(launchFilmAssets(publicDirWith(LAUNCH_FILM_PATHS.video))).toEqual({ video: LAUNCH_FILM_PATHS.video });
    expect(launchFilmAssets(publicDirWith(...Object.values(LAUNCH_FILM_PATHS)))).toEqual(LAUNCH_FILM_PATHS);
  });

  it('warns at build time, without failing, when the video has no captions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(launchFilmAssets(publicDirWith(LAUNCH_FILM_PATHS.video, LAUNCH_FILM_PATHS.poster))).toEqual({
      video: LAUNCH_FILM_PATHS.video,
      poster: LAUNCH_FILM_PATHS.poster,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/captions/);

    warn.mockClear();
    launchFilmAssets(publicDirWith(LAUNCH_FILM_PATHS.video, LAUNCH_FILM_PATHS.captions));
    launchFilmAssets(publicDirWith());
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves public/ from apps/web (next build) and from the repository root', () => {
    const webDir = tempDir('diq-web-');
    expect(defaultPublicDir(webDir)).toBe(join(webDir, 'public'));

    const rootDir = tempDir('diq-root-');
    mkdirSync(join(rootDir, 'apps', 'web', 'public'), { recursive: true });
    expect(defaultPublicDir(rootDir)).toBe(join(rootDir, 'apps', 'web', 'public'));
  });

  it('renders a labeled placeholder without a video', () => {
    const { container } = render(<LaunchFilm film={null} />);
    expect(screen.getByTestId('launch-film-placeholder')).toHaveTextContent('The launch film is on its way');
    expect(container.querySelector('video')).toBeNull();
  });

  it('renders the family video frame: controls, no autoplay, poster and default captions', () => {
    const { container } = render(<LaunchFilm film={LAUNCH_FILM_PATHS} />);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('poster', LAUNCH_FILM_PATHS.poster);
    expect(video.querySelector('source')).toHaveAttribute('src', LAUNCH_FILM_PATHS.video);
    expect(video.querySelector('track[kind="captions"]')).toHaveAttribute('src', LAUNCH_FILM_PATHS.captions);
    expect(screen.queryByTestId('launch-film-placeholder')).toBeNull();
  });

  it('omits the captions track when there is no captions file', () => {
    const { container } = render(<LaunchFilm film={{ video: LAUNCH_FILM_PATHS.video }} />);
    expect(container.querySelector('track')).toBeNull();
    expect(container.querySelector('video')).not.toHaveAttribute('poster');
  });
});

describe('hero product preview: real filing content only', () => {
  it('shows verbatim risk headings whose citations are real index passages of that filing', () => {
    const { company, rows } = riskPreview();
    expect(company.ticker).toBe('AAPL');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((r) => r.group)).size).toBe(rows.length);
    for (const r of rows) {
      for (const id of r.chunkIds) {
        const p = PASSAGES.find((x) => x.chunkId === id);
        expect(p, id).toBeDefined();
        expect(p!.documentId).toBe(company.documentId);
      }
    }
  });

  it('each displayed heading and its group appear in the text of the passages it cites', () => {
    for (const r of riskPreview().rows) {
      const cited = normalise(r.chunkIds.map((id) => passage(id).text).join(' '));
      expect(cited, r.heading).toContain(normalise(r.heading));
      expect(cited, r.group).toContain(normalise(r.group));
    }
  });

  it('renders each heading in full (visually clamped, never rewritten)', async () => {
    await renderLanding();
    const preview = screen.getByRole('figure', { name: 'Product preview' });
    for (const r of riskPreview().rows) expect(within(preview).getByText(r.heading)).toBeInTheDocument();
  });

  it('renders each citation as a canonical chip linking to its passage, with no measured heading count', async () => {
    await renderLanding();
    const { company, rows } = riskPreview();
    const preview = screen.getByRole('figure', { name: 'Product preview' });
    for (const r of rows) {
      for (const id of r.chunkIds) {
        const chip = within(preview).getByRole('link', { name: `View passage ${id}` });
        // next/link drops the trailing slash before the query outside a real build.
        expect(chip.getAttribute('href')!.replace('/?', '?')).toBe(filingHref(company.documentId, id, passage(id).indexVersion).replace('/?', '?'));
        expect(chip.getAttribute('href')).toContain(`iv=${passage(id).indexVersion}#chunk-${id}`);
        expect(chip).toHaveTextContent(chipLabel(passage(id)));
      }
    }
    expect(preview).toHaveTextContent(`Verbatim from Apple’s ${company.fiscalLabel} annual report · each citation opens its passage`);
    expect(preview.textContent).not.toMatch(/risk headings in this report|\d+\s+risk headings/);
  });
});

describe('landing page (SPEC §7)', () => {
  it('lists the demo workspace’s pre-run questions exactly as seeded', async () => {
    const seedPath = join(__dirname, '../../../../../seed/demo-workspace.json');
    const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as { analyses: { question: string }[] };
    expect([...SEEDED_QUESTIONS].sort()).toEqual(seed.analyses.map((a) => a.question).sort());
    await renderLanding();
    const list = screen.getByRole('list', { name: 'Pre-run questions' });
    for (const q of SEEDED_QUESTIONS) expect(within(list).getByText(q)).toBeInTheDocument();
  });

  it('keeps the primary CTA and both secondary entries in the hero', async () => {
    await renderLanding();
    const hero = screen.getByTestId('landing-hero');
    expect(within(hero).getByRole('link', { name: /Open Company Intelligence/ })).toHaveAttribute('href', expect.stringMatching(/^\/intelligence\/?$/));
    expect(within(hero).getByRole('link', { name: 'Ask any question' })).toHaveAttribute('href', expect.stringMatching(/^\/analysis\/new\/?$/));
    expect(within(hero).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', expect.stringMatching(/^\/architecture\/?$/));
  });

  it('wraps the content in <main id="main"> starting with the hero h1, with a valid heading order', async () => {
    const { container } = await renderLanding();
    const main = container.querySelector('main#main')!;
    expect(main).not.toBeNull();
    expect(main.firstElementChild).toBe(screen.getByTestId('landing-hero'));
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    expect(main.querySelector('h1')).not.toBeNull();
  });

  it('puts the launch film directly after the hero once the file exists', async () => {
    const { container } = await renderLanding({ video: LAUNCH_FILM_PATHS.video });
    const sections = container.querySelectorAll('main > section');
    expect(sections[0]).toBe(screen.getByTestId('landing-hero'));
    expect(sections[1]).toHaveAttribute('id', 'film');
    expect(container.querySelector('#film video')).not.toBeNull();
  });

  it('without the film file: no film section and no placeholder; the problem section follows the hero (A.4 2026-10-03)', async () => {
    const { container } = await renderLanding(null);
    expect(container.querySelector('#film')).toBeNull();
    expect(screen.queryByTestId('launch-film-placeholder')).toBeNull();
    expect(screen.queryByText(/Coming soon/)).toBeNull();
    const sections = container.querySelectorAll('main > section');
    expect(sections[0]).toBe(screen.getByTestId('landing-hero'));
    expect(sections[1]).toHaveTextContent('The answers are in the filings');
  });

  it('without the film: no "Watch the launch film" and no header "Launch film" link, "How it works" stays', async () => {
    await renderLanding(null);
    expect(screen.queryByRole('link', { name: /Watch the launch film/ })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Landing' })).queryByRole('link', { name: 'Launch film' })).toBeNull();
    expect(within(screen.getByTestId('landing-hero')).getByRole('link', { name: 'How it works' })).toBeInTheDocument();
  });

  it('with the film: "Watch the launch film" and the header anchor appear, and "How it works" stays', async () => {
    await renderLanding({ video: LAUNCH_FILM_PATHS.video, captions: LAUNCH_FILM_PATHS.captions });
    const hero = screen.getByTestId('landing-hero');
    expect(within(hero).getByRole('link', { name: /Watch the launch film/ })).toHaveAttribute('href', '#film');
    expect(within(hero).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', expect.stringMatching(/^\/architecture\/?$/));
    expect(within(screen.getByRole('navigation', { name: 'Landing' })).getByRole('link', { name: 'Launch film' })).toHaveAttribute('href', '#film');
    expect(screen.queryByTestId('launch-film-placeholder')).toBeNull();
  });

  it('is honest about Company Intelligence: every company in the review window has an offline-built profile', async () => {
    const inWindow = companies().filter((c) => !c.outsideWindow);
    expect(inWindow).toHaveLength(53);
    const { container } = await renderLanding();
    expect(screen.getByTestId('intelligence-status')).toHaveTextContent(
      `Every company in the review window has a profile (${inWindow.length} companies), built offline from its filings once per index version. Each says whether its narrative was written by the model and checked against the filings, or comes from templates.`,
    );
    // Only the detectors that passed the Phase 3 bar are promised (DD-18): no new or removed risks.
    expect(container.textContent).not.toMatch(/new risks|removed risks|preview today|for any company/i);
  });

  it('links Compare from the "Two ways in" section', async () => {
    await renderLanding();
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('href', expect.stringMatching(/^\/compare\/?$/));
  });

  it('describes figure checking and the one-call rule accurately', async () => {
    const { container } = await renderLanding();
    const text = normalise(container.textContent ?? '');
    expect(text).toContain('Figures checked against their source');
    expect(text).toContain('Dollar and percentage figures in a brief are checked against the passages they cite, and any that can’t be matched are marked unverified.');
    expect(text).toContain('One generation call per question. Nothing running when nobody is.');
    expect(text).toContain('each analysis makes at most one generation request');
    expect(text).not.toMatch(/never made up by the model|numbers from the filings|exactly one generation request|one model call|retrieval, context and validation are deterministic/i);
  });

  it('uses only real descriptive labels from lib/labels.ts', async () => {
    const real = new Set<string>([...Object.values(TRAJECTORY_LABEL), ...Object.values(SIGNAL_TYPE_LABEL)]);
    for (const label of DESCRIPTIVE_LABELS) expect(real.has(label), label).toBe(true);
    const { container } = await renderLanding();
    expect(normalise(container.textContent ?? '')).toContain(`Labels describe, never judge: ${DESCRIPTIVE_LABELS.join(', ')}. No scores, ratings or recommendations.`);
    expect(container.textContent).not.toMatch(/Accelerating|New disclosure/);
  });

  it('keeps the client framing: no assessment wording', async () => {
    const { container } = await renderLanding();
    expect(container.textContent).not.toMatch(/Eliza|FDE|assessment/i);
  });

  it('has no rating, score, verdict or recommendation language (SPEC §32.6), while allowed words pass', async () => {
    expect(BANNED.test(ALLOWED_SAMPLE)).toBe(false);
    for (const phrase of BANNED_SAMPLES) expect(BANNED.test(phrase), phrase).toBe(true);
    const { container } = await renderLanding();
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('every number shown is a corpus count (companies, profiled companies, filings), a period year, the preview fiscal year or a step number', async () => {
    const stats = corpusStats();
    const { container } = await renderLanding();
    const steps = container.querySelectorAll('ol[aria-label="How DiligenceIQ works"] > li').length;
    const allowed = new Set<string>([
      formatCount(stats.filings),
      String(stats.companies),
      // Companies with a profile: the corpus companies in the review window, from the filing rows.
      String(companies().filter((c) => !c.outsideWindow).length),
      stats.firstPeriod.slice(0, 4),
      stats.lastPeriod.slice(0, 4),
      riskPreview().company.fiscalLabel.replace(/\D/g, ''),
      ...Array.from({ length: steps }, (_, i) => String(i + 1).padStart(2, '0')),
    ]);
    // Excluded, precisely: the seeded questions (verbatim seed text, tested above) and citation chip labels.
    const excluded = (node: Node) => !!node.parentElement?.closest('[data-seeded-question], [data-citation-chip]');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const found: Array<{ digits: string; in: string }> = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (excluded(n)) continue;
      // Product names that contain a digit are not numbers (Amazon S3).
      const text = (n.textContent ?? '').replace(/\bS3\b/g, '');
      for (const m of text.matchAll(/\d+(?:,\d{3})*/g)) found.push({ digits: m[0], in: normalise(n.textContent ?? '') });
    }
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((d) => !allowed.has(d.digits))).toEqual([]);
    // The exclusions cover real elements, so they cannot silently widen.
    expect(container.querySelectorAll('[data-seeded-question]')).toHaveLength(SEEDED_QUESTIONS.length);
    expect(container.querySelectorAll('[data-citation-chip]').length).toBe(riskPreview().rows.flatMap((r) => r.chunkIds).length);
    // No money, percentages or timings anywhere.
    expect(container.textContent).not.toMatch(/\$\s?\d|\d\s?%|\d\s?ms\b|\d\s?(?:seconds|minutes)\b/);
  });
});

/** SPEC §32.6, phrase-level and case-insensitive. */
const BANNED = new RegExp(
  [
    String.raw`\bstrong (?:buy|sell)\b`,
    String.raw`\b(?:buy|sell|hold) rating\b`,
    String.raw`\brated an? (?:buy|sell|hold)\b`,
    String.raw`\b(?:we|investors should|you should) (?:buy|sell|hold|avoid)\b`,
    String.raw`\brecommend (?:buying|selling|holding|investing)\b`,
    String.raw`\b(?:is|looks like) an? (?:buy|sell)\b`,
    String.raw`\b\d+\s?\/\s?(?:10|100)\b`,
    String.raw`\bscore of\b`,
    String.raw`\brating of\b`,
    String.raw`\bout of (?:10|100)\b`,
    String.raw`\b\d+ stars?\b`,
    String.raw`\bgrade [A-F][+-]?(?![a-z])`,
    String.raw`\blow-risk (?:investment|company|stock)\b`,
    String.raw`\bsafe investment\b`,
    String.raw`\bbest investment\b`,
    String.raw`\bundervalued\b`,
    String.raw`\bovervalued\b`,
    String.raw`\bmust-own\b`,
    String.raw`\bguaranteed returns?\b`,
  ].join('|'),
  'i',
);

const BANNED_SAMPLES = [
  'a strong buy',
  'hold rating',
  'rated a buy',
  'investors should avoid',
  'we recommend buying',
  'it looks like a sell',
  'scores 8/10',
  'a score of 7',
  'a rating of 4',
  '9 out of 10',
  '5 stars',
  'grade B',
  'a low-risk investment',
  'a safe investment',
  'undervalued',
  'a must-own name',
  'a guaranteed return',
];

const ALLOWED_SAMPLE =
  'buyback and share repurchase; selling, general and administrative; sells, sold; customers buy; strong demand; credit ratings and rating agencies; low-income; No scores, ratings or recommendations.';
