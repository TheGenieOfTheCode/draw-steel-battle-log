const SEL = '.chat-message .message-part-buttons';
const ROW = 'dsbl-btn-row';
const GAP = 4;

const foreign = (container) => !!container.closest('[class*="draw-steel-target-damage"]');

function unwrap(container) {
  for (const row of container.querySelectorAll(`:scope > .${ROW}`)) {
    row.replaceWith(...row.childNodes);
  }
}

function layout(container) {
  unwrap(container);
  const buttons = [...container.children].filter(el => el.matches('button, a.button'));
  if (!buttons.length) return;

  const avail = container.clientWidth;
  if (!avail) return;

  if (buttons.length === 1) {
    const row = document.createElement('div');
    row.className = ROW;
    buttons[0].before(row);
    row.append(buttons[0]);
    return;
  }
  const widths = buttons.map(b => b.getBoundingClientRect().width);
  const sum = (from, to) => widths.slice(from, to).reduce((a, b) => a + b, 0) + GAP * Math.max(0, to - from - 1);

  let rows = 1;
  let current = 0;
  for (const w of widths) {
    if (current && current + GAP + w > avail) { rows++; current = w; } else current += (current ? GAP : 0) + w;
  }

  const n = buttons.length;
  const base = Math.floor(n / rows);
  const extra = n % rows;
  let best = null;
  const combos = [];
  (function choose(start, chosen) {
    if (chosen.length === extra) { combos.push([...chosen]); return; }
    for (let i = start; i < rows; i++) { chosen.push(i); choose(i + 1, chosen); chosen.pop(); }
  })(0, []);
  for (const combo of combos) {
    let idx = 0;
    let widest = 0;
    let fits = true;
    const sizes = [];
    for (let r = 0; r < rows; r++) {
      const size = base + (combo.includes(r) ? 1 : 0);
      const w = sum(idx, idx + size);
      if (w > avail) { fits = false; break; }
      widest = Math.max(widest, w);
      idx += size;
      sizes.push(size);
    }
    if (fits && (!best || widest < best.widest)) best = { widest, sizes };
  }

  
  if (!best) {
    const sizes = [];
    let count = 0;
    current = 0;
    for (const w of widths) {
      if (current && current + GAP + w > avail) { sizes.push(count); count = 1; current = w; }
      else { count++; current += (current ? GAP : 0) + w; }
    }
    sizes.push(count);
    best = { sizes };
  }

  let idx = 0;
  for (const size of best.sizes) {
    const row = document.createElement('div');
    row.className = ROW;
    buttons[idx].before(row);
    row.append(...buttons.slice(idx, idx + size));
    idx += size;
  }
}

let _observer = null;
const _widths = new WeakMap();

function watch(container) {
  _observer ??= new ResizeObserver(entries => {
    for (const entry of entries) {
      const width = Math.round(entry.contentRect.width);
      if (_widths.get(entry.target) === width) continue;
      _widths.set(entry.target, width);
      layout(entry.target);
    }
  });
  _observer.observe(container);
}

export function flexMessageButtons(html) {
  queueMicrotask(() => {
    for (const container of html.querySelectorAll(SEL)) {
      if (foreign(container) || container.dataset.dscpFlex) continue;
      container.dataset.dscpFlex = '1';
      watch(container);
    }
  });
}
