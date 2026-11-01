import { randomUUID, createHmac } from 'node:crypto';
import { QueueClient } from '@vercel/queue';
import { db, failJob, getJob } from './database.mjs';
import { loadDataset, audioBytes } from './dataset.mjs';
import { predictModel } from './model.mjs';
import { decryptSecret, PublicError } from './security.mjs';
import { addOutcome, aggregateReport } from './metrics.mjs';
import { checkEndpoint } from './preflight.mjs';

export const queue = new QueueClient({ region: 'iad1' });
export const TOPIC = 'decide-evaluations';
export async function enqueue(id, cursor = 0, delay = 0) {
  // Only an opaque job ID enters queue payloads; no inputs, labels or API keys.
  await queue.send(TOPIC, { id }, { idempotencyKey: `${id}:${cursor}`,
    delaySeconds: Math.ceil(Math.max(0, delay)), retentionSeconds: 604800 });
}

async function claim(id) {
  const token = randomUUID();
  const rows = await db()`UPDATE decide_jobs SET status='running', lease_token=${token}::uuid,
    lease_until=now()+interval '280 seconds', updated_at=now()
    WHERE id=${id}::uuid AND status IN ('queued','running') AND (lease_until IS NULL OR lease_until<now())
    RETURNING *`;
  return rows[0];
}

export async function processEvaluation(message, metadata) {
  // Leave time for a 60s audio download, 10s DNS lookup, 45s model request and persistence.
  const latestQuestionStart = Date.now() + 150000;
  if (!message || !/^[a-f0-9-]{36}$/.test(message.id || '')) return;
  const id = message.id;
  const job = await claim(id);
  if (!job) {
    const current = await getJob(id);
    if (!current || !['queued', 'running'].includes(current.status)) return;
    throw new PublicError('evaluation_worker_busy', 503, 30);
  }
  try {
    if (job.not_before && new Date(job.not_before).getTime() > Date.now()) {
      throw new PublicError('evaluation_cooling_down', 503, Math.ceil((new Date(job.not_before).getTime() - Date.now()) / 1000));
    }
    const key = decryptSecret(job.api_key_ciphertext, id);
    if (job.mode === 'benchmark' && !job.preflight_passed) {
      const attempts = await db()`UPDATE decide_jobs SET preflight_attempts=preflight_attempts+1
        WHERE id=${id}::uuid AND status='running' AND lease_token=${job.lease_token}::uuid RETURNING preflight_attempts`;
      if (!attempts.length) return;
      try {
        const requestId = createHmac('sha256', process.env.DECIDE_ENCRYPTION_KEY).update(`${id}:preflight`).digest('hex');
        await checkEndpoint(job, key, requestId);
      } catch (error) {
        if (error instanceof PublicError && error.retryAfter && attempts[0].preflight_attempts < 4) {
          const delay = Math.min(300, Math.max(error.retryAfter, 2 ** attempts[0].preflight_attempts));
          await db()`UPDATE decide_jobs SET not_before=now()+(${delay}*interval '1 second')
            WHERE id=${id}::uuid AND lease_token=${job.lease_token}::uuid`;
          throw new PublicError('endpoint_preflight_retry_scheduled', 503, delay);
        }
        await failJob(id, error instanceof PublicError ? error.code : 'endpoint_preflight_failed');
        return;
      }
      const ready = await db()`UPDATE decide_jobs SET preflight_passed=true, not_before=NULL, updated_at=now()
        WHERE id=${id}::uuid AND status='running' AND lease_token=${job.lease_token}::uuid RETURNING id`;
      if (!ready.length) return;
    }
    const dataset = await loadDataset(job.mode);
    if (job.total > dataset.questions.length) throw new PublicError('dataset_invalid', 503);
    for (let count = 0; count < 3 && job.cursor < job.total && Date.now() < latestQuestionStart; count++) {
      // Check cancellation before sending each new private input to a provider.
      const active = await db()`SELECT status FROM decide_jobs WHERE id=${id}::uuid AND lease_token=${job.lease_token}::uuid`;
      if (active[0]?.status !== 'running') return;
      const question = dataset.questions[job.cursor];
      const criteria = question[`${job.modality}_request`].questions.action.criteria;
      const reference = dataset.references[question.id];
      if (!Object.hasOwn(criteria, reference.label)) throw new PublicError('dataset_invalid', 503);
      let choice = null;
      try {
        const attempt = await db()`UPDATE decide_jobs SET row_attempts=row_attempts+1
          WHERE id=${id}::uuid AND lease_token=${job.lease_token}::uuid AND cursor=${job.cursor} RETURNING row_attempts`;
        job.row_attempts = attempt[0]?.row_attempts || 4;
        const audio = job.modality === 'audio' ? await audioBytes(question, job.mode) : null;
        const continuing = await db()`SELECT status FROM decide_jobs WHERE id=${id}::uuid AND lease_token=${job.lease_token}::uuid`;
        if (continuing[0]?.status !== 'running') return;
        const requestId = createHmac('sha256', process.env.DECIDE_ENCRYPTION_KEY).update(`${id}:${job.cursor}`).digest('hex');
        choice = await predictModel(job, question, key, audio, requestId);
      } catch (error) {
        if (error instanceof PublicError && /integrity|dataset/.test(error.code)) throw error;
        if (error instanceof PublicError && error.code === 'model_authentication_or_configuration_failed') {
          await failJob(id, error.code);
          return;
        }
        if (error instanceof PublicError && error.retryAfter && job.row_attempts < 4) {
          const delay = Math.min(300, Math.max(error.retryAfter, 2 ** job.row_attempts));
          await db()`UPDATE decide_jobs SET not_before=now()+(${delay}*interval '1 second') WHERE id=${id}::uuid`;
          throw new PublicError('model_retry_scheduled', 503, delay);
        }
        // Store an unsuccessful outcome, never an upstream body or exception text.
        choice = null;
      }
      job.metrics = addOutcome(job.metrics, question, reference, choice);
      job.consecutive_failures = choice === null ? job.consecutive_failures + 1 : 0;
      const updated = await db()`UPDATE decide_jobs SET cursor=cursor+1, metrics=${JSON.stringify(job.metrics)}::jsonb,
        row_attempts=0, not_before=NULL, consecutive_failures=${job.consecutive_failures}, updated_at=now()
        WHERE id=${id}::uuid AND status='running' AND lease_token=${job.lease_token}::uuid AND cursor=${job.cursor} RETURNING cursor`;
      if (!updated.length) return;
      job.cursor++;
      if (job.consecutive_failures >= 5) {
        await failJob(id, 'repeated_invalid_or_failed_model_responses');
        return;
      }
      // One active worker per job. Keep the default provider rate at <=1 request/s.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (job.cursor >= job.total) {
      const report = aggregateReport(job.metrics, job.total, { version: dataset.version });
      report.scope = job.mode === 'preview' ? 'public_preview' : job.total === 4867 ? 'full_benchmark' : 'operator_smoke_test';
      report.model = job.model;
      report.modality = job.modality;
      report.evaluation_id = id;
      report.completed_at = new Date().toISOString();
      await db()`UPDATE decide_jobs SET status='completed', report=${JSON.stringify(report)}::jsonb,
        api_key_ciphertext=NULL, lease_token=NULL, lease_until=NULL, updated_at=now()
        WHERE id=${id}::uuid AND status='running' AND lease_token=${job.lease_token}::uuid`;
    } else {
      // Publish before acknowledgment. If interrupted, queue redelivery resumes the DB cursor.
      await db()`UPDATE decide_jobs SET lease_token=NULL, lease_until=NULL WHERE id=${id}::uuid AND lease_token=${job.lease_token}::uuid`;
      await enqueue(id, job.cursor);
    }
  } catch (error) {
    await db()`UPDATE decide_jobs SET lease_token=NULL, lease_until=NULL WHERE id=${id}::uuid AND lease_token=${job.lease_token}::uuid`;
    if (metadata.deliveryCount >= 12 || (error instanceof PublicError && /not_configured|dataset_invalid|integrity|version_error/.test(error.code))) {
      await failJob(id, error instanceof PublicError ? error.code : 'worker_retry_limit_reached');
      return;
    }
    throw new PublicError('evaluation_retry_scheduled', 503, error instanceof PublicError ? error.retryAfter || 30 : 30);
  }
}
