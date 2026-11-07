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

function showFamilies(data) {
  const container = document.querySelector('#family-results');
  container.replaceChildren();
  for (const family of data.families) {
    const article = node('article', `family-row ${family.id === 'voice' ? 'family-voice' : ''}`);
    const heading = node('div', 'family-heading');
    const title = node('h3', '', family.name);
    title.id = `family-${family.id}`;
    heading.append(title, node('p', '', `${count(family.questions)} questions`));
    article.setAttribute('aria-labelledby', title.id);
    const leaders = node('ol', 'family-leaders');
    topFamilyModels(data.models, family.id).forEach((model, index) => {
      const item = node('li', model.id === 'tazo' ? 'family-tazo' : '');
      item.append(node('span', 'family-rank', `0${index + 1}`), node('span', 'family-model', model.name),
        node('strong', 'family-accuracy', percent(model.families[family.id].accuracy)));
      leaders.append(item);
    });
    article.append(heading, leaders);
    container.append(article);
  }
}

function showFrontier(data) {
  const svg = document.querySelector('#frontier-plot');
  const points = frontierPoints(data.models);
  const x = value => 86 + value * 5.6;
  const y = value => 610 - value * 5.6;
  svg.replaceChildren(svgNode('title', {}, 'DECIDE efficiency–latency Pareto frontier'),
    svgNode('desc', {}, 'All 20 evaluated models. Both axes show percentile ranks from 0 to 100. Higher is better. Tazo is the fastest model and lies on the frontier. Activate a point for its raw metrics.'));
  svg.append(svgNode('rect', { x: x(50), y: y(100) - 16, width: 280, height: 296, class: 'frontier-favorable' }));
  for (const value of [0, 25, 50, 75, 100]) {
    svg.append(svgNode('line', { x1: x(value), x2: x(value), y1: y(0), y2: y(100), class: value === 50 ? 'frontier-midpoint' : 'frontier-grid' }),
      svgNode('line', { x1: x(0), x2: x(100), y1: y(value), y2: y(value), class: value === 50 ? 'frontier-midpoint' : 'frontier-grid' }),
      svgNode('text', { x: x(value), y: y(0) + 26, 'text-anchor': 'middle', class: 'frontier-tick' }, value),
      svgNode('text', { x: x(0) - 14, y: y(value) + 5, 'text-anchor': 'end', class: 'frontier-tick' }, value));
  }
  svg.append(svgNode('text', { x: x(0), y: 25, class: 'quadrant-label' }, 'Faster · less efficient'),
    svgNode('text', { x: x(53), y: 25, class: 'quadrant-label' }, 'Faster · more efficient'),
    svgNode('text', { x: x(0), y: 666, class: 'quadrant-label' }, 'Slower · less efficient'),
    svgNode('text', { x: x(53), y: 666, class: 'quadrant-label' }, 'Slower · more efficient'),
    svgNode('text', { x: x(50), y: 708, 'text-anchor': 'middle', class: 'frontier-axis-label' }, 'Intelligence per unit price →'),
    svgNode('text', { transform: 'translate(28 330) rotate(-90)', 'text-anchor': 'middle', class: 'frontier-axis-label' }, 'Latency advantage · faster ↑'));
  const frontier = points.filter(point => point.frontier).sort((a, b) => a.x - b.x);
  svg.append(svgNode('path', { d: frontier.map((point, index) => `${index ? 'L' : 'M'}${x(point.x)},${y(point.y)}`).join(' '), class: 'frontier-line' }));
  const detail = document.querySelector('#frontier-detail');
  function selectModel(point) {
    detail.replaceChildren(node('strong', '', point.name), node('span', '', `${percent(point.accuracy)} accuracy`),
      node('span', '', `${money(point.cost_usd)} run cost`), node('span', '', latency(point.latency_ms)));
    detail.classList.toggle('is-tazo', point.id === 'tazo');
    svg.querySelectorAll('.frontier-point').forEach(group => group.setAttribute('data-active', String(group.dataset.model === point.id)));
  }
  // Draw the highlighted model last so its marker and label remain unobstructed.
  const drawingOrder = [...points].sort((a, b) => Number(a.id === 'tazo') - Number(b.id === 'tazo'));
  drawingOrder.forEach(point => {
    const isTazo = point.id === 'tazo';
    const label = `${point.name}: ${percent(point.accuracy)} accuracy, ${money(point.cost_usd)} run cost, ${latency(point.latency_ms)} mean latency${point.frontier ? ', on the frontier' : ''}.`;
    const group = svgNode('g', { class: `frontier-point ${isTazo ? 'frontier-tazo' : ''} ${point.frontier ? 'on-frontier' : ''} ${point.input === 'stt-text' ? 'point-text' : ''}`,
      transform: `translate(${x(point.x)} ${y(point.y)})`, tabindex: '0', role: 'button', 'aria-label': label, 'data-model': point.id });
    group.append(svgNode('title', {}, label), svgNode('circle', { r: 20, class: 'point-hit' }));
    if (isTazo) group.append(svgNode('circle', { r: 18, class: 'point-halo' }));
    group.append(svgNode('circle', { r: isTazo ? 10 : 6, class: 'point-dot' }));
    if (isTazo) group.append(svgNode('rect', { x: 16, y: -21, width: 180, height: 40, rx: 4, class: 'tazo-point-label-bg' }),
      svgNode('text', { x: 26, y: 6, class: 'tazo-point-name' }, `Tazo · ${latency(point.latency_ms)}`));
    group.addEventListener('pointerenter', () => selectModel(point));
    group.addEventListener('focus', () => selectModel(point));
    group.addEventListener('click', () => selectModel(point));
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectModel(point); }
    });
    svg.append(group);
  });
  selectModel(points.find(point => point.id === 'tazo'));
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
    showFamilies(data);
    showFrontier(data);
    const tazo = data.models.find(model => model.id === 'tazo');
    document.querySelector('#tazo-voice-accuracy').textContent = percent(tazo.families.voice.accuracy);
    document.querySelector('#score-references').textContent = `A = accuracy (0–1), C = run cost, L = mean latency. Fixed reference medians: Cₘ = $${data.reference.cost_usd.toFixed(4)}; Lₘ = ${(data.reference.latency_ms / 1000).toFixed(3)} s.`;
    document.querySelector('#leaderboard-loading').hidden = true;
    document.querySelectorAll('[data-leaderboard-content]').forEach(section => section.hidden = false);
  } catch {
    document.querySelector('#leaderboard-loading').textContent = 'The leaderboard could not be loaded. Please refresh to try again.';
  }
}

init();
