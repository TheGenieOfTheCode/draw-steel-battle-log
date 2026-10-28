import { MODULE_ID } from './collapse.mjs';
import { tokenOf, combatOf, hiddenFromPlayers, isParty, whoFor, faceStack } from './resource-log.mjs';
import { isDirector } from './director.mjs';
import { onEveryDocument } from './windows.mjs';
import { tip as richTip, tipAttrs, setTip } from './tips.mjs';

const LOG = 'effectLogEntries';
const MAX_ENTRIES = 600;
const GROUP_MS = 1500;
const UNDO_MS = 2000;
const SAVE_MS = 6000;

const setting = (key) => game.settings.get(MODULE_ID, key);
const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));
const L = (key, data) => (data ? game.i18n.format(`DSBL.EffectLog.${key}`, data) : game.i18n.localize(`DSBL.EffectLog.${key}`));

export const readEffectLog = () => {
  const list = setting(LOG);
  return Array.isArray(list) ? list : [];
};

let _currentTurn = () => null;
let _draft = null;
let _flush = null;

let _writing = null;
const draftList = () => {
  if (!_draft) _draft = foundry.utils.deepClone(_writing ?? readEffectLog());
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
    _writing = list;
    try { await game.settings.set(MODULE_ID, LOG, list, { dsblOwn: true }); }
    finally { if (_writing === list) _writing = null; }
  }, 200);
};

Hooks.on('updateSetting', (setting, _changes, options) => {
  if (setting.key !== `${MODULE_ID}.${LOG}` || options?.dsblOwn) return;
  _draft = null;
  _writing = null;
});

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

const gmOnly = (effect) => !!(flagsOf(effect, MODULE_ID).gmOnly || flagsOf(effect, 'draw-steel-ctlib').gmOnly
  || flagsOf(effect, CT).expiryReminderFor || flagsOf(effect, 'draw-steel-triggers').abilityUse);

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
    actor = actorFrom(ct.judgement?.actorId ?? ct.mark?.actorId ?? ct.flatAppliedSource?.actorId)
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
  return !!(ct.judgement || ct.mark || ct.flatAppliedFrom);
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
  const target = { effect: key, actor: actor.uuid, ...whoFor(actor, token, combat), hidden: hiddenFromPlayers(token) || gmOnly(effect) };
  const party = isParty(actor);
  const shown = party || publicEffect(effect, source);
  const after = anchor();
  const turn = _currentTurn();
  const kind = isMinion(actor) ? (token?.actorId ?? actor.id) : actor.uuid;
  const group = [phase, reason ?? '', effect.name, source?.name ?? '', source?.ability ?? '', party, shown, kind].join('|');

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

const markSaved = (matches, messageId) => {
  const list = draftList();
  const now = Date.now();
  for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
    const e = list[i];
    if (e.phase !== 'end' || now - e.at > SAVE_MS) continue;
    if (!matches(e)) continue;
    e.reason = 'saved';
    if (messageId) e.after = messageId;
    scheduleFlush();
    return true;
  }
  return false;
};

const _ended = new Map();

const coverEndMessage = (message) => {
  const effectUuid = message.flags?.[CT]?.grabEnded?.effectUuid;
  if (!effectUuid) return false;
  const list = draftList();
  const now = Date.now();
  for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
    const e = list[i];
    if (e.phase !== 'end' || now - e.at > SAVE_MS) continue;
    if (!e.targets.some((t) => t.effect === effectUuid)) continue;
    e.covers = [...new Set([...(e.covers ?? []), message.id])];
    scheduleFlush();
    return true;
  }
  return false;
};

export const effectCovers = () => {
  const out = new Set();
  if (!setting('effectLog')) return out;
  for (const e of readEffectLog()) {
    if (!visibleEffect(e)) continue;
    for (const id of e.covers ?? []) out.add(id);
  }
  return out;
};

export const coversEnd = (message) => !!message.flags?.[CT]?.grabEnded;

const _moveSources = [];

export const registerMoveSource = (source) => {
  if (typeof source?.flags === 'function') _moveSources.push(source);
};

const moveSourceOf = (message) => (message ? _moveSources.find((s) => s.flags(message)) : null);

const moveFlags = (message) => moveSourceOf(message)?.flags(message) ?? message.flags?.[CT];

export const coversMove = (message) => {
  const flags = moveFlags(message);
  return !!flags?.fallLog || (!!flags?.isFmUndo && !!(flags.fmLog || flags.entries?.some?.((m) => m?.fmLog)));
};

const asMove = (flags) => (flags?.fallLog
  ? [{ ...flags.fallLog, fmLog: { movement: 'fall', moved: flags.fallLog.fell, vertical: false, source: null } }]
  : null);

const noteForcedMovement = (message) => {
  const flags = moveFlags(message);
  if ((!flags?.isFmUndo && !flags?.fallLog) || flags.isUndone) return false;
  const moves = (asMove(flags) ?? (flags.isCombined ? flags.entries ?? [] : [flags])).filter((m) => m?.fmLog && m.targetTokenId);
  const targets = [];
  let inCombat = false;
  for (const m of moves) {
    const token = game.scenes.get(m.targetSceneId)?.tokens.get(m.targetTokenId) ?? null;
    const actor = token?.actor;
    if (!actor) continue;
    const combat = combatOf(token);
    inCombat ||= !!combat;
    targets.push({ actor: actor.uuid, ...whoFor(actor, token, combat), hidden: hiddenFromPlayers(token), moved: m.fmLog.moved });
  }
  if (!targets.length || (!inCombat && !setting('resourceLogOutOfCombat'))) return false;
  const first = moves[0].fmLog;
  const lines = String(message.content ?? '').split(/<br\s*\/?>|<\/li>/i).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  draftList().push({
    id: foundry.utils.randomID(),
    kind: 'fm',
    after: message.id,
    turn: _currentTurn(),
    at: Date.now(),
    movement: first.movement,
    vertical: !!first.vertical,
    source: first.source ?? null,
    targets,
    lines,
    party: targets.some((t) => t.party),
    shown: true,
    hidden: targets.every((t) => t.hidden),
    covers: [message.id],
  });
  scheduleFlush();
  return true;
};

const noteUndoneMove = (message) => {
  const list = draftList();
  const mine = list.filter((e) => e.kind === 'fm' && e.covers?.includes(message.id));
  const original = mine.find((e) => !e.undo);
  if (!original || mine.some((e) => e.undo)) return;
  list.push({ ...foundry.utils.deepClone(original), id: foundry.utils.randomID(), undo: true, after: anchor(), turn: _currentTurn(), at: Date.now() });
  scheduleFlush();
};

const _moveLog = { undo: null, html: null };

export const registerMoveLog = (source) => {
  if (typeof source?.undo === 'function') _moveLog.undo = source.undo;
  if (typeof source?.html === 'function') _moveLog.html = source.html;
};

export const logMove = ({ key, tokenUuid, action = 'walk', moved = 0, strikes = [], blueprint = null }) => {
  const token = fromUuidSync(tokenUuid ?? '');
  const actor = token?.actor;
  if (!actor || !key) return false;
  const combat = combatOf(token);
  if (!combat && !setting('resourceLogOutOfCombat')) return false;
  const who = { actor: actor.uuid, ...whoFor(actor, token, combat), hidden: hiddenFromPlayers(token), moved };
  draftList().push({
    id: foundry.utils.randomID(),
    kind: 'move',
    key,
    tokenUuid,
    after: anchor(),
    turn: _currentTurn(),
    at: Date.now(),
    action,
    moved,
    strikes,
    blueprint,
    targets: [who],
    party: !!who.party,
    shown: true,
    hidden: who.hidden,
  });
  scheduleFlush();
  return true;
};

export const markMoveUndone = (key) => {
  const list = draftList();
  const original = list.find((e) => e.kind === 'move' && e.key === key && !e.undo);
  if (!original || list.some((e) => e.kind === 'move' && e.key === key && e.undo)) return false;
  list.push({ ...foundry.utils.deepClone(original), id: foundry.utils.randomID(), undo: true, blueprint: null, after: anchor(), turn: _currentTurn(), at: Date.now() });
  scheduleFlush();
  return true;
};

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

  Hooks.on('updateChatMessage', (message, changes) => {
    if (!isDirector()) return;
    if (foundry.utils.getProperty(changes, `flags.${CT}.isUndone`) === true || _moveSources.some((s) => s.undone?.(changes))) noteUndoneMove(message);
  });

  Hooks.on('createChatMessage', (message) => {
    if (!isDirector()) return;
    if (coverEndMessage(message)) return;
    if (setting('effectLog') && noteForcedMovement(message)) return;
    const parts = [...(message.system?.parts?.contents ?? message.system?.parts ?? [])];
    let linked = false;
    for (const part of parts) {
      if (part?.type === 'savingThrow' && part.effectUuid) {
        linked = markSaved((e) => e.targets.some((t) => t.effect === part.effectUuid), message.id) || linked;
      }
    }
    if (linked) return;

    const SaveRoll = globalThis.ds?.rolls?.SavingThrowRoll;
    const rolls = [...(message.rolls ?? []), ...parts.flatMap((p) => p?.rolls ?? [])];
    if (!SaveRoll || !rolls.some((r) => r instanceof SaveRoll)) return;
    const actor = ChatMessage.getSpeakerActor(message.speaker);
    if (!actor) return;
    markSaved((e) => (e.reason === 'saved' || e.expiry === 'save') && e.targets.some((t) => t.actor === actor.uuid), message.id);
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

  const faces = faceStack(e.targets.map(faceImg));
  const many = e.targets.length > 1;
  const names = many ? `${e.targets[0].name}s` : (e.targets[0]?.name ?? '');
  const short = many ? `${e.targets[0].short ?? e.targets[0].name}s` : (e.targets[0]?.short ?? names);

  const controls = game.user.isGM
    ? `<span class="dsbl-res-controls">`
      + `<a class="dsbl-res-control" data-dsbl-res-action="conceal" ${tipAttrs(richTip(e.hidden ? 'reveal' : 'conceal'))}><i class="fa-solid ${e.hidden ? 'fa-eye' : 'fa-eye-slash'}" inert></i></a>`
      + `<a class="dsbl-res-control" data-dsbl-res-action="delete" ${tipAttrs(richTip('delete'))}><i class="fa-solid fa-trash" inert></i></a>`
      + `</span>`
    : '';

  const reason = ends || e.reason === 'enabled' ? reasonText(e) : '';
  const tip = tipFor(e);
  li.innerHTML = `<span class="dsbl-res-who">${faces}<strong class="dsbl-res-name"${short !== names ? ` data-full="${esc(names)}" data-short="${esc(short)}"` : ''}>${esc(names)}</strong>${controls}</span>`
    + `<span class="dsbl-fx-what"${tip ? ` ${tipAttrs(richTip(ends ? 'effectEnded' : 'effectStarted', { title: e.name, html: tip.split('<br>').map((l) => `<p>${l}</p>`).join('') }))}` : ''}>`
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

const FM_ICONS = { push: 'fa-arrow-right-long', pull: 'fa-arrow-left-long', slide: 'fa-arrows-left-right', fall: 'fa-arrow-down-long' };

const movementLabel = (e) => {
  if (e.movement === 'fall') return L('fall');
  const cfg = globalThis.ds?.CONFIG?.abilities?.forcedMovement?.[e.movement];
  const key = cfg ? (e.vertical ? cfg.vertical : cfg.label) : null;
  return key ? game.i18n.localize(key) : e.movement.charAt(0).toUpperCase() + e.movement.slice(1);
};

export const fmRow = (e) => {
  const li = document.createElement('li');
  li.className = `message dsbl-res-row dsbl-fx-row dsbl-fm-row ${e.undo ? 'is-end' : 'is-start'}`;
  li.dataset.dsblRes = e.id;
  li.dataset.dsblLog = 'fx';

  const faces = faceStack(e.targets.map(faceImg));
  const many = e.targets.length > 1;
  const names = many ? `${e.targets[0].name}s` : (e.targets[0]?.name ?? '');
  const short = many ? `${e.targets[0].short ?? e.targets[0].name}s` : (e.targets[0]?.short ?? names);
  const message = game.messages.get(e.covers?.[0]);
  const canUndo = !e.undo && e.movement !== 'fall' && !!message && !moveFlags(message)?.isUndone && (game.user.isGM || message.isAuthor);
  const controls = (canUndo ? `<a class="dsbl-res-control" data-dsbl-fm-undo="${esc(message.id)}" ${tipAttrs(richTip('undoMove'))}><i class="fa-solid fa-rotate-left" inert></i></a>` : '')
    + (game.user.isGM
      ? `<a class="dsbl-res-control" data-dsbl-res-action="conceal" ${tipAttrs(richTip(e.hidden ? 'reveal' : 'conceal'))}><i class="fa-solid ${e.hidden ? 'fa-eye' : 'fa-eye-slash'}" inert></i></a>`
        + `<a class="dsbl-res-control" data-dsbl-res-action="delete" ${tipAttrs(richTip('delete'))}><i class="fa-solid fa-trash" inert></i></a>`
      : '');

  const label = movementLabel(e);
  const distances = [...new Set(e.targets.map((t) => t.moved))];
  const tipKey = e.movement === 'fall' ? 'fall' : 'forcedMovement';
  const title = `${label} ${distances.join(' / ')}`;
  const tip = tipAttrs(richTip(tipKey, { title, html: (e.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join('') }));
  li.innerHTML = `<span class="dsbl-res-who">${faces}<strong class="dsbl-res-name"${short !== names ? ` data-full="${esc(names)}" data-short="${esc(short)}"` : ''}>${esc(names)}</strong>${controls ? `<span class="dsbl-res-controls">${controls}</span>` : ''}</span>`
    + `<span class="dsbl-fx-what" ${tip}>`
    + `<i class="fa-solid ${e.undo ? 'fa-rotate-left' : e.vertical ? 'fa-arrow-up-long' : FM_ICONS[e.movement] ?? 'fa-arrow-right-long'} dsbl-fx-phase" inert></i>`
    + `<span class="dsbl-fx-name">${esc(label)} ${esc(distances.join(' / '))}</span>`
    + (e.undo ? `<span class="dsbl-fx-reason">${esc(L('reason.undone'))}</span>` : '')
    + (!e.undo && e.source?.src
      ? `<img class="dsbl-fx-source" src="${esc(e.source.src)}" alt=""${e.source.tokenId && e.source.sceneId ? ` data-ctlib-face="Scene.${esc(e.source.sceneId)}.Token.${esc(e.source.tokenId)}"` : ''}>`
      : '')
    + `</span>`;
  const full = moveSourceOf(message)?.html;
  if (full) {
    const what = li.querySelector('.dsbl-fx-what');
    what.addEventListener('pointerenter', () => {
      const html = full(message);
      if (!html) return;
      setTip(what, richTip(tipKey, { title, html }));
      const markup = what.dataset.dsctTip;
      if (!markup) return;
      setTimeout(() => {
        if (!what.matches(':hover')) return;
        const body = document.createElement('template');
        body.innerHTML = markup;
        game.tooltip.activate(what, { html: body.content, cssClass: what.dataset.dsctTipClass, direction: 'LEFT' });
      }, 0);
    });
  }
  if (e.hidden) li.classList.add('is-concealed');
  return li;
};

export const moveRow = (e) => {
  const li = document.createElement('li');
  li.className = `message dsbl-res-row dsbl-fx-row dsbl-fm-row dsbl-move-row ${e.undo ? 'is-end' : 'is-start'}`;
  li.dataset.dsblRes = e.id;
  li.dataset.dsblLog = 'fx';
  const t = e.targets[0] ?? {};
  const undone = readEffectLog().some((x) => x.kind === 'move' && x.key === e.key && x.undo);
  const canUndo = !e.undo && !undone && !!_moveLog.undo && (game.user.isGM || !!fromUuidSync(e.tokenUuid ?? '')?.isOwner);
  const controls = (canUndo ? `<a class="dsbl-res-control" data-dsbl-move-undo="${esc(e.key)}" data-token="${esc(e.tokenUuid)}" ${tipAttrs(richTip('undoMove'))}><i class="fa-solid fa-rotate-left" inert></i></a>` : '')
    + (game.user.isGM
      ? `<a class="dsbl-res-control" data-dsbl-res-action="conceal" ${tipAttrs(richTip(e.hidden ? 'reveal' : 'conceal'))}><i class="fa-solid ${e.hidden ? 'fa-eye' : 'fa-eye-slash'}" inert></i></a>`
        + `<a class="dsbl-res-control" data-dsbl-res-action="delete" ${tipAttrs(richTip('delete'))}><i class="fa-solid fa-trash" inert></i></a>`
      : '');
  const verb = game.i18n.has(`DSBL.EffectLog.move.${e.action}`) ? L(`move.${e.action}`) : L('move.walk');
  const title = `${verb} ${e.moved}`;
  const strikes = e.strikes ?? [];
  const lines = strikes.map((s) => L('move.strikeLine', { name: s.name, damage: s.damage ?? '' }));
  const tip = tipAttrs(richTip('movement', { title, html: lines.map((l) => `<p>${esc(l)}</p>`).join('') }));
  li.innerHTML = `<span class="dsbl-res-who">${faceStack([faceImg(t)])}<strong class="dsbl-res-name"${t.short && t.short !== t.name ? ` data-full="${esc(t.name)}" data-short="${esc(t.short)}"` : ''}>${esc(t.name ?? '')}</strong>${controls ? `<span class="dsbl-res-controls">${controls}</span>` : ''}</span>`
    + `<span class="dsbl-fx-what" ${tip}>`
    + `<i class="fa-solid ${e.undo ? 'fa-rotate-left' : e.action === 'shift' ? 'fa-shoe-prints' : 'fa-person-walking'} dsbl-fx-phase" inert></i>`
    + `<span class="dsbl-fx-name">${esc(title)}</span>`
    + (e.undo ? `<span class="dsbl-fx-reason">${esc(L('reason.undone'))}</span>` : '')
    + (!e.undo && strikes.length ? `<span class="dsbl-fx-reason">${esc((strikes.length === 1 ? L('move.strike') : L('move.strikes', { n: strikes.length })))}</span>` : '')
    + (!e.undo ? strikes.map((s) => (s.src ? `<img class="dsbl-fx-source" src="${esc(s.src)}" alt=""${s.tokenId && s.sceneId ? ` data-ctlib-face="Scene.${esc(s.sceneId)}.Token.${esc(s.tokenId)}"` : ''}>` : '')).join('') : '')
    + `</span>`;
  if (!e.undo && e.blueprint && _moveLog.html) {
    const what = li.querySelector('.dsbl-fx-what');
    what.addEventListener('pointerenter', () => {
      const html = _moveLog.html(e);
      if (!html) return;
      setTip(what, richTip('movement', { title, html: html + lines.map((l) => `<p>${esc(l)}</p>`).join('') }));
      const markup = what.dataset.dsctTip;
      if (!markup) return;
      setTimeout(() => {
        if (!what.matches(':hover')) return;
        const body = document.createElement('template');
        body.innerHTML = markup;
        game.tooltip.activate(what, { html: body.content, cssClass: what.dataset.dsctTipClass, direction: 'LEFT' });
      }, 0);
    });
  }
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

export const rewriteEffectLog = async (change) => {
  if (!game.user.isGM) return;
  const list = readEffectLog();
  const next = list.map(change).filter(Boolean);
  if (next.length !== list.length || next.some((e, i) => e !== list[i])) await game.settings.set(MODULE_ID, LOG, next);
};

onEveryDocument((doc) => doc.addEventListener('click', (event) => {
  const move = event.target.closest?.('[data-dsbl-move-undo]');
  if (move) {
    event.preventDefault();
    event.stopPropagation();
    _moveLog.undo?.({ key: move.dataset.dsblMoveUndo, tokenUuid: move.dataset.token });
    return;
  }
  const undo = event.target.closest?.('[data-dsbl-fm-undo]');
  if (undo) {
    event.preventDefault();
    event.stopPropagation();
    
    const button = doc.querySelector(`li.chat-message[data-message-id="${undo.dataset.dsblFmUndo}"] .dsct-undo-fm`);
    if (button && !button.disabled) button.click();
    else ui.notifications.warn(L('undoMoveMissing'));
    return;
  }
  const control = event.target.closest?.('[data-dsbl-res-action]');
  const row = control?.closest('.dsbl-res-row');
  if (!row || row.dataset.dsblLog !== 'fx') return;
  event.preventDefault();
  event.stopPropagation();
  editEffectEntry(row.dataset.dsblRes, control.dataset.dsblResAction);
}));

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
