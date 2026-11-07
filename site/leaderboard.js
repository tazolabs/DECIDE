import { frontierPoints, sortModels, topFamilyModels, validateLeaderboard } from './leaderboard-model.js';

const percent = value => `${(100 * value).toFixed(2)}%`;
const money = value => `$${value.toFixed(2)}`;
const latency = value => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} ms`;
const count = value => new Intl.NumberFormat('en-US').format(value);
const svgNamespace = 'http://www.w3.org/2000/svg';

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function svgNode(tag, attributes = {}, text) {
  const item = document.createElementNS(svgNamespace, tag);
  Object.entries(attributes).forEach(([key, value]) => item.setAttribute(key, value));
  if (text !== undefined) item.textContent = text;
  return item;
}

function showTable(data, sort = 'dbs') {
  const body = document.querySelector('#model-results');
  body.replaceChildren();
  const sorted = sortModels(data.models, sort);
  sorted.forEach((model, index) => {
    const tr = node('tr', model.id === 'tazo' ? 'model-tazo' : '');
    tr.append(node('td', 'rank-column', String(index + 1).padStart(2, '0')));
    const name = node('th', 'model-name');
    name.scope = 'row';
    name.append(node('span', '', model.name), node('small', '', model.input === 'audio' ? 'Direct audio' : 'STT + text'));
    tr.append(name);
    for (const [key, value] of [['accuracy', percent(model.accuracy)], ['cost', money(model.cost_usd)],
      ['latency', latency(model.latency_ms)], ['dbs', model.dbs.toFixed(2)]]) {
      tr.append(node('td', `metric-column ${key === sort ? 'sorted-metric' : ''} ${key === 'dbs' ? 'dbs-column' : ''}`, value));
    }
    body.append(tr);
  });
  document.querySelectorAll('[data-sort]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sort === sort)));
  document.querySelectorAll('[data-sort-column]').forEach(th => {
    if (th.dataset.sortColumn === sort) th.setAttribute('aria-sort', sort === 'latency' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
  document.querySelector('#sort-status').textContent = `Sorted by ${sort === 'dbs' ? 'DBS, highest first' : sort === 'latency' ? 'latency, lowest first' : 'accuracy, highest first'}.`;
}

const voiceCompanies = {
  tazo: { name: 'Tazo Labs', logo: '/assets/brand/tazo-mark-teal.svg' },
  'perceptron-mk1-5': { name: 'Perceptron', logo: '/assets/brand/perceptron.svg' },
  'gpt-realtime-2-1': { name: 'OpenAI', logo: '/assets/brand/openai.png' },
  'qwen2-5-omni-3b': { name: 'Alibaba · Qwen', logo: '/assets/brand/qwen.png' },
  'gemini-2-5-flash': { name: 'Google', logo: '/assets/brand/google.png' },
};

function showVoiceLeaders(data) {
  const body = document.querySelector('#voice-results');
  body.replaceChildren();
  topFamilyModels(data.models, 'voice', 5).forEach((model, index) => {
    const row = node('tr', model.id === 'tazo' ? 'model-tazo' : '');
    row.append(node('td', 'rank-column', String(index + 1).padStart(2, '0')));
    const heading = node('th', 'model-name');
    heading.scope = 'row';
    const identity = node('div', 'voice-model');
    const company = voiceCompanies[model.id];
    if (company) {
      const logo = node('img', `company-logo company-${model.id}`);
      logo.src = company.logo;
      logo.alt = '';
      logo.width = 32;
      logo.height = 32;
      identity.append(logo);
    }
    const name = node('div');
    name.append(node('span', '', model.name));
    if (company) name.append(node('small', '', company.name));
    identity.append(name);
    heading.append(identity);
    row.append(heading, node('td', 'metric-column voice-accuracy', percent(model.families.voice.accuracy)));
    body.append(row);
  });
  const family = data.families.find(item => item.id === 'voice');
  document.querySelector('#voice-question-count').textContent = `${count(family.questions)} questions · Caller emotion, audio disturbance and speaker count`;
}

// Keep every label legible without moving its data point. Leader lines connect displaced names.
function labelFrontier(svg, points, x, y) {
  const layer = svgNode('g', { class: 'frontier-labels', 'aria-hidden': 'true' });
  svg.append(layer);
  const occupied = [];
  const overlaps = (a, b, gap = 4) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  [...points].sort((a, b) => Number(b.id === 'tazo') - Number(a.id === 'tazo') || b.y - a.y).forEach(point => {
    const label = svgNode('text', { class: `frontier-model-label ${point.id === 'tazo' ? 'tazo-point-name' : ''}` }, point.name);
    layer.append(label);
    const measured = label.getBBox();
    const width = measured.width + 10;
    const height = measured.height + 6;
    const px = x(point.x), py = y(point.y);
    const candidates = [];
    for (const offset of [14, 34, 64, 104]) {
      for (const dy of [-height / 2, -height - 12, 12, -height - 36, 36, -height - 64, 64]) {
        for (const side of [1, -1]) {
          const box = { x: px + (side === 1 ? offset : -offset - width), y: py + dy, width, height };
          if (box.x < 92 || box.x + width > 990 || box.y < 56 || box.y + height > 690) continue;
          const collisions = occupied.filter(other => overlaps(box, other)).length
            + points.filter(other => overlaps(box, { x: x(other.x) - 10, y: y(other.y) - 10, width: 20, height: 20 }, 2)).length;
          const distance = Math.hypot(box.x + width / 2 - px, box.y + height / 2 - py);
          candidates.push({ ...box, score: collisions * 10000 + distance + (side === -1 ? 2 : 0) });
        }
      }
    }
    const box = candidates.sort((a, b) => a.score - b.score)[0];
    occupied.push(box);
    const anchorX = Math.max(box.x, Math.min(px, box.x + width));
    const anchorY = Math.max(box.y, Math.min(py, box.y + height));
    layer.insertBefore(svgNode('line', { x1: px, y1: py, x2: anchorX, y2: anchorY, class: 'frontier-label-line' }), label);
    layer.insertBefore(svgNode('rect', { x: box.x, y: box.y, width, height, rx: 3,
      class: point.id === 'tazo' ? 'tazo-point-label-bg' : 'frontier-label-bg' }), label);
    label.setAttribute('x', box.x + 5);
    label.setAttribute('y', box.y + 3 - measured.y);
  });
}

function showFrontier(data) {
  const svg = document.querySelector('#frontier-plot');
  const points = frontierPoints(data.models, data.reference);
  const x = value => 130 + value * 7.5;
  const y = value => 650 - value * 5.6;
  svg.replaceChildren(svgNode('title', {}, 'DECIDE efficiency–latency Pareto frontier'),
    svgNode('desc', {}, 'All 20 evaluated models. Lower normalized latency is better on the horizontal axis. Higher accuracy-per-dollar percentile is better on the vertical axis. The top-left quadrant is favorable. Every model is labelled; focus or activate a point for its raw metrics.'));
  svg.append(svgNode('rect', { x: x(0), y: y(100), width: 375, height: 280, class: 'frontier-favorable' }));
  for (const value of [0, 25, 50, 75, 100]) {
    svg.append(svgNode('line', { x1: x(value), x2: x(value), y1: y(0), y2: y(100), class: value === 50 ? 'frontier-midpoint' : 'frontier-grid' }),
      svgNode('line', { x1: x(0), x2: x(100), y1: y(value), y2: y(value), class: value === 50 ? 'frontier-midpoint' : 'frontier-grid' }),
      svgNode('text', { x: x(value), y: y(0) + 27, 'text-anchor': 'middle', class: 'frontier-tick' }, value),
      svgNode('text', { x: x(0) - 16, y: y(value) + 5, 'text-anchor': 'end', class: 'frontier-tick' }, value));
  }
  svg.append(svgNode('text', { x: x(0), y: 37, class: 'quadrant-label quadrant-best' }, 'Faster · more efficient'),
    svgNode('text', { x: x(53), y: 37, class: 'quadrant-label' }, 'Slower · more efficient'),
    svgNode('text', { x: x(0), y: 719, class: 'quadrant-label' }, 'Faster · less efficient'),
    svgNode('text', { x: x(53), y: 719, class: 'quadrant-label' }, 'Slower · less efficient'),
    svgNode('text', { x: x(50), y: 765, 'text-anchor': 'middle', class: 'frontier-axis-label' }, 'Normalized latency · lower is better ←'),
    svgNode('text', { transform: 'translate(35 370) rotate(-90)', 'text-anchor': 'middle', class: 'frontier-axis-label' }, 'Efficiency · accuracy per dollar ↑'));
  const frontier = points.filter(point => point.frontier).sort((a, b) => a.x - b.x);
  svg.append(svgNode('path', { d: frontier.map((point, index) => `${index ? 'L' : 'M'}${x(point.x)},${y(point.y)}`).join(' '), class: 'frontier-line' }));
  const chart = document.querySelector('.frontier-chart');
  const tooltip = document.querySelector('#frontier-tooltip');
  const status = document.querySelector('#frontier-status');
  function hideTooltip() {
    tooltip.hidden = true;
    svg.querySelectorAll('.frontier-point').forEach(group => {
      group.removeAttribute('aria-describedby');
      group.removeAttribute('data-active');
    });
  }
  function positionTooltip(group, event) {
    const chartBox = chart.getBoundingClientRect();
    const dot = group.querySelector('.point-dot').getBoundingClientRect();
    const px = (event?.clientX ?? dot.x + dot.width / 2) - chartBox.x;
    const py = (event?.clientY ?? dot.y + dot.height / 2) - chartBox.y;
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    const left = px + width + 24 < chartBox.width ? px + 16 : px - width - 16;
    const top = py + height + 24 < chartBox.height ? py + 16 : py - height - 16;
    tooltip.style.left = `${Math.max(8, Math.min(left, chartBox.width - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(top, chartBox.height - height - 8))}px`;
  }
  function showTooltip(point, group, event) {
    tooltip.replaceChildren(node('strong', '', point.name));
    const metrics = node('dl');
    for (const [name, value] of [['Accuracy', percent(point.accuracy)], ['Run cost', money(point.cost_usd)], ['Mean latency', latency(point.latency_ms)]]) {
      metrics.append(node('dt', '', name), node('dd', '', value));
    }
    tooltip.append(metrics);
    tooltip.classList.toggle('is-tazo', point.id === 'tazo');
    tooltip.hidden = false;
    svg.querySelectorAll('.frontier-point').forEach(item => {
      item.setAttribute('data-active', String(item === group));
      item.removeAttribute('aria-describedby');
    });
    group.setAttribute('aria-describedby', tooltip.id);
    positionTooltip(group, event);
    if (!event || event.type === 'click') status.textContent = group.getAttribute('aria-label');
  }
  const drawingOrder = [...points].sort((a, b) => Number(a.id === 'tazo') - Number(b.id === 'tazo'));
  drawingOrder.forEach(point => {
    const isTazo = point.id === 'tazo';
    const label = `${point.name}: ${percent(point.accuracy)} accuracy, ${money(point.cost_usd)} run cost, ${latency(point.latency_ms)} mean latency${point.frontier ? ', on the frontier' : ''}.`;
    const group = svgNode('g', { class: `frontier-point ${isTazo ? 'frontier-tazo' : ''} ${point.frontier ? 'on-frontier' : ''} ${point.input === 'stt-text' ? 'point-text' : ''}`,
      transform: `translate(${x(point.x)} ${y(point.y)})`, tabindex: '0', role: 'button', 'aria-label': label, 'data-model': point.id });
    group.append(svgNode('circle', { r: 18, class: 'point-hit' }));
    if (isTazo) group.append(svgNode('circle', { r: 18, class: 'point-halo' }));
    group.append(svgNode('circle', { r: isTazo ? 9 : 6, class: 'point-dot' }));
    group.addEventListener('pointerenter', event => showTooltip(point, group, event));
    group.addEventListener('pointermove', event => positionTooltip(group, event));
    group.addEventListener('pointerleave', () => { if (document.activeElement !== group) hideTooltip(); });
    group.addEventListener('focus', () => showTooltip(point, group));
    group.addEventListener('blur', hideTooltip);
    group.addEventListener('click', event => { group.focus({ preventScroll: true }); showTooltip(point, group, event); });
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showTooltip(point, group); }
    });
    svg.append(group);
  });
  labelFrontier(svg, points, x, y);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.frontier-point')) hideTooltip(); });
  document.querySelector('.frontier-scroll').addEventListener('scroll', () => {
    const focused = document.activeElement;
    if (focused?.matches('.frontier-point') && !tooltip.hidden) positionTooltip(focused);
    else hideTooltip();
  });
  window.addEventListener('resize', hideTooltip);
}

async function init() {
  try {
    const response = await fetch('/data/leaderboard.json');
    if (!response.ok) throw new Error('Leaderboard unavailable');
    const data = validateLeaderboard(await response.json());
    showTable(data);
    document.querySelectorAll('[data-sort]').forEach(button => {
      button.disabled = false;
      button.addEventListener('click', () => showTable(data, button.dataset.sort));
    });
    showVoiceLeaders(data);
    document.querySelectorAll('[data-leaderboard-content]').forEach(section => section.hidden = false);
    await document.fonts.ready;
    showFrontier(data);
    const tazo = data.models.find(model => model.id === 'tazo');
    document.querySelector('#tazo-voice-accuracy').textContent = percent(tazo.families.voice.accuracy);
    document.querySelector('#score-references').textContent = `A = accuracy (0–1), C = run cost, L = mean latency. Fixed reference medians: Cₘ = $${data.reference.cost_usd.toFixed(4)}; Lₘ = ${(data.reference.latency_ms / 1000).toFixed(3)} s.`;
    document.querySelector('#leaderboard-loading').hidden = true;
  } catch {
    document.querySelector('#leaderboard-loading').textContent = 'The leaderboard could not be loaded. Please refresh to try again.';
  }
}

init();
