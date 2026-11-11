#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, publicJob } from '../server/database.mjs';
import { resultToken } from '../server/security.mjs';
import { recoverSubmissionAlerts } from '../server/submission-alerts.mjs';

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
    const files = [new URL('../server/schema.sql', import.meta.url)];
    const migrations = new URL('../server/migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter((value) => value.endsWith('.sql')).sort()) files.push(new URL(name, migrations));
    for (const file of files) {
      const schema = await readFile(file, 'utf8');
      const statements = schema.split(/(?=^(?:ALTER TABLE|CREATE (?:TABLE|INDEX|UNIQUE INDEX|OR REPLACE FUNCTION)))/m).map((value) => value.trim()).filter(Boolean);
      for (const statement of statements) await db().query(statement, []);
    }
    console.log('Hosted evaluator database schema and migrations ready.');
  } else if (command === 'retry-alerts') {
    console.log(JSON.stringify(await recoverSubmissionAlerts(), null, 2));
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
    console.error('Use setup | retry-alerts | status --id UUID | receipt --id UUID');
    process.exitCode = 1;
  }
} catch (error) {
  // Do not echo database exceptions, which can include credential-bearing connection strings.
  console.error(`Operator command failed (${error.code || error.name}). Check local configuration and parameters.`);
  process.exitCode = 1;
}
