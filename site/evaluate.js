const $ = (id) => document.getElementById(id);
const storageKey = 'decide-evaluation-receipt-v1';
let receipt = null, pending = null, report = null, timer = null, polling = false;
const terminal = new Set(['completed', 'failed', 'cancelled']);
function remember(value) {
  receipt = value;
  try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Download receipt remains available. */ }
}
function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function api(method, body) {
  const headers = body ? { 'Content-Type': 'application/json' } : { Authorization: `Bearer ${receipt.result_token}` };
  const url = '/api/evaluations' + (body ? '' : '?id=' + encodeURIComponent(receipt.id));
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', redirect: 'error' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Service returned HTTP ${response.status}`);
  return value;
}
function render(job) {
  $('job-panel').hidden = false; $('job-empty').hidden = true;
  $('job-model').textContent = job.model; $('job-status').textContent = job.status;
  $('job-progress').textContent = `${job.progress.completed.toLocaleString()} / ${job.progress.total.toLocaleString()}`;
  $('job-meter').max = job.progress.total; $('job-meter').value = job.progress.completed;
  $('cancel-job').disabled = terminal.has(job.status);
  $('job-message').textContent = job.error ? `Evaluation stopped: ${job.error.replaceAll('_', ' ')}.` :
    job.status === 'completed' ? 'Evaluation complete. Your aggregate results are below.' :
    job.status === 'cancelled' ? 'Evaluation cancelled. A request already in progress may still finish.' : 'Running in the background. You can leave this page and return later.';
  report = job.report; $('report').hidden = !report;
  if (report) {
    const pct = (v) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
    const scope = report.scope === 'public_preview' ? 'Preview integration check' : report.scope === 'operator_smoke_test' ? 'Operator smoke test' : 'DECIDE v' + report.version;
    $('report-summary').textContent = `${scope} · Accuracy ${pct(report.overall.accuracy)} · Task macro ${pct(report.task_macro_accuracy)} · Coverage ${pct(report.overall.coverage)}`;
    const rows = Object.entries(report.by_task).map(([task, value]) => {
      const tr = document.createElement('tr'), name = document.createElement('th'); name.scope = 'row'; name.textContent = task.replaceAll('_', ' '); tr.append(name);
      for (const text of [value.questions.toLocaleString(), value.suppressed ? 'Withheld (<10)' : pct(value.accuracy)]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      return tr;
    });
    $('report-table').querySelector('tbody').replaceChildren(...rows);
  }
  clearTimeout(timer);
  if (!terminal.has(job.status)) timer = setTimeout(refresh, 10000);
}
async function refresh() {
  if (!receipt || polling) return;
  polling = true;
  try { render(await api('GET')); }
  catch (error) { $('job-message').textContent = `Could not refresh: ${error.message}. Use Refresh status to retry.`; }
  finally { polling = false; }
}
$('submission-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (receipt && !$('cancel-job').disabled) { $('submission-message').textContent = 'Finish or cancel the current evaluation before starting another on this device.'; return; }
  const body = Object.fromEntries(new FormData(event.target));
  body.api_key = body.api_key.trim().replace(/^Bearer +/i, ''); body.invitation_token = body.invitation_token.trim();
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body))))).map((n) => n.toString(16).padStart(2, '0')).join('');
  if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, key: crypto.randomUUID() };
  body.idempotency_key = pending.key;
  $('submit-button').disabled = true; $('submission-message').textContent = 'Submitting…';
  try {
    const job = await api('POST', body);
    remember({ id: job.id, result_token: job.result_token, service: location.origin });
    pending = null; event.target.elements.api_key.value = ''; event.target.elements.invitation_token.value = '';
    $('submission-message').textContent = 'Accepted. Save the private receipt below to keep access to this job.';
    render(job);
  } catch (error) { $('submission-message').textContent = `Submission failed: ${error.message.replaceAll('_', ' ')}. Retry with the same settings.`; }
  finally { $('submit-button').disabled = false; }
});
$('refresh-job').addEventListener('click', refresh);
$('download-receipt').addEventListener('click', () => download(receipt, `decide-receipt-${receipt.id}.json`));
$('download-report').addEventListener('click', () => download(report, `decide-results-${receipt.id}.json`));
$('cancel-job').addEventListener('click', async () => { try { render(await api('DELETE')); } catch (error) { $('job-message').textContent = error.message; } });
$('restore-receipt').addEventListener('change', async (event) => {
  try {
    const file = event.target.files[0]; if (!file || file.size > 12000) throw new Error('Choose a DECIDE receipt JSON file.');
    const value = JSON.parse(await file.text());
    if (!/^[a-f0-9-]{36}$/.test(value.id || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.result_token || '') || value.service !== location.origin) throw new Error('Invalid receipt or receipt belongs to another service.');
    remember({ id: value.id, result_token: value.result_token, service: location.origin }); await refresh();
  } catch (error) { $('job-empty').textContent = error.message; $('job-empty').hidden = false; }
});
try { const value = JSON.parse(localStorage.getItem(storageKey)); if (value?.id && value?.result_token && value.service === location.origin) { receipt = value; refresh(); } } catch { /* No saved receipt. */ }
