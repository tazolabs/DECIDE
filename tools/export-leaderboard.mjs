// Deliberately allowlist aggregate metrics. No benchmark rows, labels or audio are exported.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateLeaderboard } from '../site/leaderboard-model.js';

const FAMILIES = [
  ['voice', 'Voice-based properties', 'Voice properties'],
  ['business', 'Business & conversations', 'Business and conversation'],
  ['tools', 'Tool decisions', 'Tool decisions'],
  ['routing', 'Graph routing', 'Graph routing'],
  ['turns', 'Turn taking', 'Turn taking'],
];

export function publicLeaderboard(source) {
  if (source.questions !== 4867 || source.models?.length !== 20) throw new Error('Expected the approved 4,867-question, 20-model report');
  const snapshot = {
    schema_version: 1,
    questions: source.questions,
    reference: { cost_usd: source.normalization.cost_reference_usd, latency_ms: source.normalization.latency_reference_seconds * 1000 },
    families: FAMILIES.map(([id, name, key]) => ({ id, name, questions: source.models[0].metrics.by_family[key].selected })),
    models: source.models.map(model => {
      const name = model.model.replace(' (OpenRouter)', '');
      return {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        input: model.uses_stt ? 'stt-text' : 'audio',
        correct: model.metrics.overall.correct,
        accuracy: model.accuracy,
        cost_usd: model.cost,
        latency_ms: model.latency * 1000,
        latency_basis: name === 'Tazo' ? 'optimized' : model.provider === 'self-hosted A100' ? 'estimated' : 'client',
        dbs: model.balance_score,
        families: Object.fromEntries(FAMILIES.map(([id, , key]) => [id, {
          correct: model.metrics.by_family[key].correct,
          accuracy: model.metrics.by_family[key].exact_accuracy,
        }])),
      };
    }),
  };
  return validateLeaderboard(snapshot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--output') {
      throw new Error('Usage: node tools/export-leaderboard.mjs --source /path/to/analysis.json --output site/data/leaderboard.json');
    }
    const snapshot = publicLeaderboard(JSON.parse(await readFile(args[1], 'utf8')));
    await mkdir(dirname(args[3]), { recursive: true });
    await writeFile(args[3], JSON.stringify(snapshot, null, 2) + '\n');
    console.log(`Exported ${snapshot.models.length} models and ${snapshot.families.length} task families.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
