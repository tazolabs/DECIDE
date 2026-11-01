#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, publicJob } from '../server/database.mjs';
import { newToken, normalizeEndpoint, endpointDispatcher, resultToken, sha256 } from '../server/security.mjs';

const [command, ...args] = process.argv.slice(2);
const privateRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../private');
function privateOutput(path) {
  if (!path.startsWith(privateRoot + '/')) throw new Error('Write secrets under the repository ignored private/ directory');
  return path;
}
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
}

try {
  if (command === 'setup') {
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    const statements = schema.split(/(?=^CREATE (?:TABLE|INDEX|OR REPLACE FUNCTION))/m).map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) await db().query(statement, []);
    console.log('Hosted evaluator database schema ready.');
  } else if (command === 'invite') {
    const endpoint = normalizeEndpoint(option('endpoint', ''));
    const agent = await endpointDispatcher(endpoint);
    await agent.close();
    const label = option('name', 'evaluator');
    const runs = Number(option('max-runs', '2'));
    const days = Number(option('days', '7'));
    const maxQuestions = option('max-questions') ? Number(option('max-questions')) : null;
    if (!/^[\w -]{1,80}$/.test(label) || !Number.isInteger(runs) || runs < 1 || runs > 10 ||
        !Number.isInteger(days) || days < 1 || days > 30 ||
        (maxQuestions !== null && (!Number.isInteger(maxQuestions) || maxQuestions < 1 || maxQuestions > 4867))) {
      throw new Error('Invalid invitation settings');
    }
    const path = privateOutput(resolve(option('output', `private/invitations/${label.replaceAll(' ', '-')}.json`)));
    const token = newToken();
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    await db()`INSERT INTO decide_invitations(token_hash,label,endpoint,max_runs,max_questions,expires_at)
      VALUES(${sha256(token)},${label},${endpoint},${runs},${maxQuestions},${expires}::timestamptz)`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ invitation_token: token, endpoint, max_runs: runs,
      expires_at: expires, max_questions: maxQuestions, service: 'https://decide-benchmark.vercel.app' }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Invitation saved to ${path}. Share it privately with the participant.`);
  } else if (command === 'status') {
    console.log(JSON.stringify(await publicJob(option('id')), null, 2));
  } else if (command === 'receipt') {
    const id = option('id');
    const path = privateOutput(resolve(option('output', `private/receipts/${id}.json`)));
    await publicJob(id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ id, result_token: resultToken(id), service: 'https://decide-benchmark.vercel.app' }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Result receipt saved to ${path}.`);
  } else {
    console.error('Use setup | invite --endpoint https://... --name participant | status --id UUID | receipt --id UUID');
    process.exitCode = 1;
  }
} catch (error) {
  // Do not echo database exceptions, which can include credential-bearing connection strings.
  console.error(`Operator command failed (${error.code || error.name}). Check local configuration and parameters.`);
  process.exitCode = 1;
}
