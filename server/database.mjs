import { neon } from '@neondatabase/serverless';
import { PublicError } from './security.mjs';

let client;
export function db() {
  if (!process.env.DATABASE_URL) throw new PublicError('service_not_configured', 503);
  return client ||= neon(process.env.DATABASE_URL);
}

export async function getJob(id) {
  const rows = await db()`SELECT * FROM decide_jobs WHERE id=${id}::uuid`;
  return rows[0];
}

export async function failJob(id, code) {
  await db()`UPDATE decide_jobs SET status='failed', error_code=${code}, api_key_ciphertext=NULL,
    lease_token=NULL, lease_until=NULL, updated_at=now()
    WHERE id=${id}::uuid AND status IN ('queued','running')`;
}

export async function publicJob(id) {
  const rows = await db()`SELECT id, model, modality, mode, status, cursor, total, error_code,
    created_at, updated_at, report, preflight_passed FROM decide_jobs WHERE id=${id}::uuid`;
  if (!rows.length) throw new PublicError('evaluation_not_found', 404);
  const row = rows[0];
  return { id: row.id, model: row.model, modality: row.modality, mode: row.mode,
    status: row.status, progress: { completed: row.cursor, total: row.total },
    stage: ['queued', 'running'].includes(row.status) ? row.mode === 'benchmark' && !row.preflight_passed ? 'validating_endpoint' : 'evaluating' : row.status,
    error: row.error_code, created_at: row.created_at, updated_at: row.updated_at,
    report: row.status === 'completed' ? row.report : null };
}
