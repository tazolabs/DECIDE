import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hostedRunCost,hostedRunTiming,importHostedSubmissions} from '../tools/import-hosted-submissions.mjs';
import {decisionBalanceScore,frontierPoints,hasCompleteMeasurements,validateLeaderboard} from '../site/leaderboard-model.js';

const snapshot=JSON.parse(await readFile(new URL('../site/data/leaderboard.json',import.meta.url),'utf8'));

test('hosted accuracy includes failed answers in the full denominator',()=>{
  const spev=snapshot.models.find(m=>m.id==='spev');
  assert.equal(spev.correct,3458);
  assert.equal(spev.accuracy,3458/4867);
  assert.equal(spev.submission.failed_or_missing,4);
  assert.notEqual(spev.accuracy,3458/4863);
  assert(Math.abs(spev.cost_usd-3.90490184)<1e-10);
  assert.equal(spev.measurements.cost.status,'token-usage-estimate');
});

test('every published entry has a cost, latency and score, including the Laya reference estimate',()=>{
  assert.equal(snapshot.models.length,25);
  assert(snapshot.models.every(hasCompleteMeasurements));
  const laya=snapshot.models.find(m=>m.id==='laya-embeddinglabs');
  assert.equal(laya.cost_usd,11330687/3600000*1.99);
  assert.equal(laya.latency_ms,11330687/4867);
  assert(laya.measurements.cost.assumptions.some(s=>s.includes('actual hardware and API price are unspecified')));
  assert.equal(frontierPoints(snapshot.models,snapshot.reference).length,25);
  for(const model of snapshot.models) assert(Math.abs(model.dbs-decisionBalanceScore(model,snapshot.reference))<1e-8);
  for(const value of [0,null,NaN]) {
    const invalid=structuredClone(snapshot);
    invalid.models.find(m=>m.id==='spev').cost_usd=value;
    assert.throws(()=>validateLeaderboard(invalid));
  }
});

test('elapsed timing preserves database milliseconds and includes all 4,867 questions',()=>{
  const job={mode:'benchmark',status:'completed',total:4867,cursor:4867,
    created_at:'2026-11-10T18:00:41.142Z',report:{completed_at:'2026-11-10T20:03:15.523Z'}};
  const timing=hostedRunTiming(job);
  assert.equal(timing.elapsed_ms,7354381);
  assert.equal(timing.value_ms,7354381/4867);
  assert.deepEqual(hostedRunTiming({...job,created_at:new Date(job.created_at)}),timing);
  const fallback=hostedRunTiming({...job,report:{},updated_at:job.report.completed_at});
  assert.equal(fallback.elapsed_ms,timing.elapsed_ms);
  assert.equal(fallback.completion_source,'updated_at');
  assert.throws(()=>hostedRunTiming({...job,created_at:null}));
  assert.throws(()=>hostedRunTiming({...job,created_at:'2027-01-01T00:00:00Z'}));
  assert.throws(()=>hostedRunTiming({...job,cursor:4866}));
});

test('GPU cost uses the entire run window and a documented per-GPU hourly reference',()=>{
  const cost={status:'gpu-runtime-estimate',hourly_rate_usd:1.99,gpu_count:1,hardware:'H100 PCIe 80 GB'};
  assert.equal(hostedRunCost(cost,{elapsed_ms:7354381}).value_usd,7354381/3600000*1.99);
  assert.equal(hostedRunCost({...cost,gpu_count:2},{elapsed_ms:3600000}).value_usd,3.98);
  assert.equal(hostedRunCost({status:'pending'},{elapsed_ms:3600000}),null);
  assert.throws(()=>hostedRunCost({...cost,hourly_rate_usd:0},{elapsed_ms:3600000}));
  const turbo=snapshot.models.find(m=>m.id==='nirnaya-turbo-1-0');
  assert(turbo.measurements.cost.assumptions.some(text=>text.includes('not independently confirmed')));
  for(const model of snapshot.models.filter(m=>m.measurements?.cost?.status==='gpu-runtime-estimate')) {
    assert.equal(model.measurements.cost.hourly_rate_usd,1.99);
    assert.equal(model.measurements.cost.gpu_count,1);
    assert.equal(model.measurements.cost.hardware,'NVIDIA H100 PCIe 80 GB');
  }
  assert.equal(turbo.latency_basis,'run-elapsed-per-question');
});

test('SPEV estimate prices both audio and complete formatted text with explicit assumptions',()=>{
  const cost=snapshot.models.find(model=>model.id==='spev').measurements.cost;
  assert.equal(cost.audio_tokens_per_second,25);
  assert.equal(cost.text_input_tokens,12188426);
  assert.equal(cost.audio_input_tokens,56158.87*25);
  assert.equal(hostedRunCost(cost,{}).value_usd,(1403971.75*2+12188426*.09)/1e6);
  assert.throws(()=>hostedRunCost({...cost,audio_input_tokens:1},{}));
  assert(cost.assumptions.some(text=>text.includes('actual SPEV billing usage is unavailable')));
});

test('import computes estimates, skips unpriced runs, rejects partial runs and strips private fields',()=>{
  const names={voice:'Voice properties',business:'Business and conversation',tools:'Tool decisions',routing:'Graph routing',turns:'Turn taking'};
  const job={id:'test-id',model:'test-model',mode:'benchmark',status:'completed',total:4867,cursor:4867,modality:'audio',
    endpoint:'never-export-endpoint',api_key_ciphertext:'never-export-key',created_at:'2026-11-10T10:00:00.001Z',
    report:{scope:'full_benchmark',completed_at:'2026-11-10T12:00:00.123Z',
      overall:{questions:4867,correct:10,accuracy:10/4867,valid_predictions:4863,missing_or_failed:4},
      by_family:Object.fromEntries(snapshot.families.map(f=>[names[f.id],{questions:f.questions,correct:0}]))}};
  const entry={id:'test-community',model_id:'test-model',name:'Test community',evaluation_id:'test-id',
    cost:{status:'gpu-runtime-estimate',hourly_rate_usd:1.99,gpu_count:1,api_key:'never-export-metadata-key'}};
  const result=importHostedSubmissions(snapshot,[job],{checked_at:'2026-11-20',entries:[entry]});
  const model=result.models.at(-1);
  assert.equal(model.accuracy,10/4867);
  assert.equal(model.latency_ms,7200122/4867);
  assert.equal(model.cost_usd,7200122/3600000*1.99);
  assert(!JSON.stringify(result).includes('never-export'));
  assert(Number.isFinite(model.dbs));
  assert.equal(importHostedSubmissions(result,[job],{entries:[entry]}).models.length,result.models.length);
  assert.equal(importHostedSubmissions(result,[job],{entries:[{...entry,cost:{status:'pending'}}]}).models.length,snapshot.models.length);
  assert.throws(()=>importHostedSubmissions(snapshot,[{...job,cursor:4866}],{entries:[entry]}));
  assert.throws(()=>importHostedSubmissions(snapshot,[{...job,status:'failed'}],{entries:[entry]}));
});
