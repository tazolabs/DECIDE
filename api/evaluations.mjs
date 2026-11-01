import { randomUUID } from 'node:crypto';
import { db, findInvitation, getJob, publicJob } from '../server/database.mjs';
import { emptyMetrics } from '../server/metrics.mjs';
import { enqueue } from '../server/worker.mjs';
import { authorizeResult, encryptSecret, endpointDispatcher, errorResponse, PublicError,
  resultToken, safeResponse, sha256, validateSubmission } from '../server/security.mjs';

async function submit(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new PublicError('json_required', 415);
  const text = await request.text();
  if (Buffer.byteLength(text) > 12000) throw new PublicError('submission_too_large', 413);
  let body;
  try { body = validateSubmission(JSON.parse(text)); } catch (error) {
    throw error instanceof PublicError ? error : new PublicError('invalid_json');
  }
  const hash = sha256(body.invitation_token);
  const invitation = await findInvitation(hash);
  if (invitation.endpoint !== body.endpoint) throw new PublicError('endpoint_not_approved_for_invitation', 403);
  const dispatcher = await endpointDispatcher(body.endpoint);
  await dispatcher.close();
  const id = randomUUID();
  const total = Math.min(body.mode === 'preview' ? 6 : 4867, invitation.max_questions || 4867);
  const ciphertext = encryptSecret(body.api_key, id);
  const submissionHash = sha256(JSON.stringify({ endpoint: body.endpoint, model: body.model, modality: body.modality,
    mode: body.mode, api_key_hash: sha256(body.api_key) }));
  let jobId;
  try {
    const rows = await db()`SELECT decide_create_job(${id}::uuid,${hash},${body.idempotency_key},${submissionHash},
      ${body.model},${body.endpoint},${body.modality},${body.mode},${ciphertext},${total},${JSON.stringify(emptyMetrics())}::jsonb) AS id`;
    jobId = rows[0].id;
  } catch (error) {
    const known = ['invalid_invitation', 'idempotency_conflict', 'invitation_quota_exhausted', 'evaluation_capacity_reached'];
    const code = known.find((value) => error.message?.includes(value));
    throw new PublicError(code || 'submission_unavailable', code?.includes('quota') || code?.includes('capacity') ? 429 : 409);
  }
  const job = await getJob(jobId);
  if (['queued', 'running'].includes(job.status)) {
    try { await enqueue(jobId, job.cursor); }
    catch { throw new PublicError('queue_temporarily_unavailable_retry_same_submission', 503); }
  }
  return safeResponse({ ...(await publicJob(jobId)), result_token: resultToken(jobId) }, 202);
}

export default { async fetch(request) {
  try {
    const origin = request.headers.get('origin');
    const allowed = new Set(['https://decide-benchmark.vercel.app', process.env.DECIDE_PUBLIC_ORIGIN].filter(Boolean));
    if (origin && !allowed.has(origin)) throw new PublicError('origin_not_allowed', 403);
    if (request.method === 'POST') return await submit(request);
    if (!['GET', 'DELETE'].includes(request.method)) throw new PublicError('method_not_allowed', 405);
    const id = new URL(request.url).searchParams.get('id') || '';
    authorizeResult(request, id);
    if (request.method === 'DELETE') {
      await db()`UPDATE decide_jobs SET status='cancelled', api_key_ciphertext=NULL, lease_token=NULL,
        lease_until=NULL, updated_at=now() WHERE id=${id}::uuid AND status IN ('queued','running')`;
    }
    return safeResponse(await publicJob(id));
  } catch (error) { return errorResponse(error); }
} };
