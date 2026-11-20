// Maintainer-only aggregate import; private evaluation rows never enter the site.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decisionBalanceScore, validateLeaderboard} from '../site/leaderboard-model.js';

const FAMILIES = {voice:'Voice properties',business:'Business and conversation',tools:'Tool decisions',routing:'Graph routing',turns:'Turn taking'};
const FINGERPRINT = 'e55f07455b7b218f37c7f156836b6568e88d77bfa50033199e97f368d47db187';

export function importGeminiDecisions(snapshot, report) {
  validateLeaderboard(snapshot);
  const overall = report.metrics?.overall;
  const cost = report.cost;
  const timing = report.latency;
  if (report.model !== 'gemini-decision-1' || report.adapter_version !== 'decide-google-native-decisions-audio-v1'
      || report.dataset_fingerprint !== FINGERPRINT || report.metrics?.dataset_fingerprint !== FINGERPRINT
      || report.selected_questions !== snapshot.questions || report.completed_questions !== snapshot.questions
      || overall?.selected !== snapshot.questions || !Number.isInteger(overall.scored) || overall.scored < 0
      || !Number.isInteger(overall.errors_or_not_attempted) || overall.errors_or_not_attempted < 0
      || overall.scored + overall.errors_or_not_attempted !== snapshot.questions
      || !Number.isInteger(overall.correct) || overall.correct < 0 || overall.correct > overall.scored
      || overall.exact_accuracy !== overall.correct / snapshot.questions) {
    throw new Error('Expected a complete Gemini Decision 1 run on the frozen benchmark');
  }
  if (cost?.unpriced_http_200_responses !== 0 || cost.input_usd_per_million_tokens !== .1
      || !Number.isInteger(cost.total_input_tokens) || cost.total_input_tokens <= 0
      || !Number.isInteger(cost.priced_responses) || cost.priced_responses < overall.scored
      || !Number.isInteger(cost.http_attempts) || cost.http_attempts < cost.priced_responses
      || !Object.keys(cost.input_tokens_by_modality || {}).length
      || Object.entries(cost.input_tokens_by_modality || {}).some(([key,n]) => !['text','audio'].includes(key) || !Number.isInteger(n) || n < 0)
      || Object.values(cost.input_tokens_by_modality || {}).reduce((sum, n) => sum + n, 0) !== cost.total_input_tokens
      || Math.abs(cost.estimated_run_cost_usd - cost.total_input_tokens * .1 / 1e6) > 1e-10
      || timing?.n !== overall.scored || !Number.isFinite(timing.mean_request_ms) || timing.mean_request_ms <= 0) {
    throw new Error('Missing or inconsistent usage-based cost / request latency');
  }
  const families = Object.fromEntries(snapshot.families.map(family => {
    const metric = report.metrics.by_family?.[FAMILIES[family.id]];
    if (metric?.selected !== family.questions || !Number.isInteger(metric.correct)
        || metric.exact_accuracy !== metric.correct / family.questions) throw new Error('Family totals do not match');
    return [family.id, {correct:metric.correct, accuracy:metric.exact_accuracy}];
  }));
  const fullFamilies=Object.values(report.metrics.by_family);
  if (fullFamilies.some(family=>!Number.isInteger(family.selected) || family.selected<1 || !Number.isInteger(family.correct)
      || family.correct<0 || family.correct>family.selected)
      || fullFamilies.reduce((sum,family)=>sum+family.selected,0)!==snapshot.questions
      || fullFamilies.reduce((sum,family)=>sum+family.correct,0)!==overall.correct) {
    throw new Error('Family correct counts do not reconcile');
  }
  const model = {
    id:'gemini-decision-1', name:'Gemini Decision 1', company:'Google', input:'audio',
    correct:overall.correct, accuracy:overall.correct / snapshot.questions,
    cost_usd:cost.estimated_run_cost_usd, latency_ms:timing.mean_request_ms,
    latency_basis:'client', dbs:null, families,
    measurements:{
      cost:{status:'api-usage-estimate', value_usd:cost.estimated_run_cost_usd,
        source_url:'https://aistudio.google.com/docs/pricing#gemini-decision',
        input_usd_per_million_tokens:.1, total_input_tokens:cost.total_input_tokens,
        input_tokens_by_modality:{...cost.input_tokens_by_modality},
        priced_responses:cost.priced_responses, basis:cost.basis},
      latency:{status:'measured-http',value_ms:timing.mean_request_ms,n:timing.n,
        median_ms:timing.median_request_ms,p95_ms:timing.p95_request_ms,basis:timing.basis},
    },
    evaluation:{completed_at:report.updated_at,failed_or_missing:overall.errors_or_not_attempted,
      dataset_fingerprint:FINGERPRINT,adapter_version:report.adapter_version,
      source_url:'https://aistudio.google.com/docs/decisions-api'},
  };
  model.dbs = decisionBalanceScore(model, snapshot.reference);
  const output = structuredClone(snapshot);
  output.models = [...output.models.filter(item => item.id !== model.id), model];
  return validateLeaderboard(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--report' || args[2] !== '--snapshot') {
      throw new Error('Usage: node tools/import-gemini-decisions.mjs --report private/report.json --snapshot site/data/leaderboard.json');
    }
    const [report,snapshot] = await Promise.all([args[1],args[3]].map(async path => JSON.parse(await readFile(path,'utf8'))));
    const output = importGeminiDecisions(snapshot, report);
    await writeFile(args[3], JSON.stringify(output,null,2)+'\n');
    console.log(`Imported Gemini Decision 1; ${output.models.length} leaderboard entries.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
