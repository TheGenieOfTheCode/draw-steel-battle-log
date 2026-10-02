import { MODULE_ID } from './collapse.mjs';

const setting = key => game.settings.get(MODULE_ID, key);
const L = (key, data) => data ? game.i18n.format(`DSBL.Speech.${key}`, data) : game.i18n.localize(`DSBL.Speech.${key}`);
const esc = value => foundry.utils.escapeHTML(String(value ?? ''));

const DEFAULT_AVATAR = 'icons/svg/mystery-man.svg';
const BLEND_GAP_MS = 10 * 60 * 1000;
const STYLES = () => CONST.CHAT_MESSAGE_STYLES;

function userTint(user) {
  const c = user?.color;
  return c?.css ?? (c ? String(c) : '#8a8a8a');
}

function faceFor({ token = null, actor = null, user = null } = {}) {
  if (token) return { src: token.texture?.src ?? token.actor?.img, tokenUuid: token.uuid, name: token.name };
  if (actor) {
    const placed = actor.getActiveTokens?.(false, true)?.find(t => t.parent === canvas.scene) ?? null;
    return { src: placed?.texture?.src ?? actor.prototypeToken?.texture?.src ?? actor.img, tokenUuid: placed?.uuid ?? null, name: actor.name };
  }
  const avatar = user?.avatar;
  if (avatar && avatar !== DEFAULT_AVATAR) return { src: avatar, name: user?.name };
  return { src: DEFAULT_AVATAR, tint: userTint(user), name: user?.name };
}

function faceHTML(face) {
  const token = face.tokenUuid ? ` data-ctlib-face="${esc(face.tokenUuid)}" data-ctlib-face-name="${esc(face.name)}"` : '';
  if (face.tint) {
    const src = esc(foundry.utils.getRoute(face.src));
    return `<span class="dsbl-speech-face is-tinted"${token}><span style="background: ${esc(face.tint)}; -webkit-mask-image: url('${src}'); mask-image: url('${src}')"></span></span>`;
  }
  return `<img class="dsbl-speech-face"${token} src="${esc(face.src)}" alt="">`;
}

Hooks.once('ready', () => game.modules.get('draw-steel-ctlib')?.api?.activateFaces?.(document.body));

const choice = () => setting('speakAs') ?? { kind: 'selected' };

function resolveChoice(pick = choice()) {
  const self = () => ({
    speaker: { scene: null, actor: null, token: null, alias: game.user.name },
    face: faceFor({ user: game.user }),
    name: game.user.name,
    character: false,
  });
  const ofToken = doc => ({
    speaker: ChatMessage.getSpeaker({ token: doc }),
    face: faceFor({ token: doc }),
    name: doc.name,
    character: true,
  });
  if (pick.kind === 'self') return self();
  if (pick.kind === 'token') {
    const doc = fromUuidSync(pick.id ?? '');
    if (doc?.actor) return ofToken(doc);
  }
  if (pick.kind === 'actor') {
    const actor = game.actors.get(pick.id ?? '');
    if (actor?.isOwner) {
      const placed = actor.getActiveTokens?.(false, true)?.find(t => t.parent === canvas.scene);
      if (placed) return ofToken(placed);
      return { speaker: ChatMessage.getSpeaker({ actor }), face: faceFor({ actor }), name: actor.name, character: true };
    }
  }
  const controlled = canvas.tokens?.controlled ?? [];
  return controlled.length === 1 && controlled[0].actor ? ofToken(controlled[0].document) : self();
}

let _pending = null;
const ROLL_COMMAND = /^\/(r|roll|gmr|gmroll|br|broll|blindroll|sr|selfroll|pr|publicroll|macro|m)\b/i;

Hooks.on('chatMessage', (_log, text, chatData) => {
  _pending = null;
  if (!setting('speakerPicker') || ROLL_COMMAND.test(String(text).trim())) return;
  _pending = { ...resolveChoice(), at: Date.now() };
  if (chatData) chatData.speaker = _pending.speaker;
});

Hooks.on('preCreateChatMessage', (doc, _data, _options, userId) => {
  const pending = _pending;
  _pending = null;
  if (!pending || userId !== game.user.id || Date.now() - pending.at > 2000) return;
  if (doc.rolls?.length || doc.system?.parts?.size) return;
  const styles = STYLES();
  const update = { speaker: pending.speaker };
  if (doc.style !== styles.EMOTE) update.style = pending.character ? styles.IC : styles.OOC;
  doc.updateSource(update);
});

const TARGETS_WORD = /@targets\b/gi;

Hooks.on('preCreateChatMessage', (doc, _data, _options, userId) => {
  if (userId !== game.user.id || !setting('mentionNames')) return;
  const content = doc.content ?? '';
  if (!content.match(TARGETS_WORD)) return;
  const links = targetLinks();
  if (!links) { ui.notifications.warn(L('targetsNone')); return; }
  doc.updateSource({ content: content.replace(TARGETS_WORD, links) });
});

function rowInner() {
  const now = resolveChoice();
  const pick = choice();
  const mode = pick.kind === 'selected' ? ` <span class="dsbl-speaker-mode">${esc(L('selected'))}</span>` : '';
  return `<button type="button" class="dsbl-speaker" data-tooltip="${esc(L('changeTooltip'))}">
      ${faceHTML(now.face)}
      <span class="dsbl-speaker-label">${esc(L('speakingAs'))} <strong>${esc(now.name)}</strong>${mode}</span>
      <i class="fa-solid fa-caret-up dsbl-speaker-caret" inert></i>
    </button>${setting('mentionNames') ? targetsButton() : ''}`;
}

function targetsButton() {
  const none = !game.user.targets.size;
  return `<button type="button" class="dsbl-targets"${none ? ' disabled' : ''} data-tooltip="${esc(L(none ? 'targetsNone' : 'targetsTooltip'))}">
      <i class="fa-solid fa-crosshairs" inert></i>
    </button>`;
}

function targetLinks() {
  return [...game.user.targets]
    .filter(t => t.document)
    .map(t => `@UUID[${t.document.uuid}]{${t.document.name.replace(/[{}[\]]/g, '')}}`)
    .join(', ');
}

function refreshRows() {
  for (const row of document.querySelectorAll('.dsbl-speaker-row')) row.innerHTML = rowInner();
}

let _refreshTimer = null;
export function scheduleSpeakerRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(refreshRows, 50);
}

function menuOptions() {
  const options = [
    { pick: { kind: 'selected' }, face: resolveChoice({ kind: 'selected' }).face, label: L('selected'), hint: L('selectedHint') },
    { pick: { kind: 'self' }, face: faceFor({ user: game.user }), label: L('yourself'), hint: game.user.name },
  ];
  const seenActors = new Set();
  const tokens = (canvas.tokens?.placeables ?? [])
    .filter(t => t.actor && t.document.isOwner && !t.document.hidden)
    .sort((a, b) => (b.actor.type === 'hero') - (a.actor.type === 'hero') || a.name.localeCompare(b.name));
  for (const t of tokens) {
    seenActors.add(t.actor.id);
    options.push({ pick: { kind: 'token', id: t.document.uuid }, face: faceFor({ token: t.document }), label: t.name });
  }
  for (const actor of game.actors.filter(a => a.type === 'hero' && a.isOwner && !seenActors.has(a.id))) {
    options.push({ pick: { kind: 'actor', id: actor.id }, face: faceFor({ actor }), label: actor.name });
  }
  return options;
}

function closeMenu() {
  document.querySelector('.dsbl-speaker-menu')?.remove();
}

function openMenu(row) {
  closeMenu();
  const current = JSON.stringify(choice());
  const options = menuOptions();
  const menu = document.createElement('div');
  menu.className = 'dsbl-speaker-menu';
  menu.innerHTML = options.map((o, i) => `<button type="button" class="dsbl-speaker-option${JSON.stringify(o.pick) === current ? ' is-current' : ''}" data-index="${i}">
      ${faceHTML(o.face)}<span class="dsbl-speaker-option-label">${esc(o.label)}</span>${o.hint ? `<span class="dsbl-speaker-option-hint">${esc(o.hint)}</span>` : ''}
    </button>`).join('');
  menu.addEventListener('click', async event => {
    const button = event.target.closest('.dsbl-speaker-option');
    if (!button) return;
    event.stopPropagation();
    closeMenu();
    await game.settings.set(MODULE_ID, 'speakAs', options[Number(button.dataset.index)].pick);
  });
  row.append(menu);
}

document.addEventListener('mousedown', event => {
  if (event.target.closest?.('.dsbl-targets')) event.preventDefault();
});

document.addEventListener('click', event => {
  const targets = event.target.closest?.('.dsbl-targets');
  if (targets) {
    event.preventDefault();
    const links = targetLinks();
    const input = document.querySelector('#chat-message .ProseMirror') ?? document.querySelector('#chat-message');
    if (!links || !input) return;
    input.focus();
    document.execCommand('insertText', false, `${links} `);
    return;
  }
  const button = event.target.closest?.('.dsbl-speaker');
  if (button) {
    event.preventDefault();
    const row = button.closest('.dsbl-speaker-row');
    if (row.querySelector('.dsbl-speaker-menu')) closeMenu();
    else openMenu(row);
    return;
  }
  if (!event.target.closest?.('.dsbl-speaker-menu')) closeMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

export function addSpeakerRow(controls = document.getElementById('chat-controls')) {
  if (!setting('speakerPicker') || !controls) return;
  if (controls.previousElementSibling?.classList.contains('dsbl-speaker-row')) return;
  const row = document.querySelector('.dsbl-speaker-row') ?? document.createElement('div');
  row.className = 'dsbl-speaker-row';
  row.innerHTML = rowInner();
  controls.before(row);
}

Hooks.on('renderChatInput', (_app, elements) => addSpeakerRow(elements?.['#chat-controls']));

Hooks.on('controlToken', scheduleSpeakerRefresh);
Hooks.on('targetToken', (user) => { if (user === game.user) scheduleSpeakerRefresh(); });
Hooks.on('canvasReady', scheduleSpeakerRefresh);
Hooks.on('updateUser', scheduleSpeakerRefresh);

function speakerOf(message) {
  const s = message.speaker ?? {};
  const token = s.token ? game.scenes.get(s.scene)?.tokens?.get(s.token) ?? null : null;
  const actor = !token && s.actor ? game.actors.get(s.actor) ?? null : null;
  return faceFor({ token, actor, user: message.author });
}

function playerOf(message) {
  const s = message.speaker ?? {};
  const token = s.token ? game.scenes.get(s.scene)?.tokens?.get(s.token) ?? null : null;
  const actor = token?.actor ?? (s.actor ? game.actors.get(s.actor) ?? null : null);
  if (!actor) return message.author;
  const id = actor.isToken ? actor.baseActor?.id : actor.id;
  return game.users.find(u => u.character?.id === id)
    ?? game.users.find(u => !u.isGM && actor.testUserPermission(u, 'OWNER'))
    ?? message.author;
}

function isSpeech(message, root) {
  const styles = STYLES();
  if (![styles.OOC, styles.IC, styles.EMOTE].includes(message.style)) return false;
  if (message.rolls?.length || message.system?.parts?.size || message.flavor) return false;
  if (message.type && message.type !== 'base') return false;
  const content = root.querySelector('.message-content');
  return !!content && !content.querySelector('document-embed, .dice-roll, table, button, section');
}

export function renderSpeech(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.dataset.dsblSpeech || !isSpeech(message, root)) return;
  const styles = STYLES();
  const kind = message.style === styles.EMOTE ? 'emote' : message.whisper?.length ? 'whisper' : 'say';
  const name = message.alias || message.author?.name || '';
  const face = speakerOf(message);
  const content = root.querySelector('.message-content');

  root.dataset.dsblSpeech = kind;
  root.dataset.dsblSpeaker = [message.author?.id, message.speaker?.token, message.speaker?.actor, name, kind].join('|');
  root.dataset.dsblTime = String(message.timestamp ?? 0);
  root.classList.add('dsbl-speech', `dsbl-speech-${kind}`);
  if (message.style !== styles.OOC) {
    const color = playerOf(message)?.color;
    if (color) root.style.borderColor = color.css ?? String(color);
  }

  const lead = document.createElement('span');
  lead.className = 'dsbl-speech-lead';
  if (kind === 'emote') {
    lead.innerHTML = faceHTML(face);
    const first = content.querySelector(':scope > p') ?? content;
    const text = first.innerHTML;
    const gap = text.match(/^\s*/)[0];
    if (name && text.startsWith(esc(name), gap.length)) first.innerHTML = `${gap}<strong>${esc(name)}</strong>${text.slice(gap.length + esc(name).length)}`;
  } else {
    lead.innerHTML = `${faceHTML(face)}<strong>${esc(name)}</strong> ${esc(L(kind === 'whisper' ? 'whispers' : 'says'))}`;
  }
  const first = content.querySelector(':scope > p') ?? content;
  first.prepend(lead, document.createTextNode(' '));
  if (setting('mentionNames')) markMentions(content);
  scheduleBlend();
}

function mentionTargets() {
  const byName = new Map();
  const add = (name, face) => {
    const key = String(name ?? '').trim().toLowerCase();
    if (key.length < 3) return;
    const known = byName.get(key);
    if (!known) byName.set(key, face);
    else if (known.tokenUuid && known.tokenUuid !== face.tokenUuid) byName.set(key, { ...known, tokenUuid: null });
  };
  for (const user of game.users) add(user.name, faceFor({ user }));
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.actor || token.document.hidden) continue;
    if (token.actor.type === 'hero' || token.actor.hasPlayerOwner) add(token.name, faceFor({ token: token.document }));
  }
  for (const actor of game.actors) if (actor.type === 'hero') add(actor.name, faceFor({ actor }));

  
  const firstNames = new Map();
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor?.type !== 'hero' || token.document.hidden) continue;
    const full = token.name.trim();
    const first = full.split(/\s+/)[0].toLowerCase();
    if (first === full.toLowerCase()) continue;
    const seen = firstNames.get(first);
    firstNames.set(first, seen && seen.full !== full ? { ambiguous: true } : { full, token });
  }
  for (const [first, hit] of firstNames) {
    if (!hit.ambiguous && !byName.has(first)) add(first, faceFor({ token: hit.token.document }));
  }
  return byName;
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

Hooks.on('canvasReady', () => {
  if (!setting('compactSpeech') || !setting('mentionNames')) return;
  for (const content of document.querySelectorAll('.chat-message.dsbl-speech .message-content')) markMentions(content);
});

function markTokenLinks(content) {
  for (const link of content.querySelectorAll('a.content-link[data-uuid]')) {
    const doc = fromUuidSync(link.dataset.uuid);
    if (!(doc instanceof foundry.documents.TokenDocument)) continue;
    const mention = document.createElement('span');
    mention.className = 'dsbl-mention';
    mention.innerHTML = `${faceHTML(faceFor({ token: doc }))}<strong>${esc(link.textContent.trim() || doc.name)}</strong>`;
    link.replaceWith(mention);
  }
}

function markMentions(content) {
  markTokenLinks(content);
  const targets = mentionTargets();
  if (!targets.size) return;
  const names = [...targets.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${names.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement.closest('.dsbl-speech-lead, .dsbl-mention, a, strong, b, code')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const text = node.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const match of text.matchAll(pattern)) {
      frag.append(text.slice(at, match.index));
      const mention = document.createElement('span');
      mention.className = 'dsbl-mention';
      mention.innerHTML = `${faceHTML(targets.get(match[0].toLowerCase()))}<strong>${esc(match[0])}</strong>`;
      frag.append(mention);
      at = match.index + match[0].length;
    }
    frag.append(text.slice(at));
    node.replaceWith(frag);
  }
}

function blend() {
  const on = setting('blendSpeech');
  for (const log of document.querySelectorAll('.chat-log')) {
    let prev = null;
    for (const li of log.children) {
      const speech = li.classList.contains('dsbl-speech');
      const cont = on && speech && prev && li.dataset.dsblSpeech !== 'emote'
        && prev.dataset.dsblSpeaker === li.dataset.dsblSpeaker
        && Math.abs(Number(li.dataset.dsblTime) - Number(prev.dataset.dsblTime)) < BLEND_GAP_MS;
      li.classList.toggle('dsbl-speech-cont', !!cont);
      prev = speech ? li : null;
    }
  }
}

let _blendTimer = null;
export function scheduleBlend() {
  clearTimeout(_blendTimer);
  _blendTimer = setTimeout(blend, 30);
}

const _watched = new WeakSet();
export function watchChatLogs() {
  for (const log of document.querySelectorAll('.chat-log')) {
    if (_watched.has(log)) continue;
    _watched.add(log);
    new MutationObserver(scheduleBlend).observe(log, { childList: true });
  }
}
