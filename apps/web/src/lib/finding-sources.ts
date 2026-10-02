import {
  composeCompare,
  isFixtureProfile,
  profileRef,
  themeForCategory,
  type Citation,
  type CompanyIntelligenceProfile,
  type CompareResult,
  type FindingSource,
  type ThemeId,
} from '@diligenceiq/core';
import type { AnalysisRecord } from '@/fixtures/types';

/**
 * Resolves a FindingSource to the stored content it names, the way POST /api/findings
 * will (architecture §9): text and citations are copied from the stored brief and its
 * context snapshot, or from the profile, never taken from the form. A source with no
 * cited passage resolves to null: a finding always keeps its evidence (SPEC §17.1).
 */
export interface ResolvedSource {
  title: string;
  text: string;
  tickers: string[];
  citations: Citation[];
  analysisId?: string;
  defaultTheme: ThemeId;
}

export interface SourceStores {
  analyses: readonly AnalysisRecord[];
  profiles: ReadonlyMap<string, CompanyIntelligenceProfile>;
}

const pick = (pool: readonly Citation[], ids: readonly string[]) => {
  const byId = new Map(pool.map((c) => [c.chunkId, c]));
  return [...new Set(ids)].flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
};

export function resolveSource(source: FindingSource, stores: SourceStores): ResolvedSource | null {
  const resolved = resolveContent(source, stores);
  return resolved && resolved.citations.length > 0 ? resolved : null;
}

/** Stable compare-row refs (SPEC §13.2: any compare row can be saved). */
export const compareRowRef = {
  theme: (category: string) => `theme-${category}`,
  trajectory: (metric: string) => `trajectory-${slug(metric)}`,
  diverging: (metric: string) => `diverging-${slug(metric)}`,
};

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveContent(source: FindingSource, stores: SourceStores): ResolvedSource | null {
  switch (source.kind) {
    case 'keyFinding':
    case 'consideration':
    case 'comparisonRow': {
      const analysis = stores.analyses.find((a) => a.analysisId === source.analysisId);
      const brief = analysis?.brief;
      if (!analysis || !brief) return null;
      const base = { analysisId: analysis.analysisId, defaultTheme: 'risk-factors' as ThemeId };
      if (source.kind === 'keyFinding') {
        const k = brief.keyFindings[source.index];
        return k ? { ...base, title: k.title, text: k.finding, tickers: k.tickers, citations: pick(analysis.context, k.citationIds) } : null;
      }
      if (source.kind === 'consideration') {
        const c = brief.investmentConsiderations[source.index];
        if (!c) return null;
        const citations = pick(analysis.context, c.citationIds);
        return { ...base, title: 'Investment consideration', text: c.text, tickers: [...new Set(citations.map((x) => x.ticker))], citations };
      }
      const row = brief.comparison?.rows[source.index];
      if (!row || !brief.comparison) return null;
      const cells = brief.comparison.columns.slice(1).map((col, i) => `${col}: ${row.values[i] ?? ''}`);
      const citations = pick(analysis.context, row.citationIds);
      return { ...base, title: row.label, text: cells.join(' · '), tickers: [...new Set(citations.map((x) => x.ticker))], citations };
    }
    case 'compareRow':
      return resolveCompareRow(source, stores.profiles);
    case 'watchEvent':
      return null; // Watchlist is P1 (Phase 8b).
    default:
      return resolveProfileSource(source, stores.profiles.get(source.ticker));
  }
}

function resolveCompareRow(
  source: Extract<FindingSource, { kind: 'compareRow' }>,
  profiles: ReadonlyMap<string, CompanyIntelligenceProfile>,
): ResolvedSource | null {
  const out = composeCompare(source.tickers, profiles);
  if (!out.ok) return null;
  const r: CompareResult = out.result;
  const name = (t: string) => r.companies.find((c) => c.ticker === t)?.company ?? t;
  const all = r.companies.map((c) => c.company).join(', ');

  const theme = r.attentionRanking.find((t) => compareRowRef.theme(t.category) === source.ref);
  if (theme) {
    // Common, distinctive and shared areas depend on each company's complete risk list, which a
    // preview profile cannot vouch for (its extracted list can miss headings), so they are not saved as findings.
    if (r.companies.some((c) => { const p = profiles.get(c.ticker); return !p || isFixtureProfile(p); })) return null;
    const holders = theme.tickers.map(name);
    const common = theme.tickers.length === r.companies.length;
    const distinctive = theme.tickers.length === 1;
    return {
      title: common ? `${theme.label}: common attention area` : distinctive ? `${theme.label}: distinctive to ${holders[0]}` : `${theme.label}: shared by ${holders.join(', ')}`,
      text: common
        ? `${theme.label} appears among the latest risk headings or change signals of every selected company (${all}).`
        : `${theme.label} appears among the latest risk headings or change signals of ${holders.join(', ')}, out of ${all}.`,
      tickers: theme.tickers,
      citations: pick(r.citations, theme.citationIds),
      defaultTheme: themeForCategory(theme.category),
    };
  }

  const row = r.trajectories.find((t) => compareRowRef.trajectory(t.metric) === source.ref);
  if (row) {
    return {
      title: `${row.metric} trend across ${all}`,
      text: row.values.map((v) => `${name(v.ticker)}: ${v.trajectory.replace(/_/g, ' ')}`).join(' · '),
      tickers: row.values.map((v) => v.ticker),
      citations: pick(r.citations, row.values.flatMap((v) => v.chunkIds)),
      defaultTheme: 'financial-performance',
    };
  }

  const div = r.diverging.find((d) => compareRowRef.diverging(d.metric) === source.ref);
  if (div) {
    const values = r.trajectories.find((t) => t.metric === div.metric)?.values ?? [];
    const involved = [...div.up, ...div.down];
    return {
      title: `${div.metric}: diverging trends`,
      text: `${div.metric}: rising at ${div.up.map(name).join(', ')}; falling at ${div.down.map(name).join(', ')}.`,
      tickers: involved,
      citations: pick(r.citations, values.filter((v) => involved.includes(v.ticker)).flatMap((v) => v.chunkIds)),
      defaultTheme: 'financial-performance',
    };
  }
  return null;
}

function resolveProfileSource(
  source: Extract<FindingSource, { ticker: string; ref: string }>,
  profile: CompanyIntelligenceProfile | undefined,
): ResolvedSource | null {
  if (!profile) return null;
  const base = { tickers: [profile.ticker] };
  switch (source.kind) {
    case 'currentRisk': {
      const r = profile.currentRisks.find((x) => profileRef.currentRisk(x) === source.ref);
      return r
        ? { ...base, title: `${r.plainLabel} risk`, text: r.heading, citations: pick(profile.citations, r.citationIds), defaultTheme: themeForCategory(r.category) }
        : null;
    }
    case 'signal': {
      const s = profile.signals.find((x) => profileRef.signal(x) === source.ref);
      return s
        ? { ...base, title: s.headline, text: s.whatChanged, citations: pick(profile.citations, s.citationIds), defaultTheme: themeForCategory(s.category) }
        : null;
    }
    case 'recommendation': {
      const i = profile.recommendedDiligence.findIndex((_, idx) => profileRef.recommendation(idx) === source.ref);
      const r = profile.recommendedDiligence[i];
      if (!r) return null;
      const signals = profile.signals.filter((s) => r.signalIds.includes(s.signalId));
      // The theme follows what the recommendation rests on: its first signal, else the current
      // risk it cites. Neighbouring headings can share a chunk, so only a classified risk citing
      // exactly the same chunks counts, and the one whose area the question names wins.
      const same = (ids: readonly string[]) => ids.length === r.citationIds.length && ids.every((id) => r.citationIds.includes(id));
      const candidates = profile.currentRisks.filter((x) => x.category !== null && same(x.citationIds));
      const question = r.question.toLowerCase();
      const risk = candidates.find((x) => question.includes(x.plainLabel.toLowerCase())) ?? candidates[0];
      const category = signals[0]?.category ?? risk?.category;
      return {
        ...base,
        title: 'Recommended diligence',
        text: r.question,
        citations: pick(profile.citations, [...signals.flatMap((s) => s.citationIds), ...r.citationIds]),
        defaultTheme: category ? themeForCategory(category) : 'risk-factors',
      };
    }
    case 'driver': {
      const i = profile.drivers.findIndex((_, idx) => profileRef.driver(idx) === source.ref);
      const d = profile.drivers[i];
      return d
        ? { ...base, title: d.label, text: d.explanation, citations: pick(profile.citations, d.citationIds), defaultTheme: 'financial-performance' }
        : null;
    }
    case 'executiveView': {
      const e = profile.executiveView.find((x) => profileRef.executiveView(x.dimension) === source.ref);
      return e
        ? { ...base, title: `${e.dimension}: ${e.label}`, text: e.summary, citations: pick(profile.citations, e.citationIds), defaultTheme: 'financial-performance' }
        : null;
    }
  }
}

/** A plain label for where a finding came from, for the Findings Board. */
export function sourceLabel(source: FindingSource): string {
  switch (source.kind) {
    case 'keyFinding':
      return 'Brief · key finding';
    case 'consideration':
      return 'Brief · investment consideration';
    case 'comparisonRow':
      return 'Brief · comparison row';
    case 'compareRow':
      return `Compare · ${source.tickers.join(', ')}`;
    case 'watchEvent':
      return `Watchlist · ${source.ticker}`;
    case 'currentRisk':
      return `${source.ticker} · current risk`;
    case 'signal':
      return `${source.ticker} · attention signal`;
    case 'recommendation':
      return `${source.ticker} · recommended diligence`;
    case 'driver':
      return `${source.ticker} · driver`;
    case 'executiveView':
      return `${source.ticker} · 30-second view`;
  }
}
