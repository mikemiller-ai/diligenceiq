import type {
  AnalysisFailureCode,
  AnalysisInterpretation,
  AnalysisSummary,
  AnalysisTelemetry,
  Citation,
  DiligenceBrief,
  FilingType,
} from '@diligenceiq/core';

export interface FilingRecord {
  documentId: string;
  ticker: string;
  company: string;
  filingType: FilingType;
  filingDate: string;
  periodEnd: string;
  characters: number;
  sourceUrl: string;
}

/** An analysis as the poll endpoint will return it (architecture §9), plus the context snapshot. */
export interface AnalysisRecord extends AnalysisSummary {
  brief?: DiligenceBrief;
  interpretation?: AnalysisInterpretation;
  /** Context snapshot: the passages supplied to the model, keyed by chunk ID. */
  context: Citation[];
  validation?: { invalidCitationIds: string[]; uncitedFindingIndexes: number[] };
  telemetry?: AnalysisTelemetry;
  error?: { code: AnalysisFailureCode; message: string; requestId: string };
}
