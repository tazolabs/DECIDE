import { randomUUID } from 'node:crypto';
import { QueueClient } from '@vercel/queue';
import { db } from './database.mjs';
import { readLimited } from './security.mjs';

export const alertQueue = new QueueClient({ region: 'iad1' });
export const ALERT_TOPIC = 'decide-submission-alerts';
const MAX_ATTEMPTS = 12;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export class AlertError extends Error {
  constructor(code, retryAfter = 0) {
    super(code);
    this.retryAfter = retryAfter;
  }
}

export function slackWebhook(env = process.env) {
  if (!env.DECIDE_SLACK_WEBHOOK_URL) return null;
  let url;
  try { url = new URL(env.DECIDE_SLACK_WEBHOOK_URL); } catch { throw new AlertError('slack_webhook_invalid'); }
  if (url.protocol !== 'https:' || !['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new AlertError('slack_webhook_invalid');
  }
  return url.href;
}

export function submissionAlert(job) {
  // All participant-controlled values use plain_text; never enable @mentions or links.
  const field = (label, value) => ({ type: 'plain_text', text: `${label}\n${value}`, emoji: false });
  const mode = job.mode === 'preview' ? 'Public preview' : 'Full benchmark';
  return {
    text: 'DECIDE: new model API submitted for evaluation',
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'New DECIDE evaluation', emoji: false } },
      { type: 'section', fields: [field('Model', job.model), field('Run type', mode),
        field('Input', job.modality === 'audio' ? 'Audio + text context' : 'STT text + text context'),
        field('Questions', job.total.toLocaleString('en-US'))] },
      { type: 'section', text: { type: 'plain_text',
        text: `Submitted: ${new Date(job.created_at).toISOString()}\nEvaluation ID: ${job.id}`, emoji: false } },
    ],
  };
}

export async function postSubmissionAlert(job, { env = process.env, fetcher = fetch } = {}) {
  const url = slackWebhook(env);
  if (!url) throw new AlertError('slack_not_configured', 300);
  let response;
  try {
    response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submissionAlert(job)) });
  } catch { throw new AlertError('slack_unreachable', 30); }
  // Never propagate Slack bodies/URLs: the URL is a credential.
  if (response.status === 429) {
    const delay = Number(response.headers.get('retry-after'));
    throw new AlertError('slack_rate_limited', Number.isFinite(delay) && delay > 0 ? delay : 60);
  }
  if (response.status >= 500 || response.status === 408) throw new AlertError('slack_unavailable', 30);
  if (!response.ok) throw new AlertError('slack_webhook_rejected');
  let body;
  try { body = (await readLimited(response, 2048)).toString('utf8').trim(); }
  catch { throw new AlertError('slack_invalid_response', 30); }
  if (body !== 'ok') throw new AlertError('slack_invalid_response', 30);
}

const store = {
  async claim(id, token) {
    const rows = await db()`UPDATE decide_jobs SET slack_alert_lease_token=${token}::uuid,
      slack_alert_lease_until=now()+interval '60 seconds', slack_alert_attempts=slack_alert_attempts+1
      WHERE id=${id}::uuid AND slack_alert_status='pending'
      AND (slack_alert_next_attempt_at IS NULL OR slack_alert_next_attempt_at<=now())
      AND (slack_alert_lease_until IS NULL OR slack_alert_lease_until<now())
      RETURNING id, model, modality, mode, total, created_at, slack_alert_attempts`;
    return rows[0];
  },
  async sent(id, token) {
    await db()`UPDATE decide_jobs SET slack_alert_status='sent', slack_alert_sent_at=now(),
      slack_alert_lease_token=NULL, slack_alert_lease_until=NULL, slack_alert_next_attempt_at=NULL, slack_alert_error=NULL
      WHERE id=${id}::uuid AND slack_alert_lease_token=${token}::uuid`;
  },
  async failed(id, token, code) {
    await db()`UPDATE decide_jobs SET slack_alert_status='failed', slack_alert_error=${code},
      slack_alert_lease_token=NULL, slack_alert_lease_until=NULL
      WHERE id=${id}::uuid AND slack_alert_lease_token=${token}::uuid`;
  },
  async retry(id, token, code, delay) {
    await db()`UPDATE decide_jobs SET slack_alert_error=${code}, slack_alert_lease_token=NULL,
      slack_alert_lease_until=NULL, slack_alert_next_attempt_at=now()+(${delay}*interval '1 second')
      WHERE id=${id}::uuid AND slack_alert_lease_token=${token}::uuid`;
  },
};

export async function enqueueSubmissionAlert(id, key = 'initial', sender = alertQueue) {
  // Independent of the evaluation queue. Never put API keys or receipt tokens in a payload.
  await sender.send(ALERT_TOPIC, { id }, {
    idempotencyKey: `submission:${id}:${key}`, retentionSeconds: 604800,
  });
}

export async function notifySubmission(job, { env = process.env, enqueue = enqueueSubmissionAlert,
  warn = console.warn } = {}) {
  if (!env.DECIDE_SLACK_WEBHOOK_URL || job.slack_alert_status !== 'pending') return;
  try { await enqueue(job.id); }
  catch { warn('DECIDE submission alert queue unavailable; scheduled recovery will retry.'); }
}

export async function processSubmissionAlert(message, metadata, {
  env = process.env, records = store, post = postSubmissionAlert,
} = {}) {
  if (!message || !UUID.test(message.id || '') || !env.DECIDE_SLACK_WEBHOOK_URL) return;
  const token = randomUUID();
  const job = await records.claim(message.id, token);
  if (!job) return; // Already sent, historical, leased, failed or cooling down.
  if (job.slack_alert_attempts > MAX_ATTEMPTS) {
    await records.failed(job.id, token, 'slack_retry_limit_reached');
    return;
  }
  try {
    await post(job, { env });
  } catch (error) {
    const code = error instanceof AlertError ? error.message : 'slack_delivery_failed';
    const delay = error instanceof AlertError ? error.retryAfter : 30;
    if (!delay || job.slack_alert_attempts >= MAX_ATTEMPTS) {
      await records.failed(job.id, token, code);
      return;
    }
    const retryAfter = Math.max(delay, Math.min(3600, 5 * 2 ** job.slack_alert_attempts));
    await records.retry(job.id, token, code, retryAfter);
    throw new AlertError('slack_retry_scheduled', retryAfter);
  }
  await records.sent(job.id, token);
}

export async function recoverSubmissionAlerts({ env = process.env, now = Date.now(),
  query = () => db()`SELECT id FROM decide_jobs WHERE slack_alert_status='pending'
    AND (slack_alert_next_attempt_at IS NULL OR slack_alert_next_attempt_at<=now())
    AND (slack_alert_lease_until IS NULL OR slack_alert_lease_until<now())
    ORDER BY created_at LIMIT 20`, enqueue = enqueueSubmissionAlert,
} = {}) {
  if (!env.DECIDE_SLACK_WEBHOOK_URL) return { queued: 0, disabled: true };
  const rows = await query();
  const key = `recovery:${Math.floor(now / 300000)}`;
  const outcomes = await Promise.allSettled(rows.map(({ id }) => enqueue(id, key)));
  const failed = outcomes.filter((result) => result.status === 'rejected').length;
  if (failed) throw new AlertError('slack_recovery_queue_unavailable', 60);
  return { queued: rows.length };
}
