import { endpointDispatcher, PublicError, readLimited } from './security.mjs';
import { validateAnswer } from './metrics.mjs';

export function retryDelay(value) {
  const seconds = Number(value);
  if (value !== null && Number.isFinite(seconds)) return Math.max(1, Math.min(300, seconds));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1, Math.min(300, (date - Date.now()) / 1000)) : 5;
}

export async function predictModel(job, question, key, audio, idempotencyKey, fetcher = fetch, connect = endpointDispatcher) {
  const dispatcher = await connect(job.endpoint);
  try {
    const request = { ...structuredClone(question[`${job.modality}_request`]), model: job.model };
    const headers = { Accept: 'application/json', 'Idempotency-Key': idempotencyKey };
    if (key) headers.Authorization = `Bearer ${key}`;
    let body;
    if (job.modality === 'audio') {
      body = new FormData();
      body.set('request', JSON.stringify(request));
      body.set('audio', new Blob([audio], { type: 'audio/wav' }), 'clip.wav');
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(request);
    }
    let response;
    try {
      response = await fetcher(job.endpoint, { method: 'POST', headers, body, dispatcher,
        redirect: 'error', signal: AbortSignal.timeout(45000) });
    } catch { throw new PublicError('model_endpoint_unreachable', 502, 5); }
    if ([401, 402, 403, 404].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      throw new PublicError('model_authentication_or_configuration_failed', 422);
    }
    if ([408, 429, 500, 502, 503, 504, 529].includes(response.status)) {
      const delay = retryDelay(response.headers.get('Retry-After'));
      await response.body?.cancel().catch(() => {});
      throw new PublicError('model_temporarily_unavailable', 502, delay);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new PublicError('model_request_rejected', 422);
    }
    const bytes = await readLimited(response, 512 * 1024);
    let payload;
    try { payload = JSON.parse(bytes); } catch { throw new PublicError('invalid_model_response'); }
    return validateAnswer(payload, request.questions.action.criteria, job.model);
  } finally {
    await dispatcher.close();
  }
}
