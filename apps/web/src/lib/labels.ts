import type { AnalysisStatus, FindingOriginKind, FindingStatus, SignalType, Trajectory } from '@diligenceiq/core';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const FINDING_STATUS: Record<FindingStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'accent' },
  NEEDS_FOLLOW_UP: { label: 'Needs follow-up', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
};

export const ANALYSIS_STATUS: Record<AnalysisStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: 'Queued', tone: 'neutral' },
  RUNNING: { label: 'Running', tone: 'info' },
  COMPLETE: { label: 'Complete', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export const FINDING_ORIGIN: Record<FindingOriginKind, string> = {
  intelligence: 'Company Intelligence',
  compare: 'Compare',
  analysis: 'Deep Analysis',
  watch: 'Watchlist',
};

/** Descriptive trajectory labels (SPEC §8.4, §9). Never a rating. */
export const TRAJECTORY_LABEL: Record<Trajectory, string> = {
  accelerating: 'Accelerating',
  growing: 'Growing',
  stable: 'Stable',
  slowing: 'Slowing',
  declining: 'Declining',
  improving: 'Improving',
  not_extracted: 'Not extracted',
  limited_history: 'Limited history',
};

export const SIGNAL_TYPE_LABEL: Record<SignalType, string> = {
  NEW: 'New',
  EXPANDED: 'Expanded',
  REDUCED: 'Reduced',
  TREND_CHANGE: 'Trend change',
  OUTLOOK_CHANGE: 'Outlook change',
  PERSISTENT: 'Persistent',
};

/** Plain-language copy for analysis-level failure codes (architecture §9). */
export const FAILURE_COPY: Record<string, { title: string; action: string }> = {
  QUEUE_TIMEOUT: { title: 'The analysis waited too long to start', action: 'Run it again; capacity frees up quickly.' },
  PIPELINE_TIMEOUT: { title: 'The analysis ran out of time before the brief was generated', action: 'Run it again, or narrow the companies or period.' },
  GENERATION_TIMEOUT: { title: 'The analysis took too long', action: 'Run it again; a re-run creates a new analysis.' },
  GENERATION_FAILED: { title: 'The brief could not be generated', action: 'Run it again in a moment.' },
  MALFORMED_OUTPUT: { title: 'The answer couldn’t be validated', action: 'Run it again; no partial brief was saved.' },
  NO_RELEVANT_EVIDENCE: { title: 'No passages matched this question', action: 'Rephrase the question or widen the filters.' },
  INDEX_UNAVAILABLE: { title: 'Filing search is unavailable right now', action: 'Try again shortly.' },
  WORKER_FAILED: { title: 'The analysis failed unexpectedly', action: 'Run it again. Share the request ID if it repeats.' },
  ANALYSES_DISABLED: { title: 'New analyses are paused', action: 'Company Intelligence, Compare and saved findings remain available.' },
  ENQUEUE_FAILED: { title: 'The analysis could not be queued', action: 'Run it again in a moment.' },
};
