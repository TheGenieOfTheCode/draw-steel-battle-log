const SEL = 'document-embed.draw-steel.ability .metadata dl';

const MIN_SIZE = 11;
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
    pill.className = 'dscp-kw';
    pill.textContent = word;
    return pill;
  }));
}

function rowify(dl) {
  if (dl.querySelector(':scope > .dscp-kw-row')) return;
  const keywords = dl.querySelector(':scope > dd.keywords');
  const type = dl.querySelector(':scope > dd.type');
  if (!keywords || !type) return;
  const row = document.createElement('div');
  row.className = 'dscp-kw-row';
  keywords.before(row);
  row.append(keywords, type);
}

function balanceKeywords(cell) {
  const pills = [...cell.querySelectorAll('.dscp-kw')];
  for (const br of cell.querySelectorAll('br')) br.remove();
  cell.style.whiteSpace = 'normal';
  if (pills.length < 2) return;

  const avail = cell.clientWidth;
  const widths = pills.map(p => p.offsetWidth + (parseFloat(getComputedStyle(p).marginRight) || 0));
  const sum = (from, to) => widths.slice(from, to).reduce((a, b) => a + b, 0);

  let lines = 1;
  let current = 0;
  for (const w of widths) {
    if (current && current + w > avail) { lines++; current = w; } else current += w;
  }
  if (lines === 1) return;

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
    if (cost[lines][n] === INF) return;
    const breaks = [];
    for (let k = lines, i = n; k > 1; k--) { i = cut[k][i]; breaks.unshift(i); }
    best = { breaks };
  }

  for (const at of best.breaks) pills[at].before(document.createElement('br'));
  cell.style.whiteSpace = 'nowrap';
}

function fit(dl) {
  const embed = dl.closest('document-embed');
  if (!embed) return;

  pillify(dl);
  rowify(dl);
  embed.style.removeProperty('--dscp-meta-size');

  const keywords = dl.querySelector('dd.keywords');
  const cells = [...dl.children].filter(cell => !cell.classList.contains('keywords') && !cell.classList.contains('dscp-kw-row'));
  const type = dl.querySelector('.dscp-kw-row > dd.type');
  if (type) cells.push(type);
  const wrapped = () => cells.some(wraps);

  if (!wrapped()) { if (keywords) balanceKeywords(keywords); return; }

  const base = parseFloat(getComputedStyle(dl).fontSize) || 13;
  for (let size = base - STEP; size >= MIN_SIZE; size -= STEP) {
    embed.style.setProperty('--dscp-meta-size', `${size}px`);
    if (!wrapped()) break;
  }
  if (keywords) balanceKeywords(keywords);
}

let _observer = null;
const _widths = new WeakMap();

function watch(dl) {
  _observer ??= new ResizeObserver(entries => {
    for (const entry of entries) {
      const width = Math.round(entry.contentRect.width);
      if (_widths.get(entry.target) === width) continue;
      _widths.set(entry.target, width);
      fit(entry.target);
    }
  });
  _observer.observe(dl);
}

export function compactAbilityMetadata(html) {
  for (const dl of html.querySelectorAll(SEL)) {
    requestAnimationFrame(() => {
      if (!dl.isConnected) return;
      fit(dl);
      watch(dl);
    });
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
    lead.className = 'dscp-effect-label';
    lead.textContent = hasBody ? `${label}:` : label;

    const first = body.querySelector(':scope > p') ?? body;
    first.prepend(lead, document.createTextNode(' '));
    term.remove();
  }
}
