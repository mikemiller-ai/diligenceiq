import type { FilingType } from '@diligenceiq/core';

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
