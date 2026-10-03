import { findBannedPhrases, type BriefValidation, type DiligenceBrief, type FigureCheck } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { briefHeadlines, briefStatus, figureChip, tallyFigures } from './brief-summary';

const fig = (location: string, verified: boolean, rule: FigureCheck['rule'] = verified ? 'exact' : null): FigureCheck => ({ location, figure: '$1 billion', verified, rule, chunkId: null });

const validation = (figures: FigureCheck[], uncited: string[] = []): BriefValidation => ({
  repairs: [],
  citations: { returned: 3, valid: 3, removed: [], preValidationRate: 1 },
  uncited,
  numeric: { figures, total: figures.length, verified: figures.filter((f) => f.verified).length, unitUnstated: figures.filter((f) => f.rule === 'unit_unstated').length },
  comparisonMisaligned: [],
  notices: [],
});

const finding = (title: string, citationIds = ['C-1']): DiligenceBrief['keyFindings'][number] => ({ title, finding: `${title}.`, basis: 'reported', tickers: ['AAPL'], citationIds });

describe('brief bottom line (DD-21 g)', () => {
  it('tallies only the figures under a finding’s own prefix, by outcome', () => {
    const v = validation([
      fig('keyFindings[0].title', true),
      fig('keyFindings[0].finding', false),
      fig('keyFindings[0].finding', false, 'unit_unstated'),
      // keyFindings[10] must never count toward keyFindings[1].
      fig('keyFindings[10].finding', false),
      fig('keyFindings[1].finding', true),
      fig('executiveSummary', false),
    ]);
    expect(tallyFigures(v, 'keyFindings[0].')).toEqual({ total: 3, verified: 1, unitUnstated: 1, unverified: 1 });
    expect(tallyFigures(v, 'keyFindings[1].')).toEqual({ total: 1, verified: 1, unitUnstated: 0, unverified: 0 });
    expect(tallyFigures(undefined, 'keyFindings[0].')).toEqual({ total: 0, verified: 0, unitUnstated: 0, unverified: 0 });
  });

  it('one headline per key finding, in order, with its anchor, title as stored and citation state', () => {
    const brief = { keyFindings: [finding('First'), finding('Second', []), finding('Third')] };
    const h = briefHeadlines(brief, validation([], ['keyFindings[2]']));
    expect(h.map((x) => [x.anchor, x.title, x.cited])).toEqual([
      ['finding-1', 'First', true],
      ['finding-2', 'Second', false],
      ['finding-3', 'Third', false],
    ]);
  });

  it('the figure chip: none without figures, a warning for any unverified one, neutral for unit-not-stated, ok when all were found', () => {
    expect(figureChip({ total: 0, verified: 0, unitUnstated: 0, unverified: 0 })).toBeNull();
    expect(figureChip({ total: 3, verified: 1, unitUnstated: 1, unverified: 1 })).toMatchObject({ tone: 'warning', text: '1 unverified figure' });
    expect(figureChip({ total: 4, verified: 1, unitUnstated: 0, unverified: 3 })).toMatchObject({ tone: 'warning', text: '3 unverified figures' });
    expect(figureChip({ total: 2, verified: 1, unitUnstated: 1, unverified: 0 })).toMatchObject({ tone: 'neutral', text: '1 figure: unit not stated' });
    // The rail's wording ("found in their cited passages"), and "Both" for two.
    expect(figureChip({ total: 1, verified: 1, unitUnstated: 0, unverified: 0 })).toMatchObject({ tone: 'ok', text: 'Figure found in its cited passages' });
    expect(figureChip({ total: 2, verified: 2, unitUnstated: 0, unverified: 0 })).toMatchObject({ tone: 'ok', text: 'Both figures found in their cited passages' });
    expect(figureChip({ total: 5, verified: 5, unitUnstated: 0, unverified: 0 })).toMatchObject({ tone: 'ok', text: 'All 5 figures found in their cited passages' });
  });

  it('the screen-reader description states each count apart: found, not found and unit not stated', () => {
    expect(figureChip({ total: 3, verified: 1, unitUnstated: 1, unverified: 1 })?.description).toBe(
      '1 of 3 figures were found in the passages this finding cites; 1 figure was not found, and 1 figure matches a table whose unit is not stated. Check it against the source.',
    );
    expect(figureChip({ total: 6, verified: 1, unitUnstated: 2, unverified: 3 })?.description).toBe(
      '1 of 6 figures were found in the passages this finding cites; 3 figures were not found, and 2 figures match a table whose unit is not stated. Check them against the source.',
    );
    expect(figureChip({ total: 4, verified: 2, unitUnstated: 0, unverified: 2 })?.description).toBe(
      '2 of 4 figures were found in the passages this finding cites; 2 figures were not found. Check them against the source.',
    );
    expect(figureChip({ total: 2, verified: 1, unitUnstated: 1, unverified: 0 })?.description).toBe(
      '1 of 2 figures were found in the passages this finding cites; 1 figure matches a table whose unit is not stated.',
    );
    for (const t of [{ total: 3, verified: 1, unitUnstated: 1, unverified: 1 }]) expect(figureChip(t)?.description).not.toMatch(/the rest/);
  });

  it('the status line is counts from the brief and its validation, with singulars and empty cases', () => {
    const v = validation([fig('a', true), fig('b', false)]);
    expect(briefStatus({ keyFindings: [finding('A'), finding('B')], evidenceGaps: ['x', 'y', 'z'] }, v, 7)).toEqual([
      '2 key findings',
      '7 passages cited',
      '1 of 2 figures found in their cited passages',
      '3 evidence gaps',
    ]);
    expect(briefStatus({ keyFindings: [finding('A')], evidenceGaps: [] }, validation([]), 1)).toEqual(['1 key finding', '1 passage cited', 'no figures to check', 'no evidence gaps identified']);
    expect(briefStatus({ keyFindings: [finding('A')], evidenceGaps: ['g'] }, undefined, 0)).toEqual(['1 key finding', '0 passages cited', '1 evidence gap']);
  });

  it('every fixed-rule string passes the DD-16 vocabulary check', () => {
    const tallies = [
      { total: 3, verified: 1, unitUnstated: 1, unverified: 1 },
      { total: 2, verified: 1, unitUnstated: 1, unverified: 0 },
      { total: 1, verified: 1, unitUnstated: 0, unverified: 0 },
      { total: 5, verified: 5, unitUnstated: 0, unverified: 0 },
    ];
    const strings = [
      ...tallies.flatMap((t) => Object.values(figureChip(t) ?? {})),
      ...briefStatus({ keyFindings: [finding('A')], evidenceGaps: [] }, validation([]), 1),
      ...briefStatus({ keyFindings: [finding('A'), finding('B')], evidenceGaps: ['g', 'h'] }, validation([fig('a', true)]), 4),
    ];
    expect(findBannedPhrases(strings.join(' \n '))).toEqual([]);
  });
});
