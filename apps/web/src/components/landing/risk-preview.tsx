import Link from 'next/link';
import { companyName, passage } from '@/fixtures';
import riskHeadingsJson from '@/fixtures/generated/risk-headings.json';
import { chipLabel } from '@/lib/citations';
import { filingHref } from '@/lib/links';

interface PreviewHeading {
  heading: string;
  group: string;
  chunkIds: string[];
}

interface PreviewCompany {
  ticker: string;
  documentId: string;
  fiscalLabel: string;
  headings: PreviewHeading[];
}

const COMPANIES = (riskHeadingsJson as { companies: PreviewCompany[] }).companies;

/** "Apple Inc" → "Apple", "Microsoft Corporation" → "Microsoft": a plain-language short name. */
export function shortCompanyName(name: string): string {
  return name.replace(/,?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Ltd\.?|plc)$/i, '');
}

/** The first heading of each risk group in a company's latest 10-K, verbatim, with its citation IDs. */
export function riskPreview(ticker = 'AAPL') {
  const company = COMPANIES.find((c) => c.ticker === ticker);
  if (!company) throw new Error(`risk preview: no extracted headings for ${ticker}`);
  const seen = new Set<string>();
  const rows = company.headings.filter((h) => !seen.has(h.group) && seen.add(h.group)).slice(0, 4);
  return { company, name: shortCompanyName(companyName(ticker)), rows };
}

/**
 * Hero product window (SPEC §7). Real filing content only: Apple's latest annual-report risk
 * headings as the extraction rule found them, never a sample figure or a narrative presented as
 * fact. Each citation chip uses the product's canonical label and opens its passage.
 */
export function RiskPreview() {
  const { company, name, rows } = riskPreview();
  return (
    <figure className="rounded-3xl border border-white/10 bg-navy-raised shadow-2xl shadow-black/50" aria-label="Product preview">
      <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <span className="ml-1 truncate font-mono text-[11.5px] text-white/50">
          diligenceiq · {name} ({company.ticker}) · Current risks
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[15px] font-semibold text-white">What the latest annual report flags</p>
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.chunkIds[0]} className="rounded-xl border border-white/10 bg-white/[0.02] p-3" data-testid="preview-row">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-on-navy-accent">{r.group}</p>
              <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-white/85" title={r.heading}>
                {r.heading}
              </p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {r.chunkIds.map((id) => (
                  <Link
                    key={id}
                    href={filingHref(company.documentId, id, passage(id).indexVersion)}
                    aria-label={`View passage ${id}`}
                    data-citation-chip=""
                    className="rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 font-mono text-[10.5px] text-[#c7d2fe] hover:border-on-navy-accent hover:text-white"
                  >
                    {chipLabel(passage(id))}
                  </Link>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <p className="font-mono text-[11px] text-white/45">
          Verbatim from {name}’s {company.fiscalLabel} annual report · each citation opens its passage
        </p>
      </div>
    </figure>
  );
}
