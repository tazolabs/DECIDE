import { AlertError, alertQueue, processSubmissionAlert } from '../server/submission-alerts.mjs';

export default { fetch: alertQueue.handleCallback(async (message, metadata) => {
  try { await processSubmissionAlert(message, metadata); }
  catch (error) {
    // Queue logs must never receive a database exception or credential-bearing URL.
    throw new AlertError('slack_delivery_retry_scheduled', error instanceof AlertError ? error.retryAfter : 30);
  }
}, {
  visibilityTimeoutSeconds: 60,
  retry: (error) => ({ afterSeconds: Math.max(5, error.retryAfter || 30) }),
}) };
