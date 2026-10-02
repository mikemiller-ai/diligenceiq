import type { Chunk } from '../chunker';
import type { ProcessedFiling } from '../filing';
import { fiscalYearForYearEnd } from '../periods';
import { type FinancialFact, chunkAt, extractFilingFacts, lastScaleHint } from './extract';
import { matchMetric } from './metrics';
import { type PeriodColumn, alignValues, dollarChangeColumns, hasNoteColumn, headerPeriods, rowLabel, rowValues, tablesIn } from './tables';

/**
 * Drivers (SPEC §8.3; architecture §3): the MD&A segment or product rows with the largest
 * reported change, each cited. All drivers come from ONE table, the first in MD&A that is a
 * breakdown of the company's revenue:
 * - it has a revenue total row, and its component rows add up to that total (within 1%) in
 *   the latest column;
 * - that total equals the filing's own extracted consolidated revenue for the same fiscal
 *   year (within 0.5%, DD-17), so a sub-segment table or a gross-to-net schedule never
 *   qualifies;
 * - neither its caption nor its rows are deductions (returns, rebates, chargebacks,
 *   allowances, discounts).
 * Change is computed in code between the two most recent columns.
 */
export interface Driver {
  label: string;
  periods: [string, string];
  values: [number, number];
  change: number;
  changePct: number | null;
  /** Share of the total in the latest period. */
  share: number;
  chunkId: string;
  rawRow: string;
  totalRawRow: string;
  /** The table's revenue total for the two periods, as reported, and the table's unit. */
  total: [number, number];
  scale: number;
  /** Component rows in the table (drivers are the largest MAX_DRIVERS changes among them). */
  components: number;
  documentId: string;
}

const SUM_TOLERANCE = 0.01;
/** The table's total must match the filing's consolidated revenue this closely (the DD-17 cross-check tolerance). */
const REVENUE_TOLERANCE = 0.005;
export const MAX_DRIVERS = 6;
/** Gross-to-net and other deduction schedules are not revenue breakdowns (PFE). */
const DEDUCTIONS = /\b(?:deductions?|allowances?|rebates?|returns?|chargebacks?|discounts?)\b/i;
/** The caption test is narrower: "returns" or "discounts" alone in nearby prose is common in revenue captions. */
const DEDUCTION_CAPTION = /\b(?:deductions?|rebates?|chargebacks?|gross[- ]to[- ]net|returns\s+and\s+(?:allowances|discounts)|sales\s+allowances)\b/i;

function columnLabel(c: PeriodColumn, ticker: string): string {
  return c.date ? `FY${fiscalYearForYearEnd(ticker, c.date)}` : `FY${c.year}`;
}

export function extractDrivers(filing: ProcessedFiling, chunks: readonly Chunk[], facts?: readonly FinancialFact[]): Driver[] {
  if (filing.meta.filingType !== '10-K') return [];
  const mda = filing.sections.find((s) => s.kind === 'mda');
  if (!mda) return [];
  const { text } = filing;
  const own = chunks.filter((c) => c.documentId === filing.meta.documentId);
  // The filing's own consolidated revenue, by fiscal year (USD).
  const revenue = new Map(
    (facts ?? extractFilingFacts(filing, own, [filing.meta.periodEnd]))
      .filter((f) => f.documentId === filing.meta.documentId && f.metric === 'revenue' && f.duration === 'annual' && !f.suspect)
      .map((f) => [f.period, f.value * f.scale]),
  );
  for (const table of tablesIn(text, mda.start, mda.end)) {
    const headerIdx = table.rows.findIndex((r) => headerPeriods(r).length >= 2);
    if (headerIdx < 0) continue;
    const cols = headerPeriods(table.rows[headerIdx]!);
    // Most recent column first, whatever the table's order.
    const order = cols.map((c, i) => ({ i, key: c.date ?? `${c.year}-12-31` })).sort((a, b) => b.key.localeCompare(a.key));
    const [latest, prior] = [order[0]!.i, order[1]!.i];
    const changes = dollarChangeColumns(table.rows[headerIdx]!);
    const note = hasNoteColumn(table.rows[headerIdx]!);
    const rows = table.rows.slice(headerIdx + 1).map((r) => ({ row: r, values: alignValues(rowValues(r), cols.length, changes, note) }));
    // The total row: a revenue label, or a bare "Total" under a caption that names revenue.
    const caption = text.slice(Math.max(0, table.start - 300), table.start);
    if (DEDUCTION_CAPTION.test(caption)) continue;
    const isTotal = (label: string) =>
      matchMetric(label)?.metric === 'revenue' || (label === 'total' && /revenues?|net sales/i.test(caption));
    const totalAt = rows.findIndex((r) => r.values && isTotal(rowLabel(r.row)));
    if (totalAt < 1) continue;
    const total = rows[totalAt]!;
    const components = rows.slice(0, totalAt).filter((r) => r.values && r.values[latest]!.value !== null && r.values[prior]!.value !== null);
    const totalLatest = total.values![latest]!.value;
    if (!totalLatest || components.length < 2) continue;
    if (components.some((r) => DEDUCTIONS.test(rowLabel(r.row)))) continue;
    const sum = components.reduce((a, r) => a + r.values![latest]!.value!, 0);
    if (Math.abs(sum - totalLatest) / Math.abs(totalLatest) > SUM_TOLERANCE) continue;
    // The total is the company's consolidated revenue for that year.
    const consolidated = revenue.get(columnLabel(cols[latest]!, filing.meta.ticker));
    const headerEnd = table.rows[headerIdx]!.end;
    const scale = lastScaleHint(text.slice(Math.max(0, table.start - 600), headerEnd)) ?? lastScaleHint(text.slice(headerEnd, headerEnd + 300));
    if (consolidated === undefined || !scale) continue;
    if (Math.abs(totalLatest * scale - consolidated) / Math.abs(consolidated) > REVENUE_TOLERANCE) continue;
    const found: Driver[] = [];
    const seen = new Set<string>();
    for (const r of components) {
      const label = r.row.cells[0]!.replace(/\(\d\)/g, '').trim();
      if (seen.has(label.toLowerCase())) continue;
      const chunk = chunkAt(own, r.row.start, r.row.end);
      if (!chunk) continue;
      seen.add(label.toLowerCase());
      const v0 = r.values![latest]!.value!;
      const v1 = r.values![prior]!.value!;
      found.push({
        label,
        periods: [columnLabel(cols[prior]!, filing.meta.ticker), columnLabel(cols[latest]!, filing.meta.ticker)],
        values: [v1, v0],
        change: v0 - v1,
        changePct: v1 > 0 ? v0 / v1 - 1 : null,
        share: v0 / totalLatest,
        chunkId: chunk.chunkId,
        rawRow: r.row.text,
        totalRawRow: total.row.text,
        total: [total.values![prior]!.value ?? 0, totalLatest],
        scale,
        components: components.length,
        documentId: filing.meta.documentId,
      });
    }
    if (found.length < 2) continue;
    return found.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, MAX_DRIVERS);
  }
  return [];
}
