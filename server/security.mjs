import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export class PublicError extends Error {
  constructor(code, status = 400, retryAfter = 0) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

function masterKey() {
  const value = process.env.DECIDE_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new PublicError('service_not_configured', 503);
  return Buffer.from(value, 'hex');
}

export function encryptSecret(value, jobId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(jobId));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptSecret(value, jobId) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', masterKey(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(jobId));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}

export function resultToken(jobId) {
  return createHmac('sha256', masterKey()).update(`decide-result:${jobId}`).digest('base64url');
}

export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function authorizeResult(request, jobId) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new PublicError('evaluation_not_found', 404);
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!constantEqual(supplied, resultToken(jobId))) throw new PublicError('evaluation_not_found', 404);
}

export function normalizeEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new PublicError('invalid_endpoint'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443') || url.hostname.endsWith('.') || url.hostname.length > 253 ||
      !url.hostname.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) {
    throw new PublicError('invalid_endpoint');
  }
  // No literal IP addresses, including IPv4-mapped IPv6 addresses.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) throw new PublicError('invalid_endpoint');
  return url.href;
}

export function publicAddress(value) {
  try {
    const address = ipaddr.process(value);
    return address.range() === 'unicast';
  } catch { return false; }
}

export async function endpointDispatcher(endpoint, resolver = lookup) {
  const url = new URL(normalizeEndpoint(endpoint));
  let addresses, timer;
  try { addresses = await Promise.race([
    resolver(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 10000); }),
  ]); }
  catch { throw new PublicError('endpoint_unreachable', 400); }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) {
    throw new PublicError('endpoint_must_be_public');
  }
  const chosen = addresses.find((a) => a.family === 4) || addresses[0];
  return new Agent({ connect: {
    // Pin the validated address for this connection to prevent DNS rebinding.
    lookup: (hostname, options, callback) => {
      if (hostname !== url.hostname) return callback(new Error('Host mismatch'));
      if (options.all) callback(null, [chosen]);
      else callback(null, chosen.address, chosen.family);
    },
    timeout: 15000,
  }});
}

export async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw new PublicError('response_too_large');
  const chunks = [];
  let size = 0;
  for await (const part of response.body || []) {
    size += part.length;
    if (size > limit) { await response.body.cancel().catch(() => {}); throw new PublicError('response_too_large'); }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError('invalid_submission');
  const allowed = new Set(['model', 'endpoint', 'modality', 'api_key', 'invitation_token', 'idempotency_key', 'mode']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new PublicError('invalid_submission_field');
  if (typeof body.model !== 'string' || !/^[\w .:/@+-]{1,120}$/.test(body.model)) throw new PublicError('invalid_model');
  if (!['audio', 'text'].includes(body.modality)) throw new PublicError('invalid_modality');
  if (typeof body.invitation_token !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(body.invitation_token)) throw new PublicError('invalid_invitation', 401);
  if (typeof body.idempotency_key !== 'string' || !/^[\w-]{16,80}$/.test(body.idempotency_key)) throw new PublicError('invalid_idempotency_key');
  if (body.api_key !== undefined && (typeof body.api_key !== 'string' || body.api_key.length > 4096 || /[\s\x00-\x1f]/.test(body.api_key))) throw new PublicError('invalid_api_key');
  const mode = body.mode || 'benchmark';
  if (!['benchmark', 'preview'].includes(mode)) throw new PublicError('invalid_mode');
  return { ...body, api_key: body.api_key || '', endpoint: normalizeEndpoint(body.endpoint), mode };
}

export function safeResponse(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store, private', 'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  }});
}

export function errorResponse(error) {
  // Never serialize an upstream error message/body: it can echo a key or private prompt.
  return safeResponse({ error: error instanceof PublicError ? error.code : 'service_unavailable' },
    error instanceof PublicError ? error.status : 503);
}
