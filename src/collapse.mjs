const STORE_KEY = 'draw-steel-chat-polish.collapsed';

let _store = null;

function store() {
  if (_store) return _store;
  try {
    _store = new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'));
  } catch {
    _store = new Set();
  }
  return _store;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...store()]));
  } catch {
    
  }
}

const keyFor = (messageId, index) => `${messageId}:${index}`;

export function makeAbilitiesCollapsible(message, html) {
  const embeds = html.querySelectorAll('document-embed.draw-steel.ability');

  embeds.forEach((embed, index) => {
    const name = embed.querySelector(':scope > h5');
    if (!name) return;

    const key = keyFor(message.id, index);

    name.classList.add('dscp-ability-name');
    if (!name.querySelector('.dscp-caret')) {
      const caret = document.createElement('i');
      caret.className = 'fa-solid fa-caret-down dscp-caret';
      caret.setAttribute('inert', '');
      name.prepend(caret);
    }

    setCollapsed(embed, store().has(key));

    name.addEventListener('click', event => {
      if (event.target.closest('a')) return;
      const collapsed = !embed.classList.contains('dscp-collapsed');
      setCollapsed(embed, collapsed);
      if (collapsed) store().add(key);
      else store().delete(key);
      persist();
    });
  });
}

function setCollapsed(embed, collapsed) {
  embed.classList.toggle('dscp-collapsed', collapsed);

  
  
  if (!embed.parentElement?.classList.contains('message-part-html')) return;
  embed.closest('[data-message-part]')?.classList.toggle('dscp-part-collapsed', collapsed);

  syncSiblingPanels(embed.closest('[data-message-id]'));
}

function syncSiblingPanels(root) {
  if (!root) return;
  const cards = root.querySelectorAll('.message-part-html > document-embed.draw-steel.ability');
  const hide = cards.length > 0 && [...cards].every(card => card.classList.contains('dscp-collapsed'));
  root.classList.toggle('dscp-hide-panels', hide);
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
  for (const marked of root.querySelectorAll('.dscp-part-trailing')) marked.classList.remove('dscp-part-trailing');
  const last = [...root.children].filter(child => child.getClientRects().length > 0).at(-1);
  if (last?.classList.contains('dscp-part-collapsed')) last.classList.add('dscp-part-trailing');
}

export function forgetMessage(messageId) {
  const s = store();
  let changed = false;
  for (const key of [...s]) {
    if (key.startsWith(`${messageId}:`)) {
      s.delete(key);
      changed = true;
    }
  }
  if (changed) persist();
}

export function pruneCollapsedState() {
  const s = store();
  let changed = false;
  for (const key of [...s]) {
    if (!game.messages.has(key.split(':')[0])) {
      s.delete(key);
      changed = true;
    }
  }
  if (changed) persist();
}
