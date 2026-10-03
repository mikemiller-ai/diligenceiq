// Dates render in UTC with a fixed locale so static HTML and client renders agree.
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

/**
 * Date and time in the reader's own time zone, without a zone label ("Oct 3, 2:24 PM"). Only for
 * views rendered after the workspace loads in the browser (never in the static HTML), so server and
 * client renders cannot disagree.
 */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatDurationSeconds(fromIso: string, toIso: string): string {
  const s = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000);
  return Number.isFinite(s) && s >= 0 ? `${s}s` : '—';
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
