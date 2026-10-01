import type { AnalysisStatus, FilingType, FindingStatus } from '@diligenceiq/core';
import { Badge, StatusDot } from '@/components/ui/badge';
import { ANALYSIS_STATUS, FINDING_STATUS } from '@/lib/labels';

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const s = FINDING_STATUS[status];
  return (
    <Badge tone={s.tone}>
      <StatusDot />
      {s.label}
    </Badge>
  );
}

export function AnalysisStatusBadge({ status }: { status: AnalysisStatus }) {
  const s = ANALYSIS_STATUS[status];
  return (
    <Badge tone={s.tone}>
      <StatusDot />
      {s.label}
    </Badge>
  );
}

export function FilingTypeBadge({ type }: { type: FilingType }) {
  return (
    <Badge tone="outline" className="font-mono text-[11px] font-medium">
      {type}
    </Badge>
  );
}

export function TickerBadge({ ticker }: { ticker: string }) {
  return (
    <Badge tone="accent" className="font-mono text-[11px] font-semibold tracking-wide">
      {ticker}
    </Badge>
  );
}
