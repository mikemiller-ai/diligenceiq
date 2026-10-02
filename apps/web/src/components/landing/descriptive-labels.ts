import { SIGNAL_TYPE_LABEL, TRAJECTORY_LABEL } from '@/lib/labels';

/** Real labels from lib/labels.ts, shown on the landing as the product's descriptive vocabulary. */
export const DESCRIPTIVE_LABELS = [TRAJECTORY_LABEL.growing, TRAJECTORY_LABEL.slowing, SIGNAL_TYPE_LABEL.NEW, SIGNAL_TYPE_LABEL.PERSISTENT] as const;
