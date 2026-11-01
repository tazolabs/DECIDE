import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { PublicError } from './security.mjs';

const defaults = {
  network_benchmark: 2, network_preview: 8,
  credential_benchmark: 2, credential_preview: 8,
  global_benchmark: 8, global_preview: 40, active: 4,
};

export function admissionLimits(env = process.env) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = Number(env[`DECIDE_LIMIT_${key.toUpperCase()}`] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > 10000) throw new PublicError('service_not_configured', 503);
    return [key, value];
  }));
}

export function admissionIdentity(request, body, now = new Date()) {
  const secret = process.env.DECIDE_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw new PublicError('service_not_configured', 503);
  // Vercel overwrites this platform header. Never accept an identity from JSON or a cookie.
  const source = request.headers.get('x-vercel-forwarded-for');
  let address;
  try { address = ipaddr.process(source); } catch { throw new PublicError('client_address_unavailable', 503); }
  const bytes = address.toByteArray();
  // Treat an IPv6 /64 as one network to avoid trivial per-address quota evasion.
  const network = address.kind() === 'ipv6' ? Buffer.from(bytes.slice(0, 8)).toString('hex') + '/64' : address.toString();
  const day = now.toISOString().slice(0, 10);
  const hash = (scope, value) => createHmac('sha256', Buffer.from(secret, 'hex')).update(`${day}:${scope}:${value}`).digest('hex');
  return {
    network: hash('network', network),
    credential: hash('credential', `${new URL(body.endpoint).origin}\0${body.api_key}`),
    retryAfter: Math.ceil((Date.parse(day + 'T00:00:00Z') + 86400000 - now.getTime()) / 1000),
  };
}
