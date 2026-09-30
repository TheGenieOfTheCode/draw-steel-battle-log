export const MODULE_ID = 'draw-steel-battle-log';

const STORE_KEY = `${MODULE_ID}.collapsed`;
const AUTO_KEY = `${MODULE_ID}.autocollapsed`;

const AUTOMATED_FLAGS = ['draw-steel-triggers'];

let _store = null;
let _auto = null;

function store() {
  if (_store) return _store;
  try {
    _store = new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'));
  } catch {
    _store = new Set();
  }
  return _store;
}

function autoStore() {
  if (_auto) return _auto;
  try {
    _auto = new Set(JSON.parse(localStorage.getItem(AUTO_KEY) ?? '[]'));
  } catch {
    _auto = new Set();
  }
  return _auto;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...store()]));
    if (_auto) localStorage.setItem(AUTO_KEY, JSON.stringify([...autoStore()]));
  } catch {

  }
}

const isAutomated = message => AUTOMATED_FLAGS.some(id => message?.flags?.[id]?.automated);

const keyFor = (messageId, index) => `${messageId}:${index}`;

export function makeAbilitiesCollapsible(message, html) {
  const embeds = html.querySelectorAll('document-embed.draw-steel.ability');
  const automated = isAutomated(message);

  embeds.forEach((embed, index) => {
    const name = embed.querySelector(':scope > h5');
    if (!name) return;

    const key = keyFor(message.id, index);

    name.classList.add('dsbl-ability-name');
    if (!name.querySelector('.dsbl-caret')) {
      const caret = document.createElement('i');
      caret.className = 'fa-solid fa-caret-down dsbl-caret';
      caret.setAttribute('inert', '');
      name.prepend(caret);
    }

    if (automated && !autoStore().has(key)) {
      autoStore().add(key);
      store().add(key);
      persist();
    }

    setCollapsed(embed, store().has(key));

    name.addEventListener('click', event => {
      if (event.target.closest('a')) return;
      const collapsed = !embed.classList.contains('dsbl-collapsed');
      setCollapsed(embed, collapsed);
      if (collapsed) store().add(key);
      else store().delete(key);
      persist();
    });
  });
}

function setCollapsed(embed, collapsed) {
  embed.classList.toggle('dsbl-collapsed', collapsed);

  
  
  if (!embed.parentElement?.classList.contains('message-part-html')) return;
  embed.closest('[data-message-part]')?.classList.toggle('dsbl-part-collapsed', collapsed);

  syncSiblingPanels(embed.closest('[data-message-id]'));
}

function syncSiblingPanels(root) {
  if (!root) return;
  const cards = root.querySelectorAll('.message-part-html > document-embed.draw-steel.ability');
  const hide = cards.length > 0 && [...cards].every(card => card.classList.contains('dsbl-collapsed'));
  root.classList.toggle('dsbl-hide-panels', hide);
  scheduleTrailingPart(root);
  watchRoot(root, hide);
}

function scheduleTrailingPart(root, attempts = 10) {
  requestAnimationFrame(() => {
    if (root.isConnected) return markTrailingPart(root);
    if (attempts > 0) scheduleTrailingPart(root, attempts - 1);
  });
}

const _observers = new WeakMap();

function watchRoot(root, active) {
  const existing = _observers.get(root);
  if (!active) {
    existing?.disconnect();
    _observers.delete(root);
    return;
  }
  if (existing) return;
  const observer = new MutationObserver(() => scheduleTrailingPart(root, 0));
  observer.observe(root, { childList: true });
  _observers.set(root, observer);
}

function markTrailingPart(root) {
  for (const marked of root.querySelectorAll('.dsbl-part-trailing')) marked.classList.remove('dsbl-part-trailing');
  const last = [...root.children].filter(child => child.getClientRects().length > 0).at(-1);
  if (last?.classList.contains('dsbl-part-collapsed')) last.classList.add('dsbl-part-trailing');
}

export function forgetMessage(messageId) {
  let changed = false;
  for (const s of [store(), autoStore()]) {
    for (const key of [...s]) {
      if (!key.startsWith(`${messageId}:`)) continue;
      s.delete(key);
      changed = true;
    }
  }
  if (changed) persist();
}

export function pruneCollapsedState() {
  let changed = false;
  for (const s of [store(), autoStore()]) {
    for (const key of [...s]) {
      if (game.messages.has(key.split(':')[0])) continue;
      s.delete(key);
      changed = true;
    }
  }
  if (changed) persist();
}

export const isStored = key => store().has(key);

export function setStored(key, on) {
  if (on) store().add(key);
  else store().delete(key);
  persist();
}
