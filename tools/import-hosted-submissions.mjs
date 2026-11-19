// Maintainer-only import: publish aggregate fields, never endpoints, keys or benchmark rows.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decisionBalanceScore, hasCompleteMeasurements, validateLeaderboard} from '../site/leaderboard-model.js';

const FAMILIES = {voice:'Voice properties',business:'Business and conversation',tools:'Tool decisions',routing:'Graph routing',turns:'Turn taking'};

function publicMeasurement(value,kind) {
  const keys=kind==='cost'?['status','reason','value_usd','source_url','basis','rate_source_url']:['status','reason','value_ms','sample_n','source_url','basis'];
  const output=Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  if(kind==='latency' && value.reported) output.reported=Object.fromEntries(
    ['value_ms','statistic','scope','source_url'].filter(key=>Object.hasOwn(value.reported,key)).map(key=>[key,value.reported[key]]));
  if(kind==='cost' && value.rates) output.rates=Object.fromEntries(
    ['audio_input_usd_per_million_tokens','text_input_usd_per_million_tokens','output_usd'].filter(key=>Object.hasOwn(value.rates,key)).map(key=>[key,value.rates[key]]));
  return output;
}

export function importHostedSubmissions(snapshot, jobs, metadata) {
  const output = structuredClone(snapshot);
  const entries = metadata.entries;
  if (!Array.isArray(entries) || !entries.length || new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Invalid submission metadata');
  output.models = output.models.filter(model => !entries.some(entry => entry.id === model.id));
  for (const entry of entries) {
    const job = jobs.find(job => job.id === entry.evaluation_id);
    const report = job?.report;
    const overall = report?.overall;
    if (!job || job.model !== entry.model_id || job.status !== 'completed' || job.mode !== 'benchmark'
        || job.total !== output.questions || job.cursor !== output.questions || report.scope !== 'full_benchmark'
        || !['audio','text'].includes(job.modality) || overall.correct > overall.valid_predictions
        || overall?.questions !== output.questions || overall.accuracy !== overall.correct / output.questions
        || overall.valid_predictions + overall.missing_or_failed !== output.questions) throw new Error(`Incomplete or inconsistent submission: ${entry.id}`);
    const model = {
      id:entry.id, name:entry.name, input:job.modality === 'audio' ? 'audio' : 'stt-text',
      correct:overall.correct, accuracy:overall.correct / output.questions,
      cost_usd:entry.cost.status === 'pending' ? null : entry.cost.value_usd,
      latency_ms:entry.latency.status === 'measured' ? entry.latency.value_ms : null,
      latency_basis:entry.latency.status === 'measured' ? 'client-500' : 'pending', dbs:null,
      families:Object.fromEntries(output.families.map(family => {
        const metric = report.by_family[FAMILIES[family.id]];
        if (metric?.questions !== family.questions || !Number.isInteger(metric.correct)) throw new Error('Mismatched task-family totals');
        return [family.id,{correct:metric.correct,accuracy:metric.correct / family.questions}];
      })),
      submission:{evaluation_id:job.id,completed_at:report.completed_at || job.updated_at,
        failed_or_missing:overall.missing_or_failed,checked_at:metadata.checked_at},
      measurements:{cost:publicMeasurement(entry.cost,'cost'),latency:publicMeasurement(entry.latency,'latency')},
    };
    if(entry.latency.status === 'measured' && entry.latency.sample_n !== 500) throw new Error('Publish mean latency only after 500 valid timed predictions');
    if (entry.company) model.company = entry.company;
    if (entry.source_url) model.submission.source_url = entry.source_url;
    if (hasCompleteMeasurements(model)) model.dbs = decisionBalanceScore(model,output.reference);
    output.models.push(model);
  }
  return validateLeaderboard(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if(args.length!==6 || args[0]!=='--jobs' || args[2]!=='--metadata' || args[4]!=='--snapshot') throw new Error('Usage: node tools/import-hosted-submissions.mjs --jobs private/jobs.json --metadata docs/community-submissions.json --snapshot site/data/leaderboard.json');
    const [jobs,metadata,snapshot]=await Promise.all([args[1],args[3],args[5]].map(async path => JSON.parse(await readFile(path,'utf8'))));
    const output=importHostedSubmissions(snapshot,jobs,metadata);
    await writeFile(args[5],JSON.stringify(output,null,2)+'\n');
    console.log(`Imported ${metadata.entries.length} hosted submissions; ${output.models.length} leaderboard entries.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
