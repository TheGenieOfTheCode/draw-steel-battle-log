import { MODULE_ID } from './collapse.mjs';
import { onEveryDocument } from './windows.mjs';

const ROW = 'dsbl-load-older';
const byButton = () => game.settings.get(MODULE_ID, 'loadOlderMessages') === 'button';

let _scrolling = false;

export const registerLoadOlder = () => {
  onEveryDocument((doc) => doc.addEventListener('scroll', (event) => {
    if (!event.target?.classList?.contains('chat-scroll')) return;
    _scrolling = true;
    setTimeout(() => { _scrolling = false; });
  }, { capture: true, passive: true }));

  const wrapper = function (wrapped, ...args) {
    if (_scrolling && byButton()) return Promise.resolve();
    return wrapped(...args);
  };
  const target = 'foundry.applications.sidebar.tabs.ChatLog.prototype.renderBatch';
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, target, wrapper, 'MIXED');
    return;
  }
  const proto = foundry.applications.sidebar.tabs.ChatLog.prototype;
  const original = proto.renderBatch;
  proto.renderBatch = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
};

const olderCount = (log) => {
  const first = log.querySelector(':scope > .chat-message[data-message-id]');
  const messages = game.messages.contents;
  const end = first ? messages.findIndex((m) => m.id === first.dataset.messageId) : messages.length;
  let n = 0;
  for (let i = 0; i < end; i++) if (messages[i].visible) n++;
  return n;
};

const loadOlder = async (log, row) => {
  const scroller = log.closest('.chat-scroll') ?? log;
  const below = row.nextElementSibling;
  const above = below ? below.offsetTop - scroller.scrollTop : 0;
  row.querySelector('button').disabled = true;
  const owner = [...foundry.applications.instances.values()].find((a) => a instanceof foundry.applications.sidebar.tabs.ChatLog && a.element?.contains(log)) ?? ui.chat;
  await owner.renderBatch(CONFIG.ChatMessage.batchSize);
  const top = log.querySelector(':scope > .dsbl-log-top');
  if (top) log.prepend(top);
  top ? top.after(row) : log.prepend(row);
  syncLoadOlder(log);
  if (below?.isConnected) scroller.scrollTop = below.offsetTop - above;
};

export const syncLoadOlder = (log) => {
  let row = log.querySelector(`:scope > .${ROW}`);
  const count = byButton() ? olderCount(log) : 0;
  if (!count) { row?.remove(); return; }
  if (!row) {
    row = document.createElement('li');
    row.className = ROW;
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => loadOlder(log, row));
    row.append(button);
  }
  const button = row.querySelector('button');
  button.disabled = false;
  button.textContent = game.i18n.format('DSBL.loadOlder.button', { count: Math.min(count, CONFIG.ChatMessage.batchSize) });
  button.title = game.i18n.format('DSBL.loadOlder.title', { count });
  const top = log.querySelector(':scope > .dsbl-log-top');
  if (top ? top.nextElementSibling !== row : log.firstElementChild !== row) top ? top.after(row) : log.prepend(row);
};
