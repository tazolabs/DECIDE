import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decisionBalanceScore, frontierPoints, normalizedLatency, percentileRanks, sortModels, topFamilyModels, validateLeaderboard } from '../site/leaderboard-model.js';
import { publicLeaderboard } from '../tools/export-leaderboard.mjs';

const snapshot = JSON.parse(await readFile(new URL('../site/data/leaderboard.json', import.meta.url), 'utf8'));

test('the published snapshot reconciles accuracy and DBS for all 20 models', () => {
  assert.equal(validateLeaderboard(snapshot), snapshot);
  assert.equal(snapshot.questions, 4867);
  assert.equal(snapshot.models.length, 20);
  assert.deepEqual(snapshot.families.map(f => f.id), ['voice', 'business', 'tools', 'routing', 'turns']);
  const tazo = snapshot.models.find(model => model.id === 'tazo');
  assert.equal(tazo.name, 'Tazo');
  assert.equal(tazo.latency_ms, 474);
  assert(Math.abs(tazo.dbs - 67.58107493670228) < 1e-9);
  for (const model of snapshot.models) {
    assert.equal(model.accuracy, model.correct / snapshot.questions);
    assert(Math.abs(decisionBalanceScore(model, snapshot.reference) - model.dbs) < 1e-8);
  }
});

test('all three table sort modes use the requested direction without mutating the snapshot', () => {
  const original = snapshot.models.map(m => m.id);
  const dbs = sortModels(snapshot.models);
  const accuracy = sortModels(snapshot.models, 'accuracy');
  const latency = sortModels(snapshot.models, 'latency');
  assert.equal(dbs[0].id, 'tazo');
  assert.equal(accuracy[0].name, 'Gemini 2.5 Flash');
  assert.equal(latency[0].id, 'tazo');
  for (let i = 1; i < snapshot.models.length; i++) {
    assert(dbs[i - 1].dbs >= dbs[i].dbs);
    assert(accuracy[i - 1].accuracy >= accuracy[i].accuracy);
    assert(latency[i - 1].latency_ms <= latency[i].latency_ms);
  }
  assert.deepEqual(snapshot.models.map(m => m.id), original);
  assert.throws(() => sortModels(snapshot.models, 'other'));
});

test('DBS does not depend on currency or time units', () => {
  for (const model of snapshot.models) {
    const transformed = { ...model, cost_usd: model.cost_usd * 100, latency_ms: model.latency_ms / 1000 };
    const reference = { cost_usd: snapshot.reference.cost_usd * 100, latency_ms: snapshot.reference.latency_ms / 1000 };
    assert(Math.abs(decisionBalanceScore(transformed, reference) - model.dbs) < 1e-8);
  }
});

test('family rankings support the top-five voice table and use DBS as a deterministic tie break', () => {
  for (const family of snapshot.families) {
    const top = topFamilyModels(snapshot.models, family.id);
    assert.equal(top.length, 3);
    for (let i = 1; i < top.length; i++) assert(top[i - 1].families[family.id].accuracy >= top[i].families[family.id].accuracy);
  }
  assert.equal(topFamilyModels(snapshot.models, 'voice')[0].id, 'tazo');
  assert.deepEqual(topFamilyModels(snapshot.models, 'voice', 5).map(model => model.id),
    ['tazo', 'perceptron-mk1-5', 'gpt-realtime-2-1', 'qwen2-5-omni-3b', 'gemini-2-5-flash']);
  const tiedTurnModels = snapshot.models.filter(m => m.name === 'Gemini 2.5 Flash' || m.name === 'Gemini 2.5 Pro');
  assert.equal(tiedTurnModels[0].families.turns.correct, tiedTurnModels[1].families.turns.correct);
  assert.equal(topFamilyModels(snapshot.models, 'turns')[2].name, 'Gemini 2.5 Flash');
});

test('normalized latency is bounded, monotonic, median-centered and independent of time units', () => {
  const reference = snapshot.reference.latency_ms;
  assert.equal(normalizedLatency(reference, reference), 50);
  const values = snapshot.models.map(model => model.latency_ms).sort((a, b) => a - b);
  values.forEach((value, i) => {
    const normalized = normalizedLatency(value, reference);
    assert(normalized > 0 && normalized < 100);
    assert(Math.abs(normalized - normalizedLatency(value / 1000, reference / 1000)) < 1e-12);
    if (i) assert(normalized > normalizedLatency(values[i - 1], reference));
  });
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => normalizedLatency(value, reference));
  assert.throws(() => normalizedLatency(100, 0));
});

test('the top-left frontier preserves the raw efficiency–latency dominance relationships', () => {
  assert.deepEqual(percentileRanks([1, 2, 2, 100]), [0, 50, 50, 100]);
  assert.deepEqual(percentileRanks([1, 2, 2, 100], false), [100, 50, 50, 0]);
  assert.deepEqual(percentileRanks([1]), [50]);
  assert.throws(() => percentileRanks([NaN]));
  const points = frontierPoints(snapshot.models, snapshot.reference);
  assert.equal(points.length, 20);
  for (const point of points) {
    assert(point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100);
    const dominated = points.some(other => other.x <= point.x && other.y >= point.y && (other.x < point.x || other.y > point.y));
    const rawDominated = points.some(other => other.latency_ms <= point.latency_ms && other.efficiency >= point.efficiency
      && (other.latency_ms < point.latency_ms || other.efficiency > point.efficiency));
    assert.equal(dominated, rawDominated);
    assert.equal(point.frontier, !dominated);
  }
  const tazo = points.find(point => point.id === 'tazo');
  assert.equal(tazo.frontier, true);
  assert.equal(tazo.x, Math.min(...points.map(point => point.x)));
  assert(tazo.x < 50 && tazo.y > 50);
});

test('invalid metrics fail rather than silently changing rankings', () => {
  const invalid = structuredClone(snapshot);
  invalid.models[0].dbs += 1;
  assert.throws(() => validateLeaderboard(invalid));
  invalid.models[0].dbs = snapshot.models[0].dbs;
  invalid.models[0].families.voice.correct += 1;
  assert.throws(() => validateLeaderboard(invalid));
  assert.throws(() => decisionBalanceScore({ accuracy: .8, cost_usd: 0, latency_ms: 100 }, snapshot.reference));
});

test('the public export allowlists aggregates and excludes private analysis fields', () => {
  const mapping = { voice: 'Voice properties', business: 'Business and conversation', tools: 'Tool decisions', routing: 'Graph routing', turns: 'Turn taking' };
  const source = {
    questions: snapshot.questions,
    normalization: { cost_reference_usd: snapshot.reference.cost_usd, latency_reference_seconds: snapshot.reference.latency_ms / 1000 },
    secret: 'must-not-be-exported',
    models: snapshot.models.map(model => ({
      model: model.name, uses_stt: model.input === 'stt-text', provider: 'test',
      accuracy: model.accuracy, cost: model.cost_usd, latency: model.latency_ms / 1000, balance_score: model.dbs,
      source: '/private/local/path', clip_transcript: 'must-not-be-exported',
      metrics: { overall: { correct: model.correct }, by_family: Object.fromEntries(snapshot.families.map(family => [mapping[family.id], {
        selected: family.questions, correct: model.families[family.id].correct, exact_accuracy: model.families[family.id].accuracy,
      }])) },
    })),
  };
  const exported = publicLeaderboard(source);
  assert.equal(exported.models.length, 20);
  assert.equal(exported.models[0].latency_ms, source.models[0].latency * 1000);
  for (const forbidden of ['must-not-be-exported', '/private/local/path', 'clip_transcript', 'TAZO_BEARER_TOKEN']) {
    assert(!JSON.stringify(exported).includes(forbidden));
  }
});
