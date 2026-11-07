// Aggregate leaderboard math, shared by the page, export tool and tests.
export function decisionBalanceScore(model, reference) {
  const { accuracy, cost_usd: cost, latency_ms: latency } = model;
  if (![accuracy, cost, latency, reference.cost_usd, reference.latency_ms].every(Number.isFinite)
      || accuracy < 0 || accuracy > 1 || Math.min(cost, latency, reference.cost_usd, reference.latency_ms) <= 0) {
    throw new Error('Invalid leaderboard measurements');
  }
  return 100 * (accuracy * reference.cost_usd / (reference.cost_usd + cost)
    * reference.latency_ms / (reference.latency_ms + latency)) ** (1 / 3);
}

export function sortModels(models, sort = 'dbs') {
  if (!['dbs', 'accuracy', 'latency'].includes(sort)) throw new Error('Unknown leaderboard sort');
  const field = sort === 'latency' ? 'latency_ms' : sort;
  const direction = sort === 'latency' ? 1 : -1;
  return [...models].sort((a, b) => direction * (a[field] - b[field]) || b.dbs - a.dbs || a.name.localeCompare(b.name));
}

export function topFamilyModels(models, family, limit = 3) {
  return [...models].sort((a, b) => b.families[family].accuracy - a.families[family].accuracy
    || b.dbs - a.dbs || a.name.localeCompare(b.name)).slice(0, limit);
}

export function percentileRanks(values, higherIsBetter = true) {
  if (!values.length || !values.every(Number.isFinite)) throw new Error('Invalid percentile inputs');
  if (values.length === 1) return [50];
  const directed = values.map(value => higherIsBetter ? value : -value);
  const counts = new Map();
  directed.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const ranks = new Map();
  let below = 0;
  [...counts.keys()].sort((a, b) => a - b).forEach(value => {
    ranks.set(value, 100 * (below + (counts.get(value) - 1) / 2) / (values.length - 1));
    below += counts.get(value);
  });
  return directed.map(value => ranks.get(value));
}

export function normalizedLatency(latency, reference) {
  if (![latency, reference].every(Number.isFinite) || Math.min(latency, reference) <= 0) {
    throw new Error('Invalid latency measurements');
  }
  return 100 * latency / (reference + latency);
}

export function normalizedEfficiency(efficiency, reference) {
  if (![efficiency, reference].every(Number.isFinite) || efficiency < 0 || reference <= 0) {
    throw new Error('Invalid efficiency measurements');
  }
  return efficiency === 0 ? 0 : 100 / (1 + reference / efficiency);
}

export function frontierPoints(models, reference) {
  const efficiency = models.map(model => model.accuracy / model.cost_usd);
  const ordered = [...efficiency].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  const x = models.map(model => normalizedLatency(model.latency_ms, reference.latency_ms));
  const y = efficiency.map(value => normalizedEfficiency(value, median));
  return models.map((model, i) => ({
    ...model, x: x[i], y: y[i], efficiency: efficiency[i],
    frontier: !models.some((other, j) => efficiency[j] >= efficiency[i] && other.latency_ms <= model.latency_ms
      && (efficiency[j] > efficiency[i] || other.latency_ms < model.latency_ms)),
  }));
}

export function validateLeaderboard(data) {
  if (data.schema_version !== 1 || !Number.isInteger(data.questions) || data.questions < 1
      || !Array.isArray(data.models) || !data.models.length || !Array.isArray(data.families) || !data.families.length) {
    throw new Error('Invalid leaderboard snapshot');
  }
  const ids = new Set();
  for (const model of data.models) {
    if (!model.id || ids.has(model.id) || typeof model.name !== 'string' || !model.name.trim()
        || !['audio', 'stt-text'].includes(model.input) || !Number.isInteger(model.correct)
        || model.correct < 0 || model.correct > data.questions
        || Math.abs(model.accuracy - model.correct / data.questions) > 1e-12
        || !Number.isFinite(model.dbs) || Math.abs(decisionBalanceScore(model, data.reference) - model.dbs) > 1e-8) {
      throw new Error('Invalid model metrics');
    }
    ids.add(model.id);
    for (const family of data.families) {
      const metric = model.families?.[family.id];
      if (!metric || !Number.isInteger(family.questions) || family.questions < 1
          || !Number.isInteger(metric.correct) || metric.correct < 0 || metric.correct > family.questions
          || !Number.isFinite(metric.accuracy) || Math.abs(metric.accuracy - metric.correct / family.questions) > 1e-12) {
        throw new Error('Invalid task-family metrics');
      }
    }
  }
  return data;
}
