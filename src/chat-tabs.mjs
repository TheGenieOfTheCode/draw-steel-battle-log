import { MODULE_ID } from './collapse.mjs';
import { queryAll, toggleBodyClass, onEveryDocument } from './windows.mjs';
import { tip, tipAttrs, setTip } from './tips.mjs';

const TABS = ['all', 'abilities', 'logs', 'chat'];
const L = (key, data) => (data ? game.i18n.format(`DSBL.ChatTabs.${key}`, data) : game.i18n.localize(`DSBL.ChatTabs.${key}`));
const setting = (key) => game.settings.get(MODULE_ID, key);
const current = () => (TABS.includes(setting('chatTab')) ? setting('chatTab') : 'all');
const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));

const ITEMS = {
  all: ['li.chat-message:not(.dsbl-covered)', 'li.dsbl-res-row'],
  abilities: ['li.chat-message.dsbl-ability:not(.dsbl-covered)'],
  logs: ['li.dsbl-res-row', 'li.dsbl-stub'],
  chat: ['li.chat-message.dsbl-talk:not(.dsbl-covered)'],
};

const keyOf = (li) => li.dataset.messageId ?? li.dataset.dsblRes ?? li.dataset.dsblStub ?? null;

const seen = new Set();

let primed = false;

export const isAbilityMessage = (message) => [...(message?.system?.parts?.contents ?? [])].some((p) => p.type === 'abilityUse');

const TALK_STYLES = () => [CONST.CHAT_MESSAGE_STYLES.IC, CONST.CHAT_MESSAGE_STYLES.OOC, CONST.CHAT_MESSAGE_STYLES.EMOTE];
const isTalk = (message) => !!message && !message.rolls?.length && !isAbilityMessage(message) && TALK_STYLES().includes(message.style);

const stubParts = (message) => {
  const part = [...(message.system?.parts?.contents ?? [])].find((p) => p.type === 'abilityUse');
  const ability = (part?.abilityUuid ? fromUuidSync(part.abilityUuid)?.name : null) ?? message.title ?? '';
  const name = message.speaker?.alias ?? message.speakerActor?.name ?? '';
  const targets = (message.flags?.['draw-steel-target-damage']?.state?.targets ?? []).map((t) => t.name).filter(Boolean);
  const scene = game.scenes.get(message.speaker?.scene);
  const img = scene?.tokens.get(message.speaker?.token)?.texture?.src ?? message.speakerActor?.img ?? null;
  const text = targets.length ? L('usedOn', { name, ability, targets: targets.join(', ') }) : L('used', { name, ability });
  return { img, text };
};

const fillStub = (stub, message) => {
  const { img, text } = stubParts(message);
  if (stub.dataset.dsblStubText === text) return;
  stub.dataset.dsblStubText = text;
  stub.innerHTML = (img ? `<img class="dsbl-stub-face" src="${esc(img)}" alt="">` : '') + `<span class="dsbl-stub-text">${esc(text)}</span>`;
};

const makeStub = (doc, message) => {
  const stub = doc.createElement('li');
  stub.className = 'message dsbl-stub';
  stub.dataset.dsblStub = message.id;
  setTip(stub, tip('stub'));
  return stub;
};

const syncLog = (log) => {
  for (const li of log.querySelectorAll(':scope > li.chat-message')) {
    const message = game.messages.get(li.dataset.messageId);
    const ability = isAbilityMessage(message);
    if (li.classList.contains('dsbl-ability') !== ability) li.classList.toggle('dsbl-ability', ability);
    const talk = isTalk(message);
    if (li.classList.contains('dsbl-talk') !== talk) li.classList.toggle('dsbl-talk', talk);
    if (!ability) continue;
    let stub = log.querySelector(`:scope > li.dsbl-stub[data-dsbl-stub="${CSS.escape(message.id)}"]`);
    stub ??= makeStub(log.ownerDocument, message);
    fillStub(stub, message);
    if (li.nextElementSibling !== stub) li.after(stub);
  }
  for (const stub of log.querySelectorAll(':scope > li.dsbl-stub')) {
    if (!log.querySelector(`:scope > li.chat-message[data-message-id="${CSS.escape(stub.dataset.dsblStub)}"]`)) stub.remove();
  }
};

const logs = () => queryAll('.chat-log').filter((l) => !l.closest('#chat-notifications'));

const keysOf = (tab) => new Set(logs().flatMap((log) => [...log.querySelectorAll(ITEMS[tab].map((s) => `:scope > ${s}`).join(', '))]).map(keyOf).filter(Boolean));

const syncCounts = () => {
  const keys = Object.fromEntries(TABS.map((t) => [t, keysOf(t)]));
  if (!primed && queryAll('.chat-log > li').length) {
    for (const t of TABS) for (const k of keys[t]) seen.add(k);
    primed = true;
  }
  for (const k of keys[current()]) seen.add(k);
  for (const nav of queryAll('.dsbl-chat-tabs')) {
    for (const t of TABS) {
      const n = [...keys[t]].filter((k) => !seen.has(k)).length;
      const badge = nav.querySelector(`[data-dsbl-tab="${t}"] .dsbl-tab-count`);
      if (badge && badge.textContent !== (n ? String(n) : '')) badge.textContent = n ? String(n) : '';
    }
  }
};

let _timer = null;
const scheduleSync = () => {
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    for (const log of logs()) syncLog(log);
    syncCounts();
  }, 80);
};

const showsTabs = () => setting('resourceLog') || setting('effectLog');

const buildNav = (doc) => {
  const nav = doc.createElement('nav');
  nav.className = 'tabs dsbl-chat-tabs';
  nav.setAttribute('role', 'tablist');
  nav.innerHTML = TABS.map((t) => `<a class="item" role="tab" data-dsbl-tab="${t}" data-tooltip-direction="LEFT" ${tipAttrs(tip(`tab${t[0].toUpperCase()}${t.slice(1)}`))}>${esc(L(t))}<span class="dsbl-tab-count"></span></a>`).join('');
  nav.addEventListener('click', (event) => {
    const t = event.target.closest('[data-dsbl-tab]')?.dataset.dsblTab;
    if (t && t !== current()) game.settings.set(MODULE_ID, 'chatTab', t);
  });
  return nav;
};

const syncTabs = () => {
  const tab = current();
  for (const t of TABS) toggleBodyClass(`dsbl-tab-${t}`, showsTabs() && t === tab);
  for (const nav of queryAll('.dsbl-chat-tabs')) {
    for (const item of nav.querySelectorAll('[data-dsbl-tab]')) {
      const on = item.dataset.dsblTab === tab;
      item.classList.toggle('active', on);
      item.setAttribute('aria-selected', String(on));
    }
  }
};

export const addChatTabs = () => {
  for (const log of logs()) {
    const host = log.closest('.chat-scroll') ?? log;
    const nav = host.parentElement?.querySelector(':scope > .dsbl-chat-tabs');
    if (!showsTabs()) { nav?.remove(); continue; }
    if (!nav) host.before(buildNav(log.ownerDocument));
  }
  syncTabs();
  scheduleSync();
};

const _watched = new WeakSet();
const watchLogs = () => {
  for (const log of logs()) {
    if (_watched.has(log)) continue;
    _watched.add(log);
    new MutationObserver(scheduleSync).observe(log, { childList: true });
  }
};

const openStub = async (stub) => {
  const id = stub.dataset.dsblStub;
  const doc = stub.ownerDocument;
  if (current() !== 'all') await game.settings.set(MODULE_ID, 'chatTab', 'all');
  requestAnimationFrame(() => {
    const li = doc.querySelector(`.chat-log > li.chat-message[data-message-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    li.classList.add('dsbl-flash');
    setTimeout(() => li.classList.remove('dsbl-flash'), 1800);
  });
};

export function registerChatTabs() {
  game.settings.register(MODULE_ID, 'chatTab', {
    scope: 'client', config: false, type: String, default: 'all',
    onChange: () => { syncTabs(); syncCounts(); ui.chat?.scrollBottom?.(); },
  });
  Hooks.on('renderChatLog', () => { addChatTabs(); watchLogs(); });
  Hooks.on('renderChatPopout', () => { addChatTabs(); watchLogs(); });
  Hooks.on('updateChatMessage', scheduleSync);
  Hooks.once('ready', () => { addChatTabs(); watchLogs(); });
  onEveryDocument((doc) => doc.addEventListener('click', (event) => {
    const stub = event.target.closest?.('li.dsbl-stub');
    if (stub) openStub(stub);
  }));
}
