import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PublicError, readLimited, sha256 } from './security.mjs';

let privateBundle, previewBundle;
const parseRows = (value) => value.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

function validateBundle(bundle, expected) {
  if (!Array.isArray(bundle.questions) || bundle.questions.length !== expected || !bundle.references) throw new PublicError('dataset_invalid', 503);
  const ids = new Set();
  for (const q of bundle.questions) {
    const ref = bundle.references[q.id];
    if (ids.has(q.id) || !ref || !Object.hasOwn(q.audio_request.questions.action.criteria, ref.label)) throw new PublicError('dataset_invalid', 503);
    if (!/^audio\/[A-Za-z0-9_-]+\.wav$/.test(q.audio) || !/^[a-f0-9]{64}$/.test(q.audio_sha256)) throw new PublicError('dataset_invalid', 503);
    ids.add(q.id);
  }
  return bundle;
}

export async function privateFile(path, limit) {
  const revision = process.env.DECIDE_DATASET_REVISION;
  const token = process.env.HF_TOKEN;
  if (!token || !/^[a-f0-9]{40}$/.test(revision || '')) throw new PublicError('private_dataset_not_configured', 503);
  // Repo and revision are operator configuration; participants cannot select private files.
  const url = `https://huggingface.co/datasets/tazolabs/DECIDE/resolve/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Storage request failed');
    return await readLimited(response, limit);
  } catch { throw new PublicError('private_dataset_unavailable', 503); }
}

export async function loadDataset(mode) {
  if (mode === 'preview') {
    if (!previewBundle) previewBundle = (async () => {
      const questions = parseRows(await readFile(new URL('../site/preview/questions.jsonl', import.meta.url), 'utf8'));
      const refs = parseRows(await readFile(new URL('../site/preview/answers.jsonl', import.meta.url), 'utf8'));
      return validateBundle({ version: '1.0-preview', questions, references: Object.fromEntries(refs.map((r) => [r.id, r])) }, 6);
    })().catch((error) => { previewBundle = undefined; throw error; });
    return previewBundle;
  }
  if (!privateBundle) privateBundle = (async () => {
    const bytes = await privateFile('hosted/decide-v1.json.gz', 20 * 1024 * 1024);
    if (sha256(bytes) !== process.env.DECIDE_BUNDLE_SHA256) throw new PublicError('dataset_integrity_error', 503);
    const bundle = JSON.parse(gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 }));
    if (bundle.version !== '1.0') throw new PublicError('dataset_version_error', 503);
    return validateBundle(bundle, 4867);
  })().catch((error) => { privateBundle = undefined; throw error; });
  return privateBundle;
}

export async function audioBytes(question, mode) {
  const bytes = mode === 'preview'
    ? await readFile(new URL(`../site/preview/${question.audio}`, import.meta.url))
    : await privateFile(question.audio, 2 * 1024 * 1024);
  if (sha256(bytes) !== question.audio_sha256) throw new PublicError('audio_integrity_error', 503);
  return bytes;
}
