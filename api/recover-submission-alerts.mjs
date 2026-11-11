import { constantEqual, safeResponse } from '../server/security.mjs';
import { recoverSubmissionAlerts } from '../server/submission-alerts.mjs';

export function recoveryHandler({ env = process.env, recover = recoverSubmissionAlerts } = {}) {
  return async (request) => {
    if (request.method !== 'GET') return safeResponse({ error: 'method_not_allowed' }, 405);
    if (!env.CRON_SECRET || !constantEqual(request.headers.get('authorization'), `Bearer ${env.CRON_SECRET}`)) {
      return safeResponse({ error: 'unauthorized' }, 401);
    }
    try { return safeResponse(await recover({ env })); }
    catch { return safeResponse({ error: 'notification_recovery_unavailable' }, 503); }
  };
}

export default { fetch: recoveryHandler() };
