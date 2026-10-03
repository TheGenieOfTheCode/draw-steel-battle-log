import { MODULE_ID } from './collapse.mjs';
import { tokenOf, combatOf, hiddenFromPlayers, isParty, whoFor } from './resource-log.mjs';

const LOG = 'effectLogEntries';
const MAX_ENTRIES = 600;
const GROUP_MS = 1500;
const UNDO_MS = 2000;
const SAVE_MS = 6000;

const setting = (key) => game.settings.get(MODULE_ID, key);
const isDirector = () => game.users.activeGM?.isSelf === true;
const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));
const L = (key, data) => (data ? game.i18n.format(`DSBL.EffectLog.${key}`, data) : game.i18n.localize(`DSBL.EffectLog.${key}`));

export const readEffectLog = () => {
  const list = setting(LOG);
  return Array.isArray(list) ? list : [];
};

let _currentTurn = () => null;
let _draft = null;
let _flush = null;
const draftList = () => {
  if (!_draft) _draft = foundry.utils.deepClone(readEffectLog());
  return _draft;
};
const scheduleFlush = () => {
  if (_flush) return;
  _flush = setTimeout(async () => {
    _flush = null;
    const list = _draft;
    _draft = null;
    if (!list) return;
    while (list.length > MAX_ENTRIES) list.shift();
    await game.settings.set(MODULE_ID, LOG, list);
  }, 200);
};

const CT = 'draw-steel-combat-tools';
const flagsOf = (effect, scope) => effect.flags?.[scope] ?? {};

const conditionIds = () => new Set(Object.keys(globalThis.ds?.CONFIG?.conditions ?? {}));
const isCondition = (effect) => {
  const ids = conditionIds();
  return [...(effect.statuses ?? [])].some((s) => ids.has(s));
};

const CT_INTERNAL_TYPES = new Set(['squad-label', 'triggered-action', 'sneaking', 'dsctWasHidden', 'int']);
const registeredStatus = (id) => CONFIG.statusEffects.some((s) => s.id === id);
export const isInternal = (effect) => {
  if (flagsOf(effect, MODULE_ID).noLog || flagsOf(effect, 'draw-steel-ctlib').noLog) return true;
  const ct = flagsOf(effect, CT);
  if (CT_INTERNAL_TYPES.has(ct.effectType)) return true;
  if (ct.ongoingRegionUuid || ct.peek || ct.isCrossfadeEffect || ct.grab || ct.coverImmunity) return true;
  if (flagsOf(effect, 'draw-steel-ctlib').coverImmunity) return true;
  if (effect.name === 'Size Advantage (Grab)' && !Object.keys(ct).length) return true;
  if ([...(effect.statuses ?? [])].some((s) => String(s).startsWith('dsct') && !registeredStatus(s))) return true;
  return false;
};

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
const isMinion = (actor) => !!actor.system?.isMinion;

const staminaStatusAllowed = (effect, actor) => {
  const statuses = effect.statuses ?? new Set();
  if (statuses.has(DEFEATED()) || statuses.has('dead')) return false;
  if (statuses.has('dying')) return actor.type === 'hero';
  if (statuses.has('winded')) return actor.type === 'hero' || !isMinion(actor);
  return true;
};

const loggable = (effect) => {
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return false;
  if (window._stageManagerResetting) return false;
  if (!setting('effectLog')) return false;
  if (isInternal(effect)) return false;
  return staminaStatusAllowed(effect, actor);
};

const faceOfActor = (actor) => {
  if (!actor) return null;
  const token = tokenOf(actor);
  return { name: String(token?.name ?? actor.name ?? '').trim(), src: token?.texture?.src ?? actor.img ?? null, tokenId: token?.id ?? null, sceneId: token?.parent?.id ?? null };
};

const actorFrom = (id) => (id ? (game.actors.get(id) ?? canvas.tokens?.placeables.find((t) => t.actor?.id === id)?.actor ?? null) : null);

export const sourceOf = (effect) => {
  let item = null;
  let actor = null;
  if (effect.origin) {
    const origin = fromUuidSync(effect.origin, { strict: false });
    if (origin instanceof Item) { item = origin; actor = origin.parent instanceof Actor ? origin.parent : null; }
    else if (origin instanceof Actor) actor = origin;
    else if (origin?.actor instanceof Actor) actor = origin.actor;
  }
  const fromUuidActor = (uuid) => {
    const doc = uuid ? fromUuidSync(uuid, { strict: false }) : null;
    return doc instanceof Actor ? doc : (doc?.actor ?? null);
  };
  if (!actor) {
    const ct = flagsOf(effect, CT);
    actor = actorFrom(ct.frightened?.sourceActorId ?? ct.taunted?.sourceActorId ?? ct.judgement?.actorId ?? ct.mark?.actorId ?? ct.flatAppliedSource?.actorId)
      ?? fromUuidActor(typeof effect.system?.source === 'string' ? effect.system.source : null);
  }
  if (!actor) {
    
    const changes = [...(effect.system?.changes ?? []), ...(effect.changes ?? [])];
    const imposed = changes.find((c) => /^system\.statuses\.[^.]+\.sources$/.test(c?.key ?? ''));
    actor = fromUuidActor(imposed?.value);
  }
  if (actor && actor === effect.parent) actor = null;
  const face = faceOfActor(actor);
  return face || item ? { ...(face ?? {}), ability: item?.name ?? null, isAbility: item?.type === 'ability' } : null;
};

const ctCondition = (effect) => {
  const ct = flagsOf(effect, CT);
  return !!(ct.frightened || ct.taunted || ct.judgement || ct.mark || ct.grabbed || ct.flatAppliedFrom);
};
const publicEffect = (effect, source) => isCondition(effect) || ctCondition(effect) || !!source?.isAbility || !!source?.ability;

const expiryKey = (effect) => effect.duration?.expiry ?? null;

const anchor = () => game.messages.contents.at(-1)?.id ?? null;

const noteEffect = (effect, phase, reason = null) => {
  const actor = effect.parent;
  const token = tokenOf(actor);
  const combat = combatOf(token);
  if (!combat && !setting('resourceLogOutOfCombat')) return;
  const list = draftList();
  const now = Date.now();
  const key = effect.uuid;

  if (phase === 'end') {
    for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
      const e = list[i];
      if (e.phase !== 'start' || now - e.at > UNDO_MS) continue;
      const at = e.targets.findIndex((t) => t.effect === key);
      if (at < 0) continue;
      e.targets.splice(at, 1);
      if (!e.targets.length) list.splice(i, 1);
      scheduleFlush();
      return;
    }
  }

  
  if (phase === 'start') {
    for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
      const e = list[i];
      if (e.phase !== 'end' || e.reason !== 'removed' || now - e.at > UNDO_MS || e.name !== effect.name) continue;
      const at = e.targets.findIndex((t) => t.actor === actor.uuid);
      if (at < 0) continue;
      e.targets.splice(at, 1);
      if (!e.targets.length) list.splice(i, 1);
      break;
    }
  }

  const source = phase === 'start' ? sourceOf(effect) : null;
  const target = { effect: key, actor: actor.uuid, ...whoFor(actor, token, combat), hidden: hiddenFromPlayers(token) };
  const party = isParty(actor);
  const shown = party || publicEffect(effect, source);
  const after = anchor();
  const turn = _currentTurn();
  const group = [phase, reason ?? '', effect.name, source?.name ?? '', source?.ability ?? '', party, shown].join('|');

  for (let i = list.length - 1; i >= Math.max(0, list.length - 20); i--) {
    const e = list[i];
    if (now - e.at > GROUP_MS) break;
    if (e.group !== group || e.after !== after) continue;
    e.targets.push(target);
    e.at = now;
    e.hidden = e.hidden && target.hidden;
    scheduleFlush();
    return;
  }

  list.push({
    id: foundry.utils.randomID(),
    kind: 'fx',
    group,
    after,
    turn,
    at: now,
    phase,
    reason,
    expiry: expiryKey(effect),
    name: effect.name,
    img: effect.img ?? null,
    condition: isCondition(effect),
    source,
    targets: [target],
    party,
    shown,
    hidden: target.hidden,
  });
  scheduleFlush();
};

const markSaved = (effectUuid) => {
  const list = draftList();
  const now = Date.now();
  for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
    const e = list[i];
    if (e.phase !== 'end' || now - e.at > SAVE_MS) continue;
    if (!e.targets.some((t) => t.effect === effectUuid)) continue;
    e.reason = 'saved';
    scheduleFlush();
    return true;
  }
  return false;
};

const _ended = new Map();

export const registerEffectRecording = ({ currentTurn }) => {
  _currentTurn = currentTurn;

  Hooks.on('createActiveEffect', (effect, options) => {
    if (!isDirector() || !loggable(effect) || effect.disabled) return;
    noteEffect(effect, 'start');
  });

  Hooks.on('updateActiveEffect', (effect, changes, options) => {
    if (!isDirector() || !loggable(effect)) return;
    if ('disabled' in changes) {
      noteEffect(effect, changes.disabled ? 'end' : 'start', changes.disabled ? 'disabled' : 'enabled');
      return;
    }
    if (foundry.utils.getProperty(changes, 'duration.expired') === true) {
      _ended.set(effect.uuid, Date.now());
      noteEffect(effect, 'end', effect.duration?.expiry === 'save' ? 'saved' : 'expired');
    }
  });

  Hooks.on('deleteActiveEffect', (effect, options) => {
    if (!isDirector() || !loggable(effect) || effect.disabled) return;
    const ended = _ended.get(effect.uuid);
    _ended.delete(effect.uuid);
    if (ended || effect.duration?.expired) return;
    noteEffect(effect, 'end', options?.ctlib?.endReason ?? options?.[MODULE_ID]?.endReason ?? 'removed');
  });

  Hooks.on('createChatMessage', (message) => {
    if (!isDirector()) return;
    for (const part of message.system?.parts?.contents ?? message.system?.parts ?? []) {
      if (part?.type === 'savingThrow' && part.effectUuid) markSaved(part.effectUuid);
    }
  });
};

export const visibleEffect = (e) => game.user.isGM || (!e.hidden && e.shown);

const REASONS = ['saved', 'expired', 'removed', 'cleansed', 'disabled', 'enabled'];

const reasonText = (e) => {
  if (e.reason === 'expired' && e.expiry) {
    const key = `DSBL.EffectLog.expiry.${e.expiry}`;
    const text = game.i18n.localize(key);
    if (text !== key) return text;
  }
  return REASONS.includes(e.reason) ? L(`reason.${e.reason}`) : '';
};

const tipFor = (e) => {
  const lines = [];
  if (e.phase === 'start') {
    if (e.source?.name && e.source?.ability) lines.push(L('fromAbility', { ability: e.source.ability, source: e.source.name }));
    else if (e.source?.name) lines.push(L('from', { source: e.source.name }));
    else if (e.source?.ability) lines.push(L('by', { ability: e.source.ability }));
    if (e.reason === 'enabled') lines.push(L('reason.enabled'));
  } else {
    const why = reasonText(e);
    if (why) lines.push(why);
  }
  if (e.targets.length > 1) lines.push(e.targets.map((t) => t.name).join(', '));
  return lines.map(esc).join('<br>');
};

const faceImg = (t) => (t.src
  ? `<img class="dsbl-res-face" src="${esc(t.src)}" alt=""${t.tokenId && t.sceneId ? ` data-ctlib-face="Scene.${esc(t.sceneId)}.Token.${esc(t.tokenId)}"` : ''}>`
  : '');

export const effectRow = (e) => {
  const li = document.createElement('li');
  const ends = e.phase === 'end';
  li.className = `message dsbl-res-row dsbl-fx-row ${ends ? 'is-end' : 'is-start'}${e.condition ? ' is-condition' : ''}`;
  li.dataset.dsblRes = e.id;
  li.dataset.dsblLog = 'fx';

  const shown = e.targets.slice(0, 3);
  const faces = `<span class="dsbl-fx-faces">${shown.map(faceImg).join('')}${e.targets.length > 3 ? `<span class="dsbl-fx-more">+${e.targets.length - 3}</span>` : ''}</span>`;
  const names = e.targets.length > 1 ? L('many', { more: e.targets.length - 1, name: e.targets[0].short ?? e.targets[0].name }) : (e.targets[0]?.name ?? '');
  const short = e.targets.length > 1 ? names : (e.targets[0]?.short ?? names);

  const controls = game.user.isGM
    ? `<span class="dsbl-res-controls">`
      + `<a class="dsbl-res-control" data-dsbl-res-action="conceal" data-tooltip="${esc(game.i18n.localize(e.hidden ? 'DSBL.ResourceLog.reveal' : 'DSBL.ResourceLog.conceal'))}"><i class="fa-solid ${e.hidden ? 'fa-eye' : 'fa-eye-slash'}" inert></i></a>`
      + `<a class="dsbl-res-control" data-dsbl-res-action="delete" data-tooltip="${esc(game.i18n.localize('DSBL.ResourceLog.delete'))}"><i class="fa-solid fa-trash" inert></i></a>`
      + `</span>`
    : '';

  const reason = ends || e.reason === 'enabled' ? reasonText(e) : '';
  const tip = tipFor(e);
  li.innerHTML = `<span class="dsbl-res-who">${faces}<strong class="dsbl-res-name"${short !== names ? ` data-full="${esc(names)}" data-short="${esc(short)}"` : ''}>${esc(names)}</strong>${controls}</span>`
    + `<span class="dsbl-fx-what"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>`
    + `<i class="fa-solid ${ends ? 'fa-minus' : 'fa-plus'} dsbl-fx-phase" inert></i>`
    + (e.img ? `<img class="dsbl-fx-img" src="${esc(e.img)}" alt="">` : '')
    + `<span class="dsbl-fx-name">${esc(e.name)}</span>`
    + (reason ? `<span class="dsbl-fx-reason">${esc(reason)}</span>` : '')
    + (e.phase === 'start' && e.source?.src
      ? `<img class="dsbl-fx-source" src="${esc(e.source.src)}" alt=""${e.source.tokenId && e.source.sceneId ? ` data-ctlib-face="Scene.${esc(e.source.sceneId)}.Token.${esc(e.source.tokenId)}"` : ''}>`
      : '')
    + `</span>`;
  if (e.hidden) li.classList.add('is-concealed');
  return li;
};

export const editEffectEntry = async (id, change) => {
  if (!game.user.isGM) return;
  const list = foundry.utils.deepClone(readEffectLog());
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return;
  if (change === 'delete') list.splice(i, 1);
  else list[i].hidden = !list[i].hidden;
  await game.settings.set(MODULE_ID, LOG, list);
};

document.addEventListener('click', (event) => {
  const control = event.target.closest?.('[data-dsbl-res-action]');
  const row = control?.closest('.dsbl-res-row');
  if (!row || row.dataset.dsblLog !== 'fx') return;
  event.preventDefault();
  event.stopPropagation();
  editEffectEntry(row.dataset.dsblRes, control.dataset.dsblResAction);
});

export const pruneEffectLog = async (survivingAnchor, empty) => {
  if (!isDirector()) return;
  const kept = [];
  let changed = false;
  for (const e of readEffectLog()) {
    if (e.after !== null && !game.messages.has(e.after)) {
      const moved = survivingAnchor(e.after);
      if (moved === null && empty) { changed = true; continue; }
      if (moved !== e.after) { kept.push({ ...e, after: moved }); changed = true; continue; }
    }
    if (e.after === null && empty) { changed = true; continue; }
    kept.push(e);
  }
  if (changed) await game.settings.set(MODULE_ID, LOG, kept);
};
