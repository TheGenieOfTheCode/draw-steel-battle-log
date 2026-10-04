import { MODULE_ID } from './collapse.mjs';

const LOG = 'resourceLogEntries';
const MAX_ENTRIES = 600;
const MERGE_MS = 8000;

const setting = (key) => game.settings.get(MODULE_ID, key);
const isDirector = () => game.users.activeGM?.isSelf === true;
const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));
const L = (key, data) => (data ? game.i18n.format(`DSBL.ResourceLog.${key}`, data) : game.i18n.localize(`DSBL.ResourceLog.${key}`));

export const readResourceLog = () => {
  const raw = setting(LOG);
  return Array.isArray(raw) ? raw : [];
};

const _known = new Map();
const _groups = new Map();
const _world = new Map();
const _incoming = new Map();
const RECOVERY_HEAL_MS = 4000;

const COMBAT_START_MS = 5000;
let _combatStartAt = 0;
const _why = new Map();
const takeWhy = (key, res) => {
  const why = _why.get(`${key}|${res}`) ?? null;
  _why.delete(`${key}|${res}`);
  return why;
};
const explaining = async (id, parts, run) => {
  _why.set(id, parts);
  try { return await run(); } finally { _why.delete(id); }
};
let _currentTurn = () => null;

const numberAt = (path) => (actor) => {
  const v = foundry.utils.getProperty(actor, path);
  return Number.isFinite(v) ? v : null;
};

const TRACKED = [
  ['stamina', 'system.stamina.value', numberAt('system.stamina.value')],
  ['temporary', 'system.stamina.temporary', numberAt('system.stamina.temporary')],
  ['heroic', 'system.hero.primary.value', numberAt('system.hero.primary.value')],
  ['surges', 'system.hero.surges', numberAt('system.hero.surges')],
  ['recovery', 'system.recoveries.value', numberAt('system.recoveries.value')],
];

const WORLD_KEYS = ['malice', 'heroTokens'];

const remember = (actor) => {
  if (!actor?.uuid) return;
  _known.set(actor.uuid, Object.fromEntries(TRACKED.map(([res, , read]) => [res, read(actor)])));
};

const rememberGroup = (group) => {
  const v = group?.system?.staminaValue;
  if (group?.uuid && Number.isFinite(v)) _groups.set(group.uuid, v);
};

const worldValue = (key) => {
  try {
    const v = game.settings.get('draw-steel', key)?.value;
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
};

const seedKnown = () => {
  for (const actor of game.actors) remember(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) if (token.actor && !token.actorLink) remember(token.actor);
  }
  for (const combat of game.combats) for (const group of combat.groups ?? []) rememberGroup(group);
  for (const key of WORLD_KEYS) _world.set(key, worldValue(key));
};

export const tokenOf = (actor) => {
  if (actor.isToken) return actor.token;
  const active = actor.getActiveTokens?.(false, true) ?? [];
  return active.find((t) => t.parent === canvas.scene) ?? active[0] ?? null;
};

export const combatOf = (token) => {
  if (!token) return null;
  return game.combats.contents.find((c) => c.started
    && c.combatants.some((cb) => cb.tokenId === token.id && cb.sceneId === token.parent?.id)) ?? null;
};

export const hiddenFromPlayers = (token) => {
  if (!token) return false;
  if (token.hidden) return true;
  return game.combats.contents.some((c) => c.combatants.some((cb) => cb.hidden
    && cb.tokenId === token.id && cb.sceneId === token.parent?.id));
};

const anyCombat = () => game.combats.contents.some((c) => c.started);

export const isParty = (actor) => actor.type === 'hero' || !!actor.hasPlayerOwner;

const shortName = (actor, token, combat) => {
  const full = String(token?.name ?? actor.name ?? '').trim();
  const words = full.split(/\s+/).filter(Boolean);
  if (actor.type === 'hero') return words[0] ?? full;
  if (words.length < 2) return full;

  const pool = combat
    ? combat.combatants.contents.map((cb) => cb.actor && !isParty(cb.actor) ? (cb.token?.name ?? cb.name) : null)
    : (token?.parent?.tokens.contents ?? []).map((t) => t.actor && !isParty(t.actor) ? t.name : null);
  const names = [...new Set(pool.filter(Boolean).map((n) => n.trim().toLowerCase()))];
  if (names.length < 2) return full;

  const shared = new Set();
  for (const word of new Set(words.map((w) => w.toLowerCase()))) {
    const hits = names.filter((n) => n.split(/\s+/).includes(word)).length;
    if (hits / names.length > 0.5) shared.add(word);
  }
  const kept = words.filter((w) => !shared.has(w.toLowerCase()));
  return kept.length ? kept.join(' ') : full;
};

export const whoFor = (actor, token, combat) => ({
  tokenId: token?.id ?? null,
  sceneId: token?.parent?.id ?? null,
  src: token?.texture?.src ?? actor.img ?? null,
  name: String(token?.name ?? actor.name ?? '').trim(),
  short: shortName(actor, token, combat),
  party: isParty(actor),
});

let _draft = null;
let _flush = null;

let _writing = null;

const draftList = () => {
  if (!_draft) _draft = foundry.utils.deepClone(_writing ?? readResourceLog());
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
    try { await game.settings.set(MODULE_ID, LOG, list); }
    finally { if (_writing === list) _writing = null; }
  }, 200);
};

const addCover = (e, messageId, delta) => {
  e.covers = [...new Set([...(e.covers ?? []), messageId])];
  const prev = e.coverDelta?.[messageId];
  e.coverDelta = { ...(e.coverDelta ?? {}), [messageId]: delta === 'all' || prev === 'all' ? 'all' : (Number(prev) || 0) + delta };
};

const lossOf = (e) => (e.from - e.to) + (e.temp ? e.temp.from - e.temp.to : 0);

const SUMMARY_MS = 5000;
const summaryPhase = (key, why) => {
  if (!why?.length) return null;
  if (why.some((p) => p.k === 'combatEnd')) return 'end';
  if (why.some((p) => p.k === 'combatStart' || p.k === 'avgVictories')) return 'start';
  if (key === 'world.malice' && why.some((p) => p.k === 'round') && Date.now() - _combatStartAt < COMBAT_START_MS) return 'start';
  return null;
};

const addToSummary = (list, phase, change) => {
  let e = null;
  for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
    const x = list[i];
    if (x.res !== 'summary') continue;
    if (x.phase === phase && change.now - x.at < SUMMARY_MS) e = x;
    break;
  }
  if (!e) {
    e = { id: foundry.utils.randomID(), after: change.after, turn: change.turn, at: change.now, user: change.userId,
      key: `summary.${phase}`, res: 'summary', phase, from: 0, to: 0, items: [] };
    list.push(e);
  }
  e.at = change.now;
  const item = e.items.find((it) => it.key === change.key && it.res === change.res);
  if (item) {
    item.to = change.to;
    item.why = [...(item.why ?? []), ...(change.why ?? [])];
  } else {
    e.items.push({ key: change.key, res: change.res, name: change.who?.name ?? '', label: change.label ?? null,
      from: change.from, to: change.to, why: change.why ?? null, hidden: !!change.hidden });
  }
};

const note = (change) => {
  const { key, res, from, to } = change;
  const why = takeWhy(key, res)?.map((part) => (part.k === 'turnGain' ? { ...part, total: to - from } : part)) ?? null;
  if (window._stageManagerResetting) return;
  if (from === null || to === null) return;
  if (from === to && !change.immune) return;
  const list = draftList();
  const now = Date.now();

  if (res === 'stamina' && to > from) {
    for (let i = list.length - 1; i >= Math.max(0, list.length - 20); i--) {
      const e = list[i];
      if (e.key !== key || e.res !== 'recovery') continue;
      if (!e.heal && now - e.at < RECOVERY_HEAL_MS) {
        e.heal = { from, to };
        scheduleFlush();
        return;
      }
      break;
    }
  }

  if (!change.always && !change.inCombat && !setting('resourceLogOutOfCombat')) return;

  const after = game.messages.contents.at(-1)?.id ?? null;
  const turn = _currentTurn();

  const phase = summaryPhase(key, why);
  if (phase) {
    addToSummary(list, phase, { ...change, why, after, turn, now });
    scheduleFlush();
    return;
  }

  const covers = coverOf(after, res);

  for (let i = list.length - 1; i >= Math.max(0, list.length - 40); i--) {
    const e = list[i];
    if (e.key !== key || e.res !== res || e.user !== change.userId) continue;
    if (now - e.at > MERGE_MS || (e.turn !== turn && !change.acrossTurns)) break;
    if (res === 'heroTokens' && (_tokenCall?.kind === 'spendToken' || e.reasons?.length)) break;
    
    if (why?.length || e.why?.length) break;
    
    if (e.after !== after) break;
    const before = lossOf(e);
    e.to = to;
    if (res === 'heroic') e.steps = [...(e.steps ?? []), { from, to }].slice(-10);
    e.at = now;
    e.turn = turn;
    if (change.hits?.length) {
      const seen = new Set((e.hits ?? []).map((h) => h.tokenId));
      e.hits = [...(e.hits ?? []), ...change.hits.filter((h) => !seen.has(h.tokenId))];
    }
    if (change.temp) e.temp = e.temp ? { from: e.temp.from, to: change.temp.to } : change.temp;
    if (change.dtype) e.dtype = change.dtype;
    if (change.incoming != null || e.incoming != null) {
      const added = lossOf({ from, to, temp: change.temp });
      e.incoming = (e.incoming ?? before) + (change.incoming ?? added);
    }
    if (change.imm) e.imm = change.imm;
    if (change.weak) e.weak = change.weak;
    if (change.immune) e.immune = true;
    if (change.hidden) e.hidden = true;
    if (covers) addCover(e, covers, to - from);
    e.why = e.why && why ? [...e.why, ...why] : null;
    if (e.to === e.from && !e.temp && !e.immune && !e.incoming) list.splice(list.indexOf(e), 1);
    scheduleFlush();
    return;
  }

  list.push({
    id: foundry.utils.randomID(),
    after,
    turn,
    at: now,
    user: change.userId,
    key,
    ...change.who,
    res,
    from,
    to,
    ...(res === 'heroic' ? { steps: [{ from, to }] } : {}),
    dtype: change.dtype ?? null,
    temp: change.temp ?? null,
    incoming: change.incoming ?? null,
    imm: change.imm || 0,
    weak: change.weak || 0,
    immune: !!change.immune,
    label: change.label ?? null,
    why,
    ...(covers ? { covers: [covers], coverDelta: { [covers]: to - from } } : {}),
    ...(change.hits?.length ? { hits: change.hits } : {}),
    ...(change.hidden ? { hidden: true } : {}),
  });
  scheduleFlush();
};

const damageDetail = (actor, type, incoming, ignored = []) => {
  const iw = actor.system?.calculateImmunityAndWeakness?.({ type, ignoredImmunities: [...ignored] }) ?? {};
  return { dtype: type, incoming, imm: iw.immunity ?? 0, weak: iw.weakness ?? 0 };
};

const noteImmune = (actor, ctx) => {
  if (!isDirector() || !setting('resourceLog') || ctx.amount <= 0) return;
  const detail = damageDetail(actor, ctx.type, ctx.amount, ctx.ignored);
  if (Math.max(0, ctx.amount + detail.weak - detail.imm) !== 0) return;
  const token = tokenOf(actor);
  const combat = combatOf(token);
  const v = actor.system?.stamina?.value ?? 0;
  note({ key: actor.uuid, res: 'stamina', from: v, to: v, userId: game.user.id, who: whoFor(actor, token, combat), inCombat: !!combat, hidden: hiddenFromPlayers(token), immune: true, ...detail });
};

let _minionHit = null;

const wrapTakeDamage = () => {
  const target = 'ds.data.Actor.BaseActorModel.prototype.takeDamage';
  const wrapper = async function (wrapped, damage, options = {}) {
    const actor = this.parent;
    
    if (actor && this.isMinion) {
      const outer = _minionHit;
      _minionHit = actor.isToken ? actor.token : actor.getActiveTokens(false, true)[0] ?? null;
      try { return await wrapped(damage, options); } finally { _minionHit = outer; }
    }
    if (!actor?.uuid) return wrapped(damage, options);
    const ctx = { type: options.type || 'untyped', amount: Number(damage) || 0, ignored: [...(options.ignoredImmunities ?? [])] };
    _incoming.set(actor.uuid, ctx);
    try {
      const result = await wrapped(damage, options);
      noteImmune(actor, ctx);
      return result;
    } finally {
      _incoming.delete(actor.uuid);
    }
  };
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, target, wrapper, 'WRAPPER');
    return;
  }
  const proto = globalThis.ds?.data?.Actor?.BaseActorModel?.prototype;
  const original = proto?.takeDamage;
  if (!original) return;
  proto.takeDamage = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
};

let _tokenCall = null;

const wrapCombatStart = () => {
  const wrapper = function (wrapped, ...args) {
    _combatStartAt = Date.now();
    return wrapped(...args);
  };
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, 'CONFIG.Combat.documentClass.prototype.startCombat', wrapper, 'WRAPPER');
    return;
  }
  const proto = CONFIG.Combat.documentClass.prototype;
  const original = proto.startCombat;
  proto.startCombat = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
};

const wrapMalice = () => {
  const proto = game.actors.malice ? Object.getPrototypeOf(game.actors.malice) : null;
  const explain = {
    startCombat: (heroes = []) => {
      const victories = heroes.map((h) => foundry.utils.getProperty(h, 'system.hero.victories') ?? 0);
      const value = Math.floor(victories.reduce((a, b) => a + b, 0) / victories.length) || 0;
      return [{ k: 'avgVictories', victories, value }];
    },
    _onStartRound: (combat, heroes = []) => [{ k: 'round', round: combat?.round ?? 0 }, { k: 'heroes', count: heroes.length }],
    resetMalice: () => [{ k: 'combatEnd' }],
  };
  for (const [name, parts] of Object.entries(explain)) {
    const original = proto?.[name];
    if (typeof original !== 'function') continue;
    proto[name] = function (...args) {
      let why = null;
      try { why = parts(...args); } catch { why = null; }
      return why ? explaining('world.malice|malice', why, () => original.apply(this, args)) : original.apply(this, args);
    };
  }
};

let _turnGainFor = null;

const rollParts = (message) => (message.system?.parts?.contents ?? []).filter((p) => p?.type === 'roll' && p.rolls?.length);
const isTurnGainRoll = (message) => {
  const gain = game.i18n.localize('DRAW_STEEL.Actor.hero.HeroicResourceGain');
  return (!!message.rolls?.length && message.flavor === gain) || rollParts(message).some((p) => p.flavor === gain);
};

const GAIN_LABELS = { heroic: 'DRAW_STEEL.Actor.hero.FIELDS.hero.primary.value.label', surges: 'DRAW_STEEL.Actor.hero.FIELDS.hero.surges.label' };
const gainTitle = (res) => game.i18n.format('DRAW_STEEL.EDITOR.Enrichers.Gain.MessageTitle.Default', {
  type: game.i18n.localize(GAIN_LABELS[res]), targets: '',
}).trim();

const RUI_CARD = 'dsresources-chat-card';
const ruiGain = (message) => {
  const content = message.content ?? '';
  if (!content.includes(RUI_CARD)) return null;
  const card = Object.assign(document.createElement('div'), { innerHTML: content }).querySelector(`.${RUI_CARD}`);
  const header = card?.querySelector('.dsresources-chat-header')?.textContent ?? '';
  if (!header.includes(game.i18n.localize('DSRESOURCES.Chat.Gained'))) return null;
  const method = card.querySelector('.dsresources-chat-method')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const amount = Number(card.querySelectorAll('.dsresources-chat-header strong')[1]?.textContent);
  const [, prev, cur] = card.querySelector('.dsresources-chat-summary')?.textContent?.match(/(-?\d+)\s*→\s*(-?\d+)/) ?? [];
  return {
    res: 'heroic', method, amount: Number.isFinite(amount) ? amount : null,
    previous: prev === undefined ? null : Number(prev), current: cur === undefined ? null : Number(cur),
  };
};

export const gainKind = (message) => {
  if (ruiGain(message)) return 'heroic';
  if (message.flags?.[MODULE_ID]?.turnGain || isTurnGainRoll(message)) return 'heroic';
  for (const part of rollParts(message)) {
    for (const res of Object.keys(GAIN_LABELS)) {
      const title = gainTitle(res);
      if (part.flavor === title || part.flavor?.startsWith(`${title} (`)) return res;
    }
  }
  return null;
};

const coverOf = (messageId, res) => {
  const message = messageId ? game.messages.get(messageId) : null;
  if (!message || Date.now() - (message.timestamp ?? 0) > 10000 || ruiGain(message)) return null;
  return gainKind(message) === res ? messageId : null;
};

const wrapTurnGain = () => {
  const target = 'ds.data.Actor.HeroModel.prototype._onStartTurn';
  const wrapper = function (wrapped, ...args) {
    const formula = this.class?.system?.turnGain;
    const actor = this.parent;
    if (!formula || !actor?.uuid) return wrapped(...args);
    _turnGainFor = actor.uuid;
    return explaining(`${actor.uuid}|heroic`, [{ k: 'turnGain', formula: String(formula) }], () => wrapped(...args))
      .finally(() => { if (_turnGainFor === actor.uuid) _turnGainFor = null; });
  };
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, target, wrapper, 'WRAPPER');
    return;
  }
  const proto = globalThis.ds?.data?.Actor?.HeroModel?.prototype;
  const original = proto?._onStartTurn;
  if (!original) return;
  proto._onStartTurn = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
};

const wrapHeroCombatStart = () => {
  const target = 'ds.data.Actor.HeroModel.prototype.startCombat';
  const wrapper = function (wrapped, ...args) {
    const actor = this.parent;
    if (!actor?.uuid) return wrapped(...args);
    return explaining(`${actor.uuid}|heroic`, [{ k: 'combatStart', victories: this.hero?.victories ?? 0 }], () => wrapped(...args));
  };
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, target, wrapper, 'WRAPPER');
    return;
  }
  const proto = globalThis.ds?.data?.Actor?.HeroModel?.prototype;
  const original = proto?.startCombat;
  if (!original) return;
  proto.startCombat = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
};

const whyLine = (part) => {
  switch (part.k) {
    case 'avgVictories': return part.victories.length
      ? L('why.avgVictories', { sum: `(${part.victories.join(' + ')})`, count: part.victories.length, value: part.value })
      : L('why.noHeroes');
    case 'round': return L('why.round', { round: part.round });
    case 'heroes': return L('why.heroes', { count: part.count });
    case 'combatEnd': return L('why.combatEnd');
    case 'turnGain': return L('why.turnGain', { formula: part.formula, total: part.total ?? '?' });
    case 'method': return part.text || null;
    case 'combatStart': return L('why.combatStart', { victories: part.victories });
    default: return null;
  }
};

const wrapHeroTokens = () => {
  const proto = game.actors.heroTokens ? Object.getPrototypeOf(game.actors.heroTokens) : null;
  for (const name of ['spendToken', 'giveToken']) {
    const original = proto?.[name];
    if (typeof original !== 'function') continue;
    proto[name] = async function (...args) {
      const outer = _tokenCall;
      _tokenCall = { kind: name, spendType: name === 'spendToken' ? args[0] : null, messageId: name === 'spendToken' ? args[1]?.messageId ?? null : null };
      try { return await original.apply(this, args); } finally { _tokenCall = outer; }
    };
  }
};

const replacesTokenCards = () => setting('resourceLog') && setting('resourceLogTokenCards');

const recentTokenEntry = () => {
  const list = draftList();
  const now = Date.now();
  for (let i = list.length - 1; i >= Math.max(0, list.length - 20); i--) {
    const e = list[i];
    if (e.key !== 'world.heroTokens') continue;
    return now - e.at > 3000 ? null : e;
  }
  return null;
};

const noteTokenSpend = (spendType, by) => {
  const e = recentTokenEntry();
  if (!e) return;
  e.reasons = [...new Set([...(e.reasons ?? []), spendType])];
  if (by) e.by = by;
  scheduleFlush();
};

export const registerResourceRecording = ({ currentTurn }) => {
  _currentTurn = currentTurn;
  seedKnown();
  wrapTakeDamage();
  wrapHeroTokens();
  wrapCombatStart();
  wrapMalice();
  wrapTurnGain();
  wrapHeroCombatStart();

  
  Hooks.on('preCreateChatMessage', (doc) => {
    const call = _tokenCall;
    if (!call || call.messageId || !game.user.isGM || !replacesTokenCards()) return;
    if (call.kind === 'spendToken') noteTokenSpend(call.spendType, doc.flavor || null);
    const e = recentTokenEntry();
    if (e) doc.updateSource({ [`flags.${MODULE_ID}.coveredBy`]: e.id });
  });
  Hooks.on('preCreateChatMessage', (doc) => {
    if (_turnGainFor && (doc.rolls?.length || rollParts(doc).length)) doc.updateSource({ [`flags.${MODULE_ID}.turnGain`]: true });
  });
  Hooks.on('createChatMessage', (message) => {
    if (!isDirector() || !setting('resourceLog')) return;
    const card = message.flags?.[MODULE_ID]?.coveredBy;
    if (card) {
      const e = draftList().find((x) => x.id === card);
      if (e) { addCover(e, message.id, 'all'); scheduleFlush(); }
      return;
    }
    const gain = ruiGain(message);
    const actor = gain ? ChatMessage.getSpeakerActor(message.speaker) : null;
    if (!actor) return;
    
    const list = draftList();
    const now = Date.now();
    const known = gain.previous !== null && gain.current !== null;
    const stepOf = (e) => (e.steps ?? [{ from: e.from, to: e.to }]).findIndex((s) => s.from === gain.previous && s.to === gain.current);
    const why = gain.method ? [{ k: 'method', text: gain.method }] : null;
    for (let i = list.length - 1; i >= Math.max(0, list.length - 20); i--) {
      const e = list[i];
      if (e.key !== actor.uuid || e.res !== gain.res) continue;
      if (now - e.at > 30000) break;
      const at = known ? stepOf(e) : (e.steps?.length ?? 1) - 1;
      if (at < 0) continue;
      const steps = e.steps ?? [{ from: e.from, to: e.to }];
      
      if (steps.length > 1 && at === steps.length - 1 && !e.why?.length && why) {
        const step = steps[at];
        e.steps = steps.slice(0, -1);
        e.to = step.from;
        const line = {
          ...e, id: foundry.utils.randomID(), after: message.id, from: step.from, to: step.to, steps: [step],
          covers: [], coverDelta: {}, why,
        };
        addCover(line, message.id, gain.amount ?? step.to - step.from);
        list.splice(i + 1, 0, line);
        if (e.to === e.from && !e.temp && !e.immune && !e.incoming && !e.covers?.length) list.splice(i, 1);
      } else {
        addCover(e, message.id, gain.amount ?? e.to - e.from);
        if (!e.why?.length && why && steps.length === 1) e.why = why;
      }
      scheduleFlush();
      break;
    }
  });
  Hooks.on('createToken', (token) => { if (token.actor) remember(token.actor); });
  Hooks.on('createActor', remember);
  Hooks.on('createCombatantGroup', rememberGroup);

  Hooks.on('preUpdateActor', (actor, _changes, options) => {
    const ctx = _incoming.get(actor.uuid);
    if (ctx) options.dsblDamage = { type: ctx.type, amount: ctx.amount, ignored: ctx.ignored };
  });

  Hooks.on('updateActor', (actor, changes, options, userId) => {
    const before = _known.get(actor.uuid);
    remember(actor);
    if (!isDirector() || !setting('resourceLog')) return;
    
    if (options?.dsblQuiet) return;

    const changed = {};
    for (const [res, path, read] of TRACKED) {
      if (foundry.utils.getProperty(changes, path) === undefined) continue;
      changed[res] = { from: before?.[res] ?? null, to: read(actor) };
    }
    if (!Object.keys(changed).length) return;

    const token = tokenOf(actor);
    const combat = combatOf(token);
    const base = { key: actor.uuid, userId, who: whoFor(actor, token, combat), inCombat: !!combat, hidden: hiddenFromPlayers(token) };
    const dmg = options?.dsblDamage ?? null;
    const type = dmg?.type ?? options?.ds?.damageType ?? null;
    const detail = type ? damageDetail(actor, type, dmg?.amount ?? null, dmg?.ignored) : {};

    const st = changed.stamina;
    const tp = changed.temporary;
    if (st && tp && st.to < st.from && tp.to < tp.from) {
      note({ ...base, ...detail, res: 'stamina', from: st.from, to: st.to, temp: { from: tp.from, to: tp.to } });
      delete changed.stamina;
      delete changed.temporary;
    }
    for (const [res, c] of Object.entries(changed)) {
      const lost = c.from !== null && c.to !== null && c.to < c.from;
      note({
        ...base,
        ...((res === 'stamina' || res === 'temporary') && lost ? detail : {}),
        res,
        from: c.from,
        to: c.to,
        label: res === 'heroic' ? actor.system?.hero?.primary?.label ?? null : null,
        always: res === 'recovery' && lost,
      });
    }
  });

  Hooks.on('updateCombatantGroup', (group, changes, options, userId) => {
    if (foundry.utils.getProperty(changes, 'system.staminaValue') === undefined) return;
    const from = _groups.get(group.uuid) ?? null;
    rememberGroup(group);
    if (!isDirector() || !setting('resourceLog')) return;
    const combat = group.parent;
    const hitId = options?.dstd?.primaryTargetId ?? null;
    const named = hitId ? (canvas.tokens?.get(hitId)?.document ?? fromUuidSync(String(hitId).replace(/__/g, '.'))) : null;
    const hit = named ?? ([...group.members].some((m) => m.tokenId === _minionHit?.id) ? _minionHit : null);
    const member = (hit?.actor ? hit : null) ?? [...group.members].find((m) => !m.isDefeated)?.token ?? [...group.members][0]?.token ?? null;
    if (!member?.actor) return;
    const type = options?.ds?.damageType ?? null;
    const to = group.system.staminaValue;
    const who = whoFor(member.actor, member, combat?.started ? combat : null);
    note({
      key: group.uuid,
      res: 'stamina',
      from,
      to,
      userId,
      who,
      hits: hit?.actor ? [who] : null,
      inCombat: !!combat?.started,
      hidden: hiddenFromPlayers(member),
      ...(type && from !== null && to < from ? damageDetail(member.actor, type, null) : {}),
    });
  });

  const onWorld = (setting, userId, options) => {
    const key = WORLD_KEYS.find((k) => setting.key === `draw-steel.${k}`);
    if (!key) return;
    const from = _world.get(key) ?? null;
    const to = worldValue(key);
    _world.set(key, to);
    if (options?.dsblQuiet) return;
    if (!isDirector() || !game.settings.get(MODULE_ID, 'resourceLog')) return;
    const starting = key === 'malice' && Date.now() - _combatStartAt < COMBAT_START_MS;
    note({
      key: `world.${key}`,
      res: key,
      from,
      to,
      userId,
      who: { tokenId: null, sceneId: null, src: null, name: L(`who.${key}`), party: key === 'heroTokens', whoIcon: key },
      inCombat: anyCombat() || starting || _why.has(`world.${key}|${key}`),
      acrossTurns: starting,
    });
  };
  Hooks.on('updateSetting', (setting, _changes, options, userId) => onWorld(setting, userId, options));
  Hooks.on('createSetting', (setting, options, userId) => onWorld(setting, userId, options));
};

const settleCovers = (e) => {
  const lost = (e.covers ?? []).filter((id) => !game.messages.has(id));
  if (!lost.length) return e;
  const next = { ...e, covers: e.covers.filter((id) => !lost.includes(id)), coverDelta: { ...(e.coverDelta ?? {}) } };
  for (const id of lost) {
    const share = next.coverDelta[id];
    delete next.coverDelta[id];
    if (share === 'all') return null;
    if (typeof share === 'number') next.to -= share;
    else if (!next.covers.length) return null;
  }
  if (next.to === next.from && !next.temp && !next.immune && !next.incoming) return null;
  return next;
};

export const pruneResourceLog = async (survivingAnchor, empty) => {
  if (!isDirector()) return;
  const fresh = !_draft;
  const entries = draftList();
  const kept = [];
  let changed = false;
  for (const original of entries) {
    const e = settleCovers(original);
    if (e !== original) changed = true;
    if (!e) continue;
    if (e.after !== null && !game.messages.has(e.after)) {
      const moved = survivingAnchor(e.after);
      if (moved === null && empty) { changed = true; continue; }
      if (moved !== e.after) { kept.push({ ...e, after: moved }); changed = true; continue; }
    }
    if (e.after === null && empty) { changed = true; continue; }
    kept.push(e);
  }
  if (!changed) {
    if (fresh) _draft = null;
    return;
  }
  _draft = kept;
  scheduleFlush();
};

const showsTotals = (e) => game.user.isGM || e.party || setting('resourceLogFullInfo');

const ICONS = {
  stamina: 'fa-solid fa-heart',
  temporary: 'fa-solid fa-shield-halved',
  heroic: 'fa-solid fa-bolt',
  surges: 'fa-solid fa-angles-up',
  recovery: 'fa-solid fa-heart-circle-plus',
  malice: 'fa-solid fa-skull',
  heroTokens: 'fa-solid fa-coins',
};

const WHO_ICONS = {
  malice: 'fa-solid fa-skull',
  heroTokens: 'fa-solid fa-users',
};

export const fitNames = (log) => {
  const names = [...log.querySelectorAll('.dsbl-res-name[data-short]')];
  for (const name of names) name.textContent = name.dataset.full;
  const tight = names.filter((name) => name.offsetParent && name.scrollWidth > name.clientWidth + 1);
  for (const name of tight) name.textContent = name.dataset.short;
};

const _fitted = new WeakSet();
const watchWidth = (log) => {
  if (_fitted.has(log)) return;
  _fitted.add(log);
  let last = log.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(log.clientWidth - last) < 2) return;
    last = log.clientWidth;
    fitNames(log);
  }).observe(log);
};

const damageLabel = (type) => {
  const label = globalThis.ds?.CONFIG?.damageTypes?.[type]?.label;
  return label ? game.i18n.localize(label) : type;
};

const ctlib = () => {
  const mod = game.modules.get('draw-steel-ctlib');
  return mod?.active ? mod.api ?? null : null;
};

const damageTypeHTML = (type) => {
  const icon = ctlib()?.damageTypeIconHTML?.(type);
  if (icon || type === 'untyped') return icon ?? '';
  return `<span class="dsbl-res-type-name">${esc(damageLabel(type))}</span>`;
};

const summaryRow = (e) => {
  const li = document.createElement('li');
  li.className = 'message dsbl-res-row dsbl-res-summary';
  li.dataset.dsblRes = e.id;
  const items = (e.items ?? []).filter((it) => game.user.isGM || !it.hidden);
  
  const resName = (it) => (it.res === 'heroic' && it.label ? it.label : L(`res.${it.res}`));
  const change = (it) => `${esc(it.from)} → ${esc(it.to)}`;
  const short = (part) => {
    switch (part.k) {
      case 'avgVictories': return L('summary.tip.average', { value: part.value });
      case 'round': return L('summary.tip.round', { round: part.round });
      case 'heroes': return L('summary.tip.heroes', { count: part.count });
      default: return null;
    }
  };
  const heroItems = items.filter((it) => it.res === 'heroic');
  const others = items.filter((it) => it.res !== 'heroic');
  const rows = [];
  if (heroItems.length) {
    rows.push(`<tr><td colspan="3" class="dsbl-sum-head">${esc(L(`summary.tip.${e.phase === 'start' ? 'victories' : 'reset'}`))}</td></tr>`);
    for (const it of heroItems) rows.push(`<tr><td>${esc(it.name)}</td><td>${esc(resName(it))}</td><td class="dsbl-sum-num">${change(it)}</td></tr>`);
  }
  for (const it of others) {
    const why = [...new Set((it.why ?? []).map(short).filter(Boolean))];
    rows.push(`<tr class="dsbl-sum-gap"><td colspan="2">${esc(it.name || resName(it))}</td><td class="dsbl-sum-num">${change(it)}</td></tr>`);
    if (why.length) rows.push(`<tr><td colspan="3" class="dsbl-sum-why">${esc(why.join(' · '))}</td></tr>`);
  }
  const tip = `<table class="dsbl-sum-table">${rows.join('')}</table>`;
  const heroes = heroItems.length;
  const malice = items.find((it) => it.res === 'malice');
  const parts = [];
  if (heroes) parts.push(L('summary.heroes', { count: heroes }));
  if (malice) parts.push(`${L('res.malice')} ${malice.from} → ${malice.to}`);
  const controls = game.user.isGM
    ? `<span class="dsbl-res-controls"><a class="dsbl-res-control" data-dsbl-res-action="delete" data-tooltip="${esc(L('delete'))}"><i class="fa-solid fa-trash" inert></i></a></span>`
    : '';
  li.innerHTML = `<span class="dsbl-res-who"><i class="fa-solid fa-swords dsbl-res-who-icon"></i>`
    + `<strong class="dsbl-res-name">${esc(L(`summary.${e.phase}`))}</strong>${controls}</span>`
    + `<span class="dsbl-res-summary-text" data-tooltip="${esc(tip)}" data-tooltip-class="dsbl-sum-tip">${esc(parts.join(' · '))}</span>`;
  return li;
};

export const resourceRow = (e) => {
  if (e.res === 'summary') return summaryRow(e);
  const li = document.createElement('li');
  li.className = `message dsbl-res-row dsbl-res-${e.res}`;
  li.dataset.dsblRes = e.id;

  const own = e.to - e.from;
  const delta = own + (e.temp ? e.temp.to - e.temp.from : 0);
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const shown = showsTotals(e);

  const faceOf = (w) => (w.src
    ? `<img class="dsbl-res-face" src="${esc(w.src)}" alt=""${w.tokenId && w.sceneId ? ` data-ctlib-face="Scene.${esc(w.sceneId)}.Token.${esc(w.tokenId)}"` : ''}>`
    : '');
  
  const many = (e.hits?.length ?? 0) > 1;
  const face = e.whoIcon
    ? `<i class="${WHO_ICONS[e.whoIcon] ?? 'fa-solid fa-circle'} dsbl-res-who-icon dsbl-res-who-${esc(e.whoIcon)}"></i>`
    : many
      ? `<span class="dsbl-fx-faces">${e.hits.slice(0, 3).map(faceOf).join('')}${e.hits.length > 3 ? `<span class="dsbl-fx-more">+${e.hits.length - 3}</span>` : ''}</span>`
      : faceOf(e);

  const stamina = e.res === 'stamina' || e.res === 'temporary';
  const dtype = e.dtype || (stamina && delta < 0 ? 'untyped' : (e.res === 'stamina' && delta > 0 ? 'healing' : null));
  const typeName = dtype ? (ctlib()?.damageTypeLabel?.(dtype) ?? damageLabel(dtype)) : '';

  const notes = [];
  if (e.temp) notes.push(L('split', { temp: e.temp.from - e.temp.to, stamina: e.from - e.to }));
  if (e.imm) notes.push(L('immunity', { type: typeName, n: e.imm }));
  if (e.weak) notes.push(L('weakness', { type: typeName, n: e.weak }));
  for (const part of e.why ?? []) {
    const line = whyLine(part);
    if (line) notes.push(esc(line));
  }
  const loss = -delta;
  const struck = e.incoming != null && e.incoming !== loss && delta <= 0 && e.incoming > 0
    ? `<s class="dsbl-res-incoming">${esc(e.incoming)}</s>`
    : '';
  if (e.immune && delta === 0) notes.unshift(L('immune'));
  const amount = `${sign}${Math.abs(delta)}`;
  const deltaCell = `<span class="dsbl-res-delta ${delta < 0 ? 'is-loss' : delta > 0 ? 'is-gain' : 'is-none'}"${notes.length ? ` data-tooltip="${esc(notes.join('<br>'))}"` : ''}>${struck}${amount}</span>`;

  const resName = e.res === 'heroic' && e.label ? e.label : L(`res.${e.res}`);
  const iconTip = e.res === 'recovery' ? L('recoveries', { from: e.from, to: e.to }) : resName;
  const token = (key, className = '') => ctlib()?.resourceTokenHTML?.(key, { className }) ?? '';
  let icon;
  if (e.temp) {
    const heart = token('stamina') || `<i class="${ICONS.stamina}"></i>`;
    const badge = token('temporary', 'dsbl-res-icon-badge') || `<i class="${ICONS.temporary} dsbl-res-icon-badge"></i>`;
    icon = `<span class="dsbl-res-icon dsbl-res-icon-stack" data-tooltip="${esc(L('res.stamina'))}">${heart}${badge}</span>`;
  } else {
    const drawn = token(e.res);
    icon = drawn
      ? `<span class="dsbl-res-icon dsbl-res-icon-token" data-tooltip="${esc(iconTip)}">${drawn}</span>`
      : `<i class="${ICONS[e.res] ?? 'fa-solid fa-circle'} dsbl-res-icon" data-tooltip="${esc(iconTip)}"></i>`;
  }

  const type = `<span class="dsbl-res-type">${dtype && stamina ? damageTypeHTML(dtype) : ''}</span>`;

  let totals = '';
  if (e.res === 'recovery' && e.heal) {
    const healed = e.heal.to - e.heal.from;
    totals = `<span class="dsbl-res-heal" data-tooltip="${esc(L('recoveryHeal', { n: healed }))}">${damageTypeHTML('healing')} +${esc(healed)}</span>`;
  } else if (shown) {
    totals = `${esc(e.from)} → ${esc(e.to)}`;
  }

  const controls = game.user.isGM
    ? `<span class="dsbl-res-controls">`
      + `<a class="dsbl-res-control" data-dsbl-res-action="conceal" data-tooltip="${esc(L(e.hidden ? 'reveal' : 'conceal'))}"><i class="fa-solid ${e.hidden ? 'fa-eye' : 'fa-eye-slash'}" inert></i></a>`
      + `<a class="dsbl-res-control" data-dsbl-res-action="delete" data-tooltip="${esc(L('delete'))}"><i class="fa-solid fa-trash" inert></i></a>`
      + `</span>`
    : '';
  const reasons = (e.reasons ?? []).map((k) => {
    const label = globalThis.ds?.CONFIG?.hero?.tokenSpends?.[k]?.label;
    return label ? game.i18n.localize(label) : k;
  });
  
  const fullName = many ? `${e.hits[0].name}s` : [e.by ?? e.name, ...reasons].join(' · ');
  const fitName = many ? `${e.hits[0].short ?? e.hits[0].name}s` : reasons.length ? (e.by ?? e.name) : e.short;
  const nameTip = !many && reasons.length ? ` data-tooltip="${esc(fullName)}"` : '';
  li.innerHTML = `<span class="dsbl-res-who">${face}<strong class="dsbl-res-name"${nameTip}${fitName && fitName !== fullName ? ` data-full="${esc(fullName)}" data-short="${esc(fitName)}"` : ''}>${esc(fullName)}</strong>${controls}</span>`
    + icon + deltaCell + type + `<span class="dsbl-res-totals">${totals}</span>`;
  if (e.hidden) li.classList.add('is-concealed');
  return li;
};

export const visibleEntry = (e) => game.user.isGM || !e.hidden;

const PENDING_MS = 3000;
const coverState = () => {
  const messages = new Set();
  const lines = new Set();
  for (const e of readResourceLog()) {
    if (!visibleEntry(e)) continue;
    lines.add(e.id);
    for (const id of e.covers ?? []) messages.add(id);
  }
  return { messages, lines };
};

const isCovered = (message, state) => {
  if (!setting('resourceLog')) return false;
  const card = message.flags?.[MODULE_ID]?.coveredBy;
  if (card) return replacesTokenCards() && state.lines.has(card);
  if (!setting('resourceLogTurnGainCards') || !gainKind(message)) return false;
  if (state.messages.has(message.id)) return true;
  const pending = Date.now() - (message.timestamp ?? 0) < PENDING_MS;
  return pending && (anyCombat() || setting('resourceLogOutOfCombat'));
};

export const refreshCovered = () => {
  const state = coverState();
  for (const el of document.querySelectorAll('.chat-message[data-message-id]')) {
    const message = game.messages.get(el.dataset.messageId);
    if (message) el.classList.toggle('dsbl-covered', isCovered(message, state));
  }
};

export const markCovered = (message, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const state = coverState();
  const covered = isCovered(message, state);
  root.classList.toggle('dsbl-covered', covered);
  if (covered && !state.messages.has(message.id) && !message.flags?.[MODULE_ID]?.coveredBy) {
    setTimeout(refreshCovered, PENDING_MS + 50);
  }
};

export const placeResourceRows = (log, entries, rowFor = resourceRow) => {
  if (!entries.length) return;
  const messages = new Map([...log.querySelectorAll(':scope > .chat-message[data-message-id]')].map((li) => [li.dataset.messageId, li]));
  const lastFor = new Map();
  for (const e of entries) {
    const anchor = e.after === null ? null : messages.get(e.after);
    if (e.after !== null && !anchor) continue;
    const row = rowFor(e);
    const prev = lastFor.get(e.after) ?? anchor;
    if (prev) prev.after(row);
    else log.prepend(row);
    lastFor.set(e.after, row);
  }
  fitNames(log);
  watchWidth(log);
};

const editEntry = async (id, change) => {
  if (!game.user.isGM) return;
  const list = foundry.utils.deepClone(readResourceLog());
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return;
  if (change === 'delete') list.splice(i, 1);
  else list[i].hidden = !list[i].hidden;
  await game.settings.set(MODULE_ID, LOG, list);
};

document.addEventListener('click', (event) => {
  const control = event.target.closest?.('[data-dsbl-res-action]');
  if (!control || control.closest('.dsbl-res-row')?.dataset.dsblLog === 'fx') return;
  event.preventDefault();
  event.stopPropagation();
  const id = control.closest('.dsbl-res-row')?.dataset.dsblRes;
  if (id) editEntry(id, control.dataset.dsblResAction);
});

export const syncResourceToggle = () => {
  const shown = setting('resourceLogShown') !== false;
  document.body.classList.toggle('dsbl-res-off', !shown);
  if (shown) for (const log of document.querySelectorAll('.chat-log')) fitNames(log);
  for (const btn of document.querySelectorAll('.dsbl-res-toggle')) {
    btn.setAttribute('aria-pressed', String(!shown));
    btn.dataset.tooltip = L('hide');
    btn.setAttribute('aria-label', L('hide'));
  }
};

export const addResourceToggle = (controls = document.getElementById('chat-controls')) => {
  const existing = document.querySelector('.dsbl-res-toggle');
  if (!setting('resourceLog') && !setting('effectLog')) { existing?.remove(); return; }
  if (!controls) return;
  if (existing && controls.contains(existing)) return syncResourceToggle();
  existing?.remove();
  let group = controls.querySelector('.control-buttons');
  if (!group) {
    group = document.createElement('div');
    group.className = 'control-buttons';
    controls.append(group);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-control icon toggle fa-solid fa-heart-pulse dsbl-res-toggle';
  btn.addEventListener('click', async (event) => {
    event.preventDefault();
    await game.settings.set(MODULE_ID, 'resourceLogShown', !(setting('resourceLogShown') !== false));
  });
  group.prepend(btn);
  syncResourceToggle();
};
