'use client';

import { ErrorPanel, RetryButton } from '@/components/diligence/states';
import { formatDateTime } from '@/lib/format';
import { useWorkspace } from '@/lib/workspace-store';

/**
 * Shown when the demo workspace could not be opened (no session): the reason, the request ID,
 * and a retry. A workspace-creation cap (RATE_LIMITED: this network's daily limit, or the
 * demo's) says when to come back. The landing page and the company list (static catalog) still
 * render; pages that need the workspace say so instead of loading forever.
 */
export function WorkspaceBanner() {
  const { status, error, reload } = useWorkspace();
  if (status !== 'error' || !error) return null;
  const scope = error.details?.scope;
  const title =
    error.code === 'RATE_LIMITED'
      ? scope === 'workspace_creation_client'
        ? 'This network has opened its limit of demo workspaces for today'
        : 'The demo is at its limit of new workspaces for today'
      : error.code === 'NETWORK'
        ? 'Connection lost'
        : 'Your demo workspace could not be opened';
  const retryAfter = error.code === 'RATE_LIMITED' && typeof error.details?.retryAfter === 'string' ? error.details.retryAfter : null;
  const message = retryAfter ? `${error.message} New workspaces open again after ${formatDateTime(retryAfter)}. The company list and this site’s pages stay available.` : error.message;
  return (
    <div className="no-print mx-auto max-w-[1200px] px-4 pt-6 md:px-8">
      <ErrorPanel title={title} message={message} {...(error.requestId ? { requestId: error.requestId } : {})} code={error.code} action={<RetryButton onClick={() => void reload()} />} />
    </div>
  );
}
