import { loadDataset, audioBytes } from './dataset.mjs';
import { predictModel } from './model.mjs';

export async function checkEndpoint(job, key, requestId, dependencies = {}) {
  const load = dependencies.load || loadDataset;
  const read = dependencies.read || audioBytes;
  const predict = dependencies.predict || predictModel;
  // Check the real model contract on public data before loading any private inputs.
  const sample = (await load('preview')).questions[0];
  const audio = job.modality === 'audio' ? await read(sample, 'preview') : null;
  await predict(job, sample, key, audio, requestId);
}
