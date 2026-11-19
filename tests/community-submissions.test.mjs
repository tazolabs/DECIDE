import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importHostedSubmissions} from '../tools/import-hosted-submissions.mjs';
import {latencySummary,measureQuestion,selectLatencySample} from '../tools/measure-submission-latency.mjs';
import {frontierPoints,hasCompleteMeasurements,sortModels,validateLeaderboard} from '../site/leaderboard-model.js';
import {PublicError} from '../server/security.mjs';

const snapshot=JSON.parse(await readFile(new URL('../site/data/leaderboard.json',import.meta.url),'utf8'));

test('hosted accuracy includes every failed answer in the 4,867-question denominator',()=>{
  const spev=snapshot.models.find(m=>m.id==='spev');
  assert.equal(spev.correct,3458);
  assert.equal(spev.accuracy,3458/4867);
  assert.equal(spev.submission.failed_or_missing,4);
  assert.notEqual(spev.accuracy,3458/4863);
  assert.equal(spev.cost_usd,1.5);
  assert.equal(spev.measurements.cost.status,'submitter-estimate');
});

test('unknown measurements do not become zero, a DBS score or a frontier point',()=>{
  const pending=snapshot.models.filter(m=>!hasCompleteMeasurements(m));
  assert.equal(pending.length,4);
  const ranked=sortModels(snapshot.models);
  assert(ranked.slice(-4).every(m=>m.dbs===null));
  const accuracy=sortModels(snapshot.models,'accuracy');
  assert(accuracy.findIndex(m=>m.id==='nirnaya-turbo-1-0') < accuracy.findIndex(m=>m.id==='tazo'));
  assert(frontierPoints(snapshot.models,snapshot.reference).every(p=>!pending.some(m=>m.id===p.id)));
  const invalid=structuredClone(snapshot);
  invalid.models.find(m=>m.id==='spev').cost_usd=0;
  assert.throws(()=>validateLeaderboard(invalid));
  const missing=structuredClone(snapshot);
  delete missing.models.find(m=>m.id==='spev').measurements.latency;
  assert.throws(()=>validateLeaderboard(missing));
});

test('import rejects partial runs and preserves all-question accuracy without exporting inputs',()=>{
  const familyNames={voice:'Voice properties',business:'Business and conversation',tools:'Tool decisions',routing:'Graph routing',turns:'Turn taking'};
  const job={id:'test-id',model:'test-model',mode:'benchmark',status:'completed',total:4867,cursor:4867,modality:'audio',
    endpoint:'never-export-endpoint',api_key_ciphertext:'never-export-key',
    report:{scope:'full_benchmark',overall:{questions:4867,correct:10,accuracy:10/4867,valid_predictions:4863,missing_or_failed:4},
      by_family:Object.fromEntries(snapshot.families.map(f=>[familyNames[f.id],{questions:f.questions,correct:0}]))}};
  const entry={id:'test-community',model_id:'test-model',name:'Test community',evaluation_id:'test-id',
    cost:{status:'pending',api_key:'never-export-metadata-key'},latency:{status:'pending'}};
  const result=importHostedSubmissions(snapshot,[job],{checked_at:'2026-11-20',entries:[entry]});
  const model=result.models.at(-1);
  assert.equal(model.accuracy,10/4867);
  assert(!JSON.stringify(result).includes('never-export'));
  assert.equal(model.dbs,null);
  assert.equal(importHostedSubmissions(result,[job],{entries:[entry]}).models.length,result.models.length);
  assert.throws(()=>importHostedSubmissions(snapshot,[{...job,cursor:4866}],{entries:[entry]}));
  assert.throws(()=>importHostedSubmissions(snapshot,[{...job,status:'failed'}],{entries:[entry]}));
  assert.throws(()=>importHostedSubmissions(snapshot,[job],{entries:[{...entry,latency:{status:'measured',value_ms:100,sample_n:499}}]}));
});

test('the common timing sample is deterministic and never selected using model outcomes',()=>{
  const questions=Array.from({length:600},(_,i)=>({id:'q'+i,task:'task'+i%4,duration_bucket:'bucket'+i%5}));
  const first=selectLatencySample(questions);
  assert.equal(first.length,500);
  assert.equal(new Set(first.map(q=>q.id)).size,500);
  assert.deepEqual(first.map(q=>q.id),selectLatencySample([...questions].reverse()).map(q=>q.id));
  assert.notDeepEqual(first.map(q=>q.id),selectLatencySample(questions,500,'other-seed').map(q=>q.id));
  assert.throws(()=>selectLatencySample(questions,601));
});

test('timings exclude retry sleeps and keep failures separate from successful client round trips',async()=>{
  let calls=0,clockValue=0;const waits=[];
  const row=await measureQuestion({job:{},question:{id:'one'},key:'test-key',audio:null,requestId:'opaque',
    predict:async()=>{calls++;clockValue+=100;if(calls===1)throw new PublicError('rate_limited',429,2);return 'a';},
    wait:async ms=>{waits.push(ms);clockValue+=ms;},clock:()=>clockValue});
  assert.equal(row.latency_ms,100);
  assert.equal(row.attempts.length,2);
  assert.deepEqual(waits,[2000]);
  const error=await measureQuestion({job:{},question:{id:'two'},key:'test-key',audio:null,requestId:'opaque',
    predict:async()=>{throw new PublicError('model_authentication_or_configuration_failed',422);},clock:()=>++clockValue});
  assert.equal(error.status,'error');
  assert.equal(error.latency_ms,null);
  const summary=latencySummary({model:'test',seed:'test'},[row,error],[{id:'one',task:'a',duration_bucket:'b'},{id:'two',task:'a',duration_bucket:'b'}]);
  assert.equal(summary.mean_latency_ms,100);
  assert.equal(summary.failed_predictions,1);
  assert.equal(summary.publication_ready,false);
});
