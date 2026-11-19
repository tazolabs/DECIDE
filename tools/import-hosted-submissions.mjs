// Maintainer-only import: publish aggregate fields, never endpoints, keys or benchmark rows.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decisionBalanceScore, hasCompleteMeasurements, validateLeaderboard} from '../site/leaderboard-model.js';

const FAMILIES = {voice:'Voice properties',business:'Business and conversation',tools:'Tool decisions',routing:'Graph routing',turns:'Turn taking'};

function publicMeasurement(value,kind) {
  const keys=kind==='cost'?['status','reason','value_usd','source_url','basis','rate_source_url','hourly_rate_usd','gpu_count','hardware','hardware_source_url','assumptions','run_hours']:['status','value_ms','basis','started_at','completed_at','completion_source','elapsed_ms','questions'];
  const output=Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  if(kind==='cost' && value.rates) output.rates=Object.fromEntries(
    ['audio_input_usd_per_million_tokens','text_input_usd_per_million_tokens','output_usd'].filter(key=>Object.hasOwn(value.rates,key)).map(key=>[key,value.rates[key]]));
  return output;
}

export function hostedRunTiming(job) {
  if(job.status!=='completed' || job.mode!=='benchmark' || job.total!==4867 || job.cursor!==4867) throw new Error('Expected a completed 4,867-question run');
  const start=job.created_at;
  const end=job.report?.completed_at || job.updated_at;
  const epoch=value=>{
    if((typeof value!=='string' && !(value instanceof Date)) || !Number.isFinite(new Date(value).getTime())) throw new Error('Invalid run timestamp');
    return new Date(value).getTime();
  };
  const elapsed=epoch(end)-epoch(start);
  if(elapsed<=0) throw new Error('Run duration must be positive');
  return {status:'run-time-estimate',value_ms:elapsed/job.total,elapsed_ms:elapsed,questions:job.total,
    started_at:new Date(start).toISOString(),completed_at:new Date(end).toISOString(),
    completion_source:job.report?.completed_at?'report.completed_at':'updated_at',
    basis:'Total elapsed run time divided by all 4,867 questions; includes queueing, pauses, retries and database work.'};
}

export function hostedRunCost(cost,timing) {
  if(cost.status==='pending') return null;
  if(cost.status==='gpu-runtime-estimate') {
    if(!Number.isFinite(cost.hourly_rate_usd) || cost.hourly_rate_usd<=0 || !Number.isInteger(cost.gpu_count) || cost.gpu_count<1) throw new Error('Invalid GPU reference rate');
    const run_hours=timing.elapsed_ms/3600000;
    return {...publicMeasurement(cost,'cost'),run_hours,value_usd:run_hours*cost.hourly_rate_usd*cost.gpu_count};
  }
  if(cost.status!=='submitter-estimate' || !Number.isFinite(cost.value_usd) || cost.value_usd<=0) throw new Error('Invalid cost estimate');
  return publicMeasurement(cost,'cost');
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
    const timing=hostedRunTiming(job);
    const cost=hostedRunCost(entry.cost,timing);
    if(!cost) continue; // Publish only entries with both supported latency and cost estimates.
    const model = {
      id:entry.id, name:entry.name, input:job.modality === 'audio' ? 'audio' : 'stt-text',
      correct:overall.correct, accuracy:overall.correct / output.questions,
      cost_usd:cost.value_usd,
      latency_ms:timing.value_ms,
      latency_basis:'run-elapsed-per-question', dbs:null,
      families:Object.fromEntries(output.families.map(family => {
        const metric = report.by_family[FAMILIES[family.id]];
        if (metric?.questions !== family.questions || !Number.isInteger(metric.correct)) throw new Error('Mismatched task-family totals');
        return [family.id,{correct:metric.correct,accuracy:metric.correct / family.questions}];
      })),
      submission:{evaluation_id:job.id,completed_at:report.completed_at || job.updated_at,
        failed_or_missing:overall.missing_or_failed,checked_at:metadata.checked_at},
      measurements:{cost,latency:publicMeasurement(timing,'latency')},
    };
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
    console.log(`Processed ${metadata.entries.length} hosted submissions; ${output.models.length} eligible leaderboard entries.`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
