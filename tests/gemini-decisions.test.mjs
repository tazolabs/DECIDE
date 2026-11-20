import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importGeminiDecisions} from '../tools/import-gemini-decisions.mjs';
import {decisionBalanceScore} from '../site/leaderboard-model.js';

const snapshot=JSON.parse(await readFile(new URL('../site/data/leaderboard.json',import.meta.url),'utf8'));
const fingerprint='e55f07455b7b218f37c7f156836b6568e88d77bfa50033199e97f368d47db187';
const names={voice:'Voice properties',business:'Business and conversation',tools:'Tool decisions',routing:'Graph routing',turns:'Turn taking'};

test('the published Gemini result uses measured full-run accuracy, token cost and HTTP latency',()=>{
  const model=snapshot.models.find(item=>item.id==='gemini-decision-1');
  assert.equal(model.correct,3483);
  assert.equal(model.accuracy,3483/4867);
  assert(Math.abs(model.cost_usd-12138589*.1/1e6)<1e-12);
  assert.equal(model.latency_ms,891.5044818734311);
  assert.equal(model.measurements.latency.n,4867);
  assert.equal(model.evaluation.failed_or_missing,0);
  assert.equal(model.families.voice.correct,1454);
});

function report() {
  const original=snapshot.models.find(model=>model.id==='tazo');
  return {
    model:'gemini-decision-1',adapter_version:'decide-google-native-decisions-audio-v1',
    dataset_fingerprint:fingerprint,selected_questions:4867,completed_questions:4867,updated_at:'2026-11-20T14:00:00Z',
    metrics:{dataset_fingerprint:fingerprint,
      overall:{selected:4867,scored:4866,errors_or_not_attempted:1,correct:original.correct,exact_accuracy:original.correct/4867},
      by_family:{...Object.fromEntries(snapshot.families.map(f=>[names[f.id],{selected:f.questions,
        correct:original.families[f.id].correct,exact_accuracy:original.families[f.id].accuracy}])),
        'Language switching':{selected:4867-snapshot.families.reduce((sum,f)=>sum+f.questions,0),
          correct:original.correct-Object.values(original.families).reduce((sum,f)=>sum+f.correct,0)}}},
    cost:{estimated_run_cost_usd:1.1,total_input_tokens:11000000,input_tokens_by_modality:{text:10000000,audio:1000000},
      input_usd_per_million_tokens:.1,unpriced_http_200_responses:0,priced_responses:4867,http_attempts:4868,basis:'test input token usage'},
    latency:{n:4866,mean_request_ms:800,median_request_ms:750,p95_request_ms:1000,basis:'test HTTP request timing'},
    private_prompts:'do-not-export',api_key:'do-not-export',predictions:['do-not-export'],
  };
}

test('Gemini import publishes only reconciled aggregates, preserving fixed DBS references and failed-answer denominator',()=>{
  const before=JSON.stringify(snapshot);
  const source=report();
  const result=importGeminiDecisions(snapshot,source);
  const model=result.models.find(m=>m.id==='gemini-decision-1');
  assert.equal(model.name,'Gemini Decision 1');
  assert.equal(model.accuracy,source.metrics.overall.correct/4867);
  assert.equal(model.evaluation.failed_or_missing,1);
  assert.equal(model.cost_usd,1.1);
  assert.equal(model.latency_ms,800);
  assert.equal(model.measurements.cost.total_input_tokens,11000000);
  assert.equal(model.dbs,decisionBalanceScore(model,snapshot.reference));
  assert(!JSON.stringify(result).includes('do-not-export'));
  assert.equal(JSON.stringify(snapshot),before);
  assert.deepEqual(result.reference,snapshot.reference);
  assert.equal(result.models.find(m=>m.id==='tazo').latency_ms,474);
  assert.equal(importGeminiDecisions(result,source).models.length,result.models.length);
});

test('Gemini import refuses partial, mismatched or unpriced results',()=>{
  const cases=[
    value=>value.completed_questions--,
    value=>value.dataset_fingerprint='different',
    value=>value.metrics.overall.errors_or_not_attempted=-1,
    value=>value.cost.unpriced_http_200_responses=1,
    value=>value.cost.total_input_tokens++,
    value=>value.cost.estimated_run_cost_usd=2,
    value=>value.cost.input_tokens_by_modality={text:-1,audio:11000001},
    value=>value.cost.input_tokens_by_modality={image:11000000},
    value=>value.latency.n=1,
    value=>value.latency.mean_request_ms=0,
    value=>value.metrics.by_family[names.voice].correct++,
  ];
  for(const change of cases) {const source=report();change(source);assert.throws(()=>importGeminiDecisions(snapshot,source));}
});
