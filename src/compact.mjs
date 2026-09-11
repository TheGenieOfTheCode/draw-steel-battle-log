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

function fit(dl) {
  const embed = dl.closest('document-embed');
  if (!embed) return;

  pillify(dl);
  embed.style.removeProperty('--dscp-meta-size');

  
  
  const cells = [...dl.children].filter(cell => !cell.classList.contains('keywords'));
  const wrapped = () => cells.some(wraps);
  if (!wrapped()) return;

  const base = parseFloat(getComputedStyle(dl).fontSize) || 13;
  for (let size = base - STEP; size >= MIN_SIZE; size -= STEP) {
    embed.style.setProperty('--dscp-meta-size', `${size}px`);
    if (!wrapped()) return;
  }
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
