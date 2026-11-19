// Maintainer-only timing against the frozen private benchmark. Never prints input data or credentials.
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadDataset, audioBytes} from '../server/dataset.mjs';
import {predictModel} from '../server/model.mjs';
import {normalizeEndpoint, PublicError} from '../server/security.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));

export function selectLatencySample(questions, count=500, seed='decide-community-latency-v1') {
  if(!Number.isInteger(count) || count<1 || count>questions.length) throw new Error('Invalid sample size');
  if(new Set(questions.map(q=>q.id)).size!==questions.length) throw new Error('Duplicate question IDs');
  // A common deterministic random sample for every model; never select by model predictions.
  return [...questions].sort((a,b)=>hash(seed+'\0'+a.id).localeCompare(hash(seed+'\0'+b.id))).slice(0,count);
}

export function latencySummary(config, rows, questions) {
  const selected=questions.map(q=>q.id);
  if(new Set(rows.map(row=>row.id)).size!==rows.length || rows.some(row=>!selected.includes(row.id))) throw new Error('Mismatched timing rows');
  const valid=rows.filter(row=>row.status==='ok');
  if(valid.some(row=>!Number.isFinite(row.latency_ms) || row.latency_ms<=0)) throw new Error('Invalid latency');
  const values=valid.map(row=>row.latency_ms).sort((a,b)=>a-b);
  const counts=key=>Object.fromEntries([...new Set(questions.map(q=>q[key]))].sort().map(value=>[value,questions.filter(q=>q[key]===value).length]));
  return {model_id:config.model,model_revision:config.model_revision,modality:config.modality,
    dataset_version:'1.0',dataset_questions:4867,selected_questions:selected.length,
    sample_seed:config.seed,sample_hash:hash(selected.join('\n')),bundle_sha256:config.bundle_sha256,
    valid_predictions:valid.length,failed_predictions:rows.length-valid.length,not_attempted:selected.length-rows.length,
    mean_latency_ms:values.length?values.reduce((sum,v)=>sum+v,0)/values.length:null,
    median_latency_ms:values.length?(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2:null,
    p95_latency_ms:values.length?values[Math.ceil(values.length*.95)-1]:null,
    timing_basis:'Client round trip including DNS, upload, response body and validation; excludes dataset/audio download, pauses, backoff and failed attempts.',
    publication_ready:selected.length===500 && valid.length===500,
    by_task:counts('task'),by_duration:counts('duration_bucket'),updated_at:new Date().toISOString()};
}

export async function measureQuestion({job,question,key,audio,requestId,retries=3,predict=predictModel,wait=sleep,clock=()=>performance.now()}) {
  const attempts=[];
  for(let attempt=0;attempt<=retries;attempt++) {
    const start=clock();
    try {
      const choice=await predict(job,question,key,audio,requestId);
      const latency_ms=clock()-start;
      attempts.push({latency_ms,status:'ok'});
      return {id:question.id,status:'ok',choice,latency_ms,attempts};
    } catch(error) {
      const latency_ms=clock()-start;
      const code=error instanceof PublicError?error.code:'client_request_failed';
      attempts.push({latency_ms,status:'error',code});
      if(error instanceof PublicError && error.retryAfter && attempt<retries) {
        await wait(Math.max(error.retryAfter,2**attempt)*1000);
        continue;
      }
      return {id:question.id,status:'error',code,latency_ms:null,attempts};
    }
  }
}

async function run(args) {
  const allowed=new Set(['model','endpoint','api-key-env','modality','output','limit','seed','pause','retries','model-revision']);
  const opts={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i]?.replace(/^--/,'');
    if(!args[i]?.startsWith('--') || !allowed.has(key) || args[i+1]===undefined || Object.hasOwn(opts,key)) throw new Error('Use --model ID --endpoint HTTPS_URL --output private/PATH [--api-key-env ENV_NAME] [--limit 500]');
    opts[key]=args[i+1];
  }
  const model=opts.model, endpoint=normalizeEndpoint(opts.endpoint), modality=opts.modality || 'audio';
  const count=Number(opts.limit || 500), pause=Number(opts.pause ?? 1), retries=Number(opts.retries ?? 3);
  if(!model || !['audio','text'].includes(modality) || !Number.isInteger(count) || count<1 || count>4867
      || !Number.isFinite(pause) || pause<0 || !Number.isInteger(retries) || retries<0 || retries>5) throw new Error('Invalid run settings');
  if(opts['api-key-env'] && !/^[A-Z_][A-Z0-9_]*$/.test(opts['api-key-env'])) throw new Error('Invalid API-key environment variable name');
  const key=opts['api-key-env']?process.env[opts['api-key-env']]:'';
  if(opts['api-key-env'] && !key) throw new Error('The specified API-key environment variable is missing');
  const privateRoot=resolve(fileURLToPath(new URL('../private/',import.meta.url)));
  const directory=resolve(opts.output || '');
  if(!opts.output || !directory.startsWith(privateRoot+'/')) throw new Error('Timing output must be inside the gitignored private/ directory');
  const job={model,endpoint,modality};
  // One public warm-up verifies access and the response contract before sending private inputs.
  const warmup=(await loadDataset('preview')).questions[0];
  const warmAudio=modality==='audio'?await audioBytes(warmup,'preview'):null;
  const preflight=await measureQuestion({job,question:warmup,key,audio:warmAudio,requestId:'latency-preflight-'+randomUUID(),retries});
  if(preflight.status!=='ok') throw new PublicError(preflight.code,422);
  const dataset=await loadDataset('benchmark');
  const questions=selectLatencySample(dataset.questions,count,opts.seed);
  const settings={model,endpoint,modality,seed:opts.seed || 'decide-community-latency-v1',count,
    pause,retries,model_revision:opts['model-revision'] || null,bundle_sha256:process.env.DECIDE_BUNDLE_SHA256,
    sample_hash:hash(questions.map(q=>q.id).join('\n'))};
  await mkdir(directory,{recursive:true,mode:0o700});
  let config,rows=[];
  try {
    config=JSON.parse(await readFile(directory+'/config.json','utf8'));
    if(JSON.stringify(config.settings)!==JSON.stringify(settings)) throw new Error('Output belongs to a different run; use a new --output');
    rows=JSON.parse(await readFile(directory+'/timings.json','utf8'));
    latencySummary({...settings},rows,questions);
  } catch(error) {
    if(error.code!=='ENOENT') throw error;
    config={settings,run_id:randomUUID()};
    await writeFile(directory+'/config.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});
  }
  const done=new Set(rows.filter(row=>row.status==='ok').map(row=>row.id));
  let failures=0;
  for(const question of questions) {
    if(done.has(question.id)) continue;
    const audio=modality==='audio'?await audioBytes(question,'benchmark'):null;
    const row=await measureQuestion({job,question,key,audio,requestId:hash(config.run_id+':'+question.id+':'+randomUUID()),retries});
    rows=rows.filter(existing=>existing.id!==question.id);rows.push(row);
    const summary=latencySummary(settings,rows,questions);
    await writeFile(directory+'/timings.json',JSON.stringify(rows,null,2)+'\n',{mode:0o600});
    await writeFile(directory+'/summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({completed:rows.length,selected:questions.length,valid:summary.valid_predictions,status:row.status,latency_ms:row.latency_ms,error:row.code || null}));
    failures=row.status==='error'?failures+1:0;
    if(row.code==='model_authentication_or_configuration_failed' || failures>=5) throw new Error('Stopped after endpoint errors; restore API access and rerun the same command');
    await sleep(pause*1000);
  }
  console.log(JSON.stringify(latencySummary(settings,rows,questions),null,2));
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {await run(process.argv.slice(2));}
  catch(error) {
    // No raw network/database errors: they may include credential-bearing URLs.
    console.error(error instanceof PublicError?`Timing error: ${error.code}`:
      error.code==='ENOENT'?'Timing error: required file unavailable':
      ['Error'].includes(error.name)&&!/[\r\n]|https?:\/\//.test(error.message)?error.message:'Timing error: check endpoint and private configuration');
    process.exitCode=1;
  }
}
