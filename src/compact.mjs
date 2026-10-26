const SEL = 'document-embed.draw-steel.ability .metadata dl';

const MIN_SIZE = 12.5;
const STEP = 0.5;

function wraps(cell) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  const tops = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
  return tops.size > 1;
}

function pillify(dl) {
  const cell = dl.querySelector('dd.keywords');
  if (!cell || cell.dataset.dscpPills) return;

  const words = cell.textContent.split(/\s*,\s*|\s+and\s+/i).map(w => w.trim()).filter(Boolean);
  if (!words.length) return;

  cell.dataset.dscpPills = '1';
  cell.replaceChildren(...words.map(word => {
    const pill = document.createElement('span');
    pill.className = 'dsbl-kw';
    pill.textContent = word;
    return pill;
  }));
}

function rowifyTrigger(dl) {
  if (dl.querySelector(':scope > .dsbl-trigger-row')) return;
  const term = dl.querySelector(':scope > dt.trigger');
  const text = dl.querySelector(':scope > dd.trigger');
  if (!term || !text) return;
  const row = document.createElement('div');
  row.className = 'dsbl-trigger-row';
  const label = term.textContent.trim();
  if (label && !label.endsWith(':')) term.textContent = `${label}:`;
  term.before(row);
  row.append(term, document.createTextNode(' '), text);
}

function rowify(dl) {
  rowifyTrigger(dl);
  if (dl.querySelector(':scope > .dsbl-kw-row')) return;
  const keywords = dl.querySelector(':scope > dd.keywords');
  const type = dl.querySelector(':scope > dd.type');
  if (!keywords || !type) return;
  const row = document.createElement('div');
  row.className = 'dsbl-kw-row';
  keywords.before(row);
  row.append(keywords, type);
}

function resetKeywords(cell) {
  for (const br of cell.querySelectorAll('br')) br.remove();
  cell.style.whiteSpace = 'normal';
}

function applyKeywords(cell, breaks) {
  if (!breaks) return;
  const pills = [...cell.querySelectorAll('.dsbl-kw')];
  for (const at of breaks) pills[at].before(document.createElement('br'));
  cell.style.whiteSpace = 'nowrap';
}

function planKeywords(cell) {
  const pills = [...cell.querySelectorAll('.dsbl-kw')];
  if (pills.length < 2) return null;

  const avail = cell.clientWidth;
  const widths = pills.map(p => p.offsetWidth + (parseFloat(getComputedStyle(p).marginRight) || 0));
  const sum = (from, to) => widths.slice(from, to).reduce((a, b) => a + b, 0);

  let lines = 1;
  let current = 0;
  for (const w of widths) {
    if (current && current + w > avail) { lines++; current = w; } else current += w;
  }
  if (lines === 1) return null;

  const n = widths.length;
  const base = Math.floor(n / lines);
  const extra = n % lines;
  let best = null;
  const combos = [];
  (function choose(start, chosen) {
    if (chosen.length === extra) { combos.push([...chosen]); return; }
    for (let i = start; i < lines; i++) { chosen.push(i); choose(i + 1, chosen); chosen.pop(); }
  })(0, []);
  for (const combo of combos) {
    let idx = 0;
    let widest = 0;
    let fits = true;
    const breaks = [];
    for (let line = 0; line < lines; line++) {
      const size = base + (combo.includes(line) ? 1 : 0);
      const w = sum(idx, idx + size);
      if (w > avail) { fits = false; break; }
      widest = Math.max(widest, w);
      idx += size;
      breaks.push(idx);
    }
    if (fits && (!best || widest < best.widest)) best = { widest, breaks: breaks.slice(0, -1) };
  }

  
  if (!best) {
    const INF = Number.POSITIVE_INFINITY;
    const cost = Array.from({ length: lines + 1 }, () => Array(n + 1).fill(INF));
    const cut = Array.from({ length: lines + 1 }, () => Array(n + 1).fill(0));
    cost[0][0] = 0;
    for (let k = 1; k <= lines; k++) {
      for (let i = 1; i <= n; i++) {
        for (let j = k - 1; j < i; j++) {
          const w = sum(j, i);
          if (w > avail) continue;
          const c = Math.max(cost[k - 1][j], w);
          if (c < cost[k][i]) { cost[k][i] = c; cut[k][i] = j; }
        }
      }
    }
    if (cost[lines][n] === INF) return null;
    const breaks = [];
    for (let k = lines, i = n; k > 1; k--) { i = cut[k][i]; breaks.unshift(i); }
    best = { breaks };
  }
  return best.breaks;
}

function fitAll(dls) {
  const jobs = [];
  for (const dl of dls) {
    const embed = dl.isConnected ? dl.closest('document-embed') : null;
    if (!embed) continue;
    pillify(dl);
    rowify(dl);
    embed.style.removeProperty('--dsbl-meta-size');
    const cells = [...dl.children].filter(cell => !cell.classList.contains('keywords') && !cell.classList.contains('dsbl-kw-row') && !cell.classList.contains('dsbl-trigger-row'));
    const type = dl.querySelector('.dsbl-kw-row > dd.type');
    if (type) cells.push(type);
    jobs.push({ dl, embed, cells, keywords: dl.querySelector('dd.keywords') });
  }

  let shrinking = jobs.filter(j => j.cells.some(wraps));
  for (const j of shrinking) j.size = parseFloat(getComputedStyle(j.dl).fontSize) || 13;
  while (shrinking.length) {
    shrinking = shrinking.filter(j => (j.size -= STEP) >= MIN_SIZE);
    for (const j of shrinking) j.embed.style.setProperty('--dsbl-meta-size', `${j.size}px`);
    shrinking = shrinking.filter(j => j.cells.some(wraps));
  }

  const withKeywords = jobs.filter(j => j.keywords);
  for (const j of withKeywords) resetKeywords(j.keywords);
  const plans = withKeywords.map(j => planKeywords(j.keywords));
  withKeywords.forEach((j, i) => applyKeywords(j.keywords, plans[i]));

  for (const j of jobs) {
    const key = fitKey(j.dl);
    if (key) _fitted.set(key, { size: j.embed.style.getPropertyValue('--dsbl-meta-size') || null, breaks: plans[withKeywords.indexOf(j)] ?? null });
  }
}

let _observer = null;
const _widths = new WeakMap();

function watch(dl) {
  _observer ??= new ResizeObserver(entries => {
    const due = [];
    for (const entry of entries) {
      const width = Math.round(entry.contentRect.width);
      if (!width || _widths.get(entry.target) === width) continue;
      _widths.set(entry.target, width);
      due.push(entry.target);
    }
    if (due.length) fitAll(due);
  });
  _observer.observe(dl);
}


const _fitted = new Map();
const fitKey = (dl) => {
  const li = dl.closest('[data-message-id]');
  return li ? `${li.dataset.messageId}|${[...li.querySelectorAll(SEL)].indexOf(dl)}` : null;
};

export function compactAbilityMetadata(html) {
  for (const dl of html.querySelectorAll(SEL)) {
    
    pillify(dl);
    rowify(dl);
    const fit = _fitted.get(fitKey(dl));
    if (fit?.size) dl.closest('document-embed')?.style.setProperty('--dsbl-meta-size', fit.size);
    const keywords = dl.querySelector('dd.keywords');
    if (fit?.breaks && keywords) applyKeywords(keywords, fit.breaks);
    watch(dl);
  }
}

export function inlineEffectLabels(html) {
  for (const dl of html.querySelectorAll('document-embed.draw-steel.ability section.effect dl')) {
    if (dl.dataset.dscpInline) continue;

    const term = dl.querySelector('dt.effect');
    const body = dl.querySelector('dd.effect');
    if (!term || !body) continue;

    const label = term.textContent.trim();
    if (!label) continue;

    dl.dataset.dscpInline = '1';

    const hasBody = !!body.textContent.trim();

    const lead = document.createElement('strong');
    lead.className = 'dsbl-effect-label';
    lead.textContent = hasBody ? `${label}:` : label;

    const first = body.querySelector(':scope > p') ?? body;
    first.prepend(lead, document.createTextNode(' '));
    term.remove();
  }
}
