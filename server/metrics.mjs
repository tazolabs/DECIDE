import { PublicError } from './security.mjs';

export function validateAnswer(payload, criteria, model) {
  if (!payload || typeof payload !== 'object') throw new PublicError('invalid_model_response');
  if (payload.model !== undefined && payload.model !== model) throw new PublicError('response_model_mismatch');
  const answer = payload.answers?.action || payload;
  if (typeof answer.choice !== 'string' || !Object.hasOwn(criteria, answer.choice)) throw new PublicError('invalid_model_response');
  const probabilities = answer.probabilities;
  if (probabilities !== undefined) {
    if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities) ||
        Object.keys(probabilities).length !== Object.keys(criteria).length ||
        Object.keys(criteria).some((key) => !Object.hasOwn(probabilities, key)) ||
        Object.values(probabilities).some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) ||
        Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) > .001 ||
        probabilities[answer.choice] < Math.max(...Object.values(probabilities)) - .000001) {
      throw new PublicError('invalid_model_response');
    }
  }
  return answer.choice;
}

const empty = () => ({ questions: 0, valid: 0, correct: 0, accepted: 0 });
export const emptyMetrics = () => ({ overall: empty(), task: {}, family: {}, duration: {} });

export function addOutcome(metrics, question, reference, choice) {
  const valid = choice !== null;
  for (const bucket of [metrics.overall,
    metrics.task[question.task] ||= empty(),
    metrics.family[question.family] ||= empty(),
    metrics.duration[question.duration_bucket] ||= empty()]) {
    bucket.questions++;
    bucket.valid += Number(valid);
    bucket.correct += Number(valid && choice === reference.label);
    bucket.accepted += Number(valid && (reference.accepted_labels || [reference.label]).includes(choice));
  }
  return metrics;
}

export function aggregateReport(metrics, total, { minCell = 10, version = '1.0' } = {}) {
  function format(value, n = value.questions, suppress = false) {
    if (suppress && n < minCell) return { questions: n, suppressed: true };
    return { questions: n, valid_predictions: value.valid, missing_or_failed: n - value.valid,
      coverage: n ? value.valid / n : null, correct: value.correct,
      accuracy: n ? value.correct / n : null, accepted_accuracy: n ? value.accepted / n : null };
  }
  const by = (groups) => Object.fromEntries(Object.entries(groups).sort().map(([name, value]) => [name, format(value, value.questions, true)]));
  const tasks = Object.values(metrics.task);
  return { dataset: 'DECIDE', version, overall: format(metrics.overall, total),
    task_macro_accuracy: tasks.length ? tasks.reduce((s, t) => s + t.correct / t.questions, 0) / tasks.length : null,
    by_task: by(metrics.task), by_family: by(metrics.family), by_duration: by(metrics.duration),
    minimum_reported_cell_size: minCell };
}
