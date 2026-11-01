import { queue, processEvaluation } from '../server/worker.mjs';

// Vercel's queue trigger makes this consumer private, with no public HTTP URL.
export default { fetch: queue.handleCallback(processEvaluation, {
  visibilityTimeoutSeconds: 300,
  retry: (error) => ({ afterSeconds: Math.min(300, Math.max(5, error.retryAfter || 30)) }),
}) };
