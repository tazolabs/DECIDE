import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertError, ALERT_TOPIC, enqueueSubmissionAlert, notifySubmission, postSubmissionAlert,
  processSubmissionAlert, recoverSubmissionAlerts, slackWebhook, submissionAlert } from '../server/submission-alerts.mjs';
import { recoveryHandler } from '../api/recover-submission-alerts.mjs';

const env = { DECIDE_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test/team/test-only' };
const job = {
  id: 'f95f6cef-c3be-45e4-8972-cfed979c0921', model: 'my-model', modality: 'audio',
  mode: 'benchmark', total: 4867, created_at: '2026-11-11T12:00:00Z', slack_alert_status: 'pending',
  endpoint: 'https://api.example.com/private-endpoint', api_key_ciphertext: 'never-send-the-key',
  result_token: 'never-send-the-receipt', metrics: { private: 'never-send-metrics' },
};

function recordsFor({ attempts = 0 } = {}) {
  let pending = true, leased = false;
  const events = [];
  return { events,
    async claim(id, token) {
      assert.equal(id, job.id);
      assert.match(token, /^[a-f0-9-]{36}$/);
      if (!pending || leased) return;
      leased = true;
      return { ...job, slack_alert_attempts: ++attempts };
    },
    async sent(id) { assert.equal(id, job.id); pending = false; leased = false; events.push('sent'); },
    async failed(id, token, code) { pending = false; leased = false; events.push(['failed', code]); },
    async retry(id, token, code, delay) { leased = false; events.push(['retry', code, delay]); },
  };
}

test('Slack payload contains only submission metadata and renders model names as plain text', () => {
  const payload = submissionAlert({ ...job, model: '@here <!channel> <https://example.com|click>' });
  const serialized = JSON.stringify(payload);
  for (const secret of ['never-send-the-key', 'never-send-the-receipt', 'never-send-metrics', 'private-endpoint']) {
    assert(!serialized.includes(secret));
  }
  assert(!serialized.includes('mrkdwn'));
  assert(!payload.text.includes('@here'));
  assert.equal(payload.blocks[1].fields[0].type, 'plain_text');
  assert.equal(payload.blocks[1].fields[1].text, 'Run type\nFull benchmark');
  assert.equal(payload.blocks[1].fields[3].text, 'Questions\n4,867');
  const preview = submissionAlert({ ...job, mode: 'preview', total: 6, modality: 'text' });
  assert.equal(preview.blocks[1].fields[1].text, 'Run type\nPublic preview');
  assert.match(preview.blocks[1].fields[2].text, /STT text/);
});

test('webhook configuration only permits real Slack HTTPS webhook hosts and never echoes secrets', () => {
  assert.equal(slackWebhook({}), null);
  assert.equal(slackWebhook(env), env.DECIDE_SLACK_WEBHOOK_URL);
  for (const value of ['http://hooks.slack.com/services/test/team/secret',
    'https://hooks.slack.com.evil.example/services/test/team/secret', 'https://127.0.0.1/services/test/team/secret',
    env.DECIDE_SLACK_WEBHOOK_URL + '?secret=value', 'https://user:secret@hooks.slack.com/services/a/b/c']) {
    assert.throws(() => slackWebhook({ DECIDE_SLACK_WEBHOOK_URL: value }), (error) =>
      error.message === 'slack_webhook_invalid' && !error.message.includes(value));
  }
});

test('Slack delivery uses bounded requests and respects rate-limit responses without leaking bodies', async () => {
  let sent;
  await postSubmissionAlert(job, { env, fetcher: async (url, options) => {
    assert.equal(url, env.DECIDE_SLACK_WEBHOOK_URL);
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    sent = JSON.parse(options.body);
    return new Response('ok');
  } });
  assert.equal(sent.blocks[1].fields[0].text, 'Model\nmy-model');
  for (const [status, retryAfter] of [[429, 123], [500, 30], [403, 0]]) {
    await assert.rejects(postSubmissionAlert(job, { env, fetcher: async () => new Response('private-body', {
      status, headers: { 'retry-after': '123' },
    }) }), (error) => error instanceof AlertError && error.retryAfter === retryAfter && !error.message.includes('private-body'));
  }
  await assert.rejects(postSubmissionAlert(job, { env, fetcher: async () => { throw new Error(env.DECIDE_SLACK_WEBHOOK_URL); } }),
    (error) => error.message === 'slack_unreachable');
});

test('queue payloads contain only a job ID and use a stable publishing idempotency key', async () => {
  const calls = [];
  const sender = { send: async (...args) => calls.push(args) };
  await enqueueSubmissionAlert(job.id, 'initial', sender);
  await enqueueSubmissionAlert(job.id, 'initial', sender);
  assert.equal(calls[0][0], ALERT_TOPIC);
  assert.deepEqual(calls[0][1], { id: job.id });
  assert.equal(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
});

test('notification queue failures do not reject submissions; disabled and sent jobs are ignored', async () => {
  const warnings = [];
  const enqueue = async () => { throw new Error('private upstream failure'); };
  await notifySubmission(job, { env, enqueue, warn: (value) => warnings.push(value) });
  assert.equal(warnings.length, 1);
  assert(!warnings[0].includes('private upstream failure'));
  const unexpected = async () => assert.fail('Should not enqueue');
  await notifySubmission(job, { env: {}, enqueue: unexpected });
  await notifySubmission({ ...job, slack_alert_status: 'sent' }, { env, enqueue: unexpected });
  await notifySubmission({ ...job, slack_alert_status: null }, { env, enqueue: unexpected });
});

test('redelivery and concurrent consumers do not resend an already-sent or leased alert', async () => {
  const records = recordsFor();
  let sends = 0;
  const post = async () => { sends++; };
  await Promise.all([processSubmissionAlert({ id: job.id }, {}, { env, records, post }),
    processSubmissionAlert({ id: job.id }, {}, { env, records, post })]);
  await processSubmissionAlert({ id: job.id }, {}, { env, records, post });
  assert.equal(sends, 1);
  assert.deepEqual(records.events, ['sent']);
});

test('temporary Slack failures are retried independently of evaluation state', async () => {
  const records = recordsFor();
  await assert.rejects(processSubmissionAlert({ id: job.id }, {}, { env, records,
    post: async () => { throw new AlertError('slack_rate_limited', 123); },
  }), (error) => error.message === 'slack_retry_scheduled' && error.retryAfter >= 123);
  assert.deepEqual(records.events, [['retry', 'slack_rate_limited', 123]]);
  await processSubmissionAlert({ id: job.id }, {}, { env, records, post: async () => {} });
  assert.equal(records.events.at(-1), 'sent');
});

test('permanent Slack failures and retry limits stop only alert delivery', async () => {
  const records = recordsFor();
  await processSubmissionAlert({ id: job.id }, {}, { env, records,
    post: async () => { throw new AlertError('slack_webhook_rejected'); },
  });
  assert.deepEqual(records.events, [['failed', 'slack_webhook_rejected']]);
  const exhausted = recordsFor({ attempts: 11 });
  await processSubmissionAlert({ id: job.id }, {}, { env, records: exhausted,
    post: async () => { throw new AlertError('slack_unavailable', 30); },
  });
  assert.deepEqual(exhausted.events, [['failed', 'slack_unavailable']]);
  const crashed = recordsFor({ attempts: 12 });
  await processSubmissionAlert({ id: job.id }, {}, { env, records: crashed, post: async () => assert.fail('Budget exhausted') });
  assert.deepEqual(crashed.events, [['failed', 'slack_retry_limit_reached']]);
});

test('malformed queue messages and unconfigured notifications never access the database', async () => {
  const records = { claim: async () => assert.fail('Should not claim') };
  for (const message of [null, {}, { id: 'bad' }]) await processSubmissionAlert(message, {}, { env, records });
  await processSubmissionAlert({ id: job.id }, {}, { env: {}, records });
});

test('recovery requeues due jobs with stable time-bucket keys and signals publication failures', async () => {
  const calls = [];
  const deps = { env, now: 300000, query: async () => [{ id: job.id }], enqueue: async (...args) => calls.push(args) };
  assert.deepEqual(await recoverSubmissionAlerts(deps), { queued: 1 });
  assert.deepEqual(calls, [[job.id, 'recovery:1']]);
  await assert.rejects(recoverSubmissionAlerts({ ...deps, enqueue: async () => { throw new Error('secret'); } }),
    (error) => error.message === 'slack_recovery_queue_unavailable');
  assert.deepEqual(await recoverSubmissionAlerts({ env: {}, query: async () => assert.fail('Disabled') }), { queued: 0, disabled: true });
});

test('cron recovery requires its server secret before any side effects', async () => {
  let runs = 0;
  const handler = recoveryHandler({ env: { ...env, CRON_SECRET: 'test-only' }, recover: async () => { runs++; return { queued: 1 }; } });
  for (const token of ['', 'Bearer incorrect']) {
    const response = await handler(new Request('https://example.com/api/recover-submission-alerts', { headers: { authorization: token } }));
    assert.equal(response.status, 401);
  }
  assert.equal(runs, 0);
  const response = await handler(new Request('https://example.com/api/recover-submission-alerts', { headers: { authorization: 'Bearer test-only' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { queued: 1 });
  assert.equal(runs, 1);
});
