import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { authorizeResult, encryptSecret, decryptSecret, endpointDispatcher, errorResponse,
  normalizeEndpoint, publicAddress, readLimited, resultToken, validateSubmission } from '../server/security.mjs';
import { addOutcome, aggregateReport, emptyMetrics, validateAnswer } from '../server/metrics.mjs';
import { predictModel, retryDelay } from '../server/model.mjs';
import { loadDataset, audioBytes } from '../server/dataset.mjs';

process.env.DECIDE_ENCRYPTION_KEY = 'ab'.repeat(32);
const criteria = { agent: 'Agent speaks', caller: 'Caller speaks' };
const question = { id: 'never-send-this', task: 'next_turn', family: 'turn_taking', duration_bucket: '5-10',
  audio_request: { state: { context: 'Earlier dialogue' }, questions: { action: { type: 'choice', criteria } } },
  text_request: { state: { context: 'Earlier dialogue', clip_transcript: 'Hello?' }, questions: { action: { type: 'choice', criteria } } },
  label: 'never-send-this-either' };

test('endpoint policy rejects local networks, IP encodings, credentials and redirects in URLs', () => {
  for (const value of ['http://example.com', 'https://localhost', 'https://host.internal/a',
    'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]',
    'https://a:b@example.com', 'https://example.com:444', 'https://example.com/?token=secret',
    'https://example.com/#secret', 'https://example.com.']) assert.throws(() => normalizeEndpoint(value));
  assert.equal(normalizeEndpoint('https://EXAMPLE.com:443/v1/decisions'), 'https://example.com/v1/decisions');
});

test('DNS validation rejects mixed public/private answers and pins public connections', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(publicAddress(address), false);
    await assert.rejects(endpointDispatcher('https://example.com', async () => [{ address, family: 4 }]));
  }
  await assert.rejects(endpointDispatcher('https://example.com', async () => [
    { address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]));
  const agent = await endpointDispatcher('https://example.com', async () => [{ address: '8.8.8.8', family: 4 }]);
  await agent.close();
});

test('encrypted API keys are bound to the job; result authorization is isolated', () => {
  const id = randomUUID(), other = randomUUID();
  const ciphertext = encryptSecret('test-only-secret', id);
  assert.equal(decryptSecret(ciphertext, id), 'test-only-secret');
  assert.throws(() => decryptSecret(ciphertext, other));
  const tampered = Buffer.from(ciphertext, 'base64'); tampered[20] ^= 1;
  assert.throws(() => decryptSecret(tampered.toString('base64'), id));
  assert.notEqual(resultToken(id), resultToken(other));
  const request = (token) => new Request('https://example.com', { headers: { authorization: `Bearer ${token}` } });
  authorizeResult(request(resultToken(id)), id);
  assert.throws(() => authorizeResult(request(resultToken(other)), id));
});

test('submissions forbid participant-selected dataset paths and unsafe API keys', () => {
  const body = { endpoint: 'https://example.com/model', model: 'test-model', modality: 'audio',
    invitation_token: 'x'.repeat(43), idempotency_key: randomUUID() };
  assert.equal(validateSubmission(body).mode, 'benchmark');
  for (const change of [{ dataset: 'other' }, { api_key: 'key\r\nInjected: yes' }, { mode: 'custom' },
    { invitation_token: 'short' }, { modality: 'unknown' }]) assert.throws(() => validateSubmission({ ...body, ...change }));
});

test('provider answer validation checks option IDs, exact probability keys and argmax', () => {
  assert.equal(validateAnswer({ choice: 'caller' }, criteria, 'test'), 'caller');
  assert.equal(validateAnswer({ model: 'test', answers: { action: { choice: 'caller', probabilities: { agent: .2, caller: .8 } } } }, criteria, 'test'), 'caller');
  for (const answer of [{ choice: 'other' }, { model: 'wrong', choice: 'agent' },
    { choice: 'caller', probabilities: { agent: .8, caller: .2 } },
    { choice: 'caller', probabilities: { agent: .2, caller: .8, extra: 0 } },
    { choice: 'caller', probabilities: { agent: 0, caller: NaN } },
    { choice: 'caller', probabilities: { agent: .1, caller: .1 } }]) assert.throws(() => validateAnswer(answer, criteria, 'test'));
});

test('transport sends frozen inputs without references, IDs or storage credentials', async () => {
  const connect = async () => ({ close: async () => {} });
  for (const modality of ['audio', 'text']) {
    const fetcher = async (url, options) => {
      assert.equal(url, 'https://example.com/model');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(Object.keys(options.headers).sort(), (modality === 'audio'
        ? ['Accept', 'Authorization', 'Idempotency-Key'] : ['Accept', 'Authorization', 'Content-Type', 'Idempotency-Key']).sort());
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      const sent = modality === 'audio' ? JSON.parse(options.body.get('request')) : JSON.parse(options.body);
      assert.deepEqual(sent, { ...question[`${modality}_request`], model: 'test' });
      assert(!JSON.stringify(sent).includes('never-send-this'));
      if (modality === 'audio') assert.equal(options.body.get('audio').name, 'clip.wav');
      return Response.json({ choice: 'agent' });
    };
    assert.equal(await predictModel({ endpoint: 'https://example.com/model', model: 'test', modality },
      question, 'test-only', Buffer.from('audio'), 'opaque-id', fetcher, connect), 'agent');
  }
});

test('upstream error bodies and secrets never appear in public errors', async () => {
  const connect = async () => ({ close: async () => {} });
  for (const status of [401, 429, 500]) {
    let error;
    try { await predictModel({ endpoint: 'https://example.com', model: 'test', modality: 'text' },
      question, 'test-only', null, 'opaque-id', async () => new Response('private prompt and secret', { status }), connect); }
    catch (value) { error = value; }
    assert(error);
    const response = errorResponse(error);
    assert(!JSON.stringify(await response.json()).includes('private prompt'));
    assert.equal(response.headers.get('Cache-Control'), 'no-store, private');
  }
  assert.deepEqual(await errorResponse(new Error('secret')).json(), { error: 'service_unavailable' });
});

test('oversized provider responses and retry delays are bounded', async () => {
  await assert.rejects(readLimited(new Response('too big'), 2));
  await assert.rejects(readLimited(new Response('x', { headers: { 'content-length': '1000' } }), 2));
  assert.equal(retryDelay('999999'), 300);
  assert.equal(retryDelay(null), 5);
});

test('metrics count failures in denominator and return only aggregate cells', () => {
  const metrics = emptyMetrics();
  addOutcome(metrics, question, { label: 'agent' }, 'agent');
  addOutcome(metrics, question, { label: 'agent' }, null);
  const report = aggregateReport(metrics, 2);
  assert.equal(report.overall.accuracy, .5);
  assert.equal(report.overall.coverage, .5);
  assert.equal(report.by_task.next_turn.suppressed, true);
  assert(!Object.hasOwn(report.by_task.next_turn, 'accuracy'));
  assert(!JSON.stringify(report).includes('never-send-this'));
});

test('public preview loader verifies all six audio hashes', async () => {
  const data = await loadDataset('preview');
  assert.equal(data.questions.length, 6);
  for (const row of data.questions) assert((await audioBytes(row, 'preview')).length > 100);
});
