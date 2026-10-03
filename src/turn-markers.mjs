

import { readResourceLog, visibleEntry, placeResourceRows, pruneResourceLog, resourceRow, refreshCovered } from './resource-log.mjs';
import { readEffectLog, visibleEffect, effectRow, pruneEffectLog } from './effect-log.mjs';

export const MODULE_ID = 'draw-steel-battle-log';

const BOUNDARIES = 'turnBoundaries';
const FOLD_KEY = `${MODULE_ID}.turnFolds`;
const MAX_BOUNDARIES = 300;

const setting = (key) => game.settings.get(MODULE_ID, key);
const isDirector = () => game.users.activeGM?.isSelf === true;

const LEGACY = 'draw-steel-combat-tools';
export const olderCombatToolsLogs = () => game.modules.get(LEGACY)?.active === true
  && ['combatRoundLog', 'combatTurnLog'].some((key) => {
    if (!game.settings.settings.has(`${LEGACY}.${key}`)) return false;
    try { return game.settings.get(LEGACY, key) !== false; } catch { return true; }
  });

let _folds = null;

const folds = () => {
  if (_folds) return _folds;
  try { _folds = new Map(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')); }
  catch { _folds = new Map(); }
  return _folds;
};

const persistFolds = () => {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folds()])); } catch {  }
};

const DEPTH = { end: 0, begin: 1, round: 2 };
const depthOf = (entry) => DEPTH[entry.mark] ?? 2;

const isShut = (entry, isCurrent) => {
  if (isCurrent) return false;
  const choice = folds().get(entry.id);
  if (choice) return choice === 'shut';
  return true;
};

const setFold = (entry, shut) => {
  folds().set(entry.id, shut ? 'shut' : 'open');
  
  while (folds().size > 400) folds().delete(folds().keys().next().value);
  persistFolds();
};

const combatantOf = (combat, id) => (id ? combat.combatants.get(id) : null);

const groupOf = (combatant) => {
  const g = combatant?.group;
  if (!g) return null;
  if (g.type === 'squad') return g;
  return g.type === 'base' && g.members.size > 1 ? g : null;
};

const tokenIdsFor = (combatant) => {
  const group = groupOf(combatant);
  if (!group) return [combatant?.tokenId].filter(Boolean);
  return [...group.members].map((m) => m.tokenId).filter(Boolean);
};

const facesFor = (combatant) => {
  const group = groupOf(combatant);
  const members = group ? [...group.members] : [combatant];
  const captainId = group?.system?.captainId ?? null;
  const out = [];
  for (const m of members) {
    const doc = m?.token;
    if (!doc) continue;
    if (group && m.isDefeated) continue;
    out.push({
      id: m.tokenId,
      tokenUuid: doc.uuid,
      src: doc.texture?.src ?? null,
      name: doc.name ?? m.name,
      captain: !!captainId && m.id === captainId,
      minion: !!m.actor?.system?.isMinion,
    });
  }
  
  const rank = (f) => (f.captain ? 0 : f.minion ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b));
  return out;
};

const colourOf = (user) => {
  const c = user?.color;
  if (!c) return null;
  return typeof c === 'string' ? c : (c.css ?? c.toString?.() ?? null);
};

const colourFor = (combatant) => {
  const director = game.users.activeGM ?? game.users.find((u) => u.isGM);
  const actor = combatant?.actor;
  if (!actor) return colourOf(director);
  const player = game.users.find((u) => !u.isGM && u.character?.id === actor.id)
    ?? game.users.find((u) => !u.isGM && u.active && actor.testUserPermission(u, 'OWNER'))
    ?? game.users.find((u) => !u.isGM && actor.testUserPermission(u, 'OWNER'));
  return colourOf(player ?? director);
};

const labelFor = (combatant) => {
  const group = groupOf(combatant);
  if (!group) return combatant?.name ?? 'Someone';
  return group.name;
};

let _gapFrom = null;

const anchorFor = (incoming, floor) => {
  const messages = game.messages.contents;
  const ours = new Set(tokenIdsFor(incoming));
  const stopAt = _gapFrom ?? floor;
  let i = messages.length - 1;
  while (i >= 0) {
    const m = messages[i];
    if (m.id === stopAt) break;
    const tokenId = m.speaker?.token;
    if (!tokenId || !ours.has(tokenId)) break;
    i--;
  }
  return messages[i]?.id ?? null;
};

const readBoundaries = () => {
  const raw = setting(BOUNDARIES);
  return Array.isArray(raw) ? raw : [];
};

const record = async (entry) => {
  const list = readBoundaries();
  list.push(entry);
  while (list.length > MAX_BOUNDARIES) list.shift();
  await game.settings.set(MODULE_ID, BOUNDARIES, list);
};

const lastAnchor = () => readBoundaries().at(-1)?.after ?? null;

export const currentTurn = () => readBoundaries().at(-1)?.id ?? null;

export const registerTurnRecording = () => {
  Hooks.on('combatTurnChange', async (combat, prior, current) => {
    if (!combat.started || !isDirector()) return;
    if (prior.round !== current.round) return;

    if (!current.combatantId) {
      
      _gapFrom = game.messages.contents.at(-1)?.id ?? null;
      return;
    }

    const incoming = combatantOf(combat, current.combatantId);
    if (!incoming || incoming.isDefeated) return;

    const group = groupOf(incoming);
    const open = readBoundaries().at(-1);
    
    if (open?.kind === 'turn' && group && open.groupId === group.id && open.round === combat.round) return;

    await record({
      id:       foundry.utils.randomID(),
      kind:     'turn',
      round:    combat.round,
      label:    labelFor(incoming),
      faces:    facesFor(incoming),
      groupId:  group?.id ?? null,
      colour:   colourFor(incoming),
      after:    anchorFor(incoming, lastAnchor()),
    });
    _gapFrom = null;
  });

  const round = async (label, mark) => {
    if (!isDirector()) return;
    await record({ id: foundry.utils.randomID(), kind: 'round', mark, label, after: game.messages.contents.at(-1)?.id ?? null });
  };

  
  Hooks.on('combatStart', async (combat) => {
    await round('Draw Steel!', 'begin');
    await round(`Round ${combat.round || 1}`, 'round');
  });
  Hooks.on('updateCombat', (combat, changes) => {
    if (changes.round !== undefined && combat.started && changes.round > 1) round(`Round ${changes.round}`, 'round');
  });
  Hooks.on('deleteCombat', async () => {
    await round('Combat Ends', 'end');
    await pruneEmptySections();
  });
};

const chainFace = (face) => ({
  ...face,
  tokenUuid: face.tokenUuid ?? canvas.scene?.tokens.get(face.id)?.uuid ?? null,
});

const rule = () => {
  const r = document.createElement('span');
  r.className = 'dsbl-turn-rule';
  return r;
};

const marker = (entry, kind, isCurrent) => {
  
  const el = document.createElement('li');
  el.className = `message dsbl-turn-marker dsbl-turn-${kind}`;
  el.dataset.dscpTurn = entry.id;

  const label = document.createElement('span');
  label.className = 'dsbl-turn-label';

  if (entry.kind === 'round') {
    const closing = kind === 'roundend';
    el.classList.add('dsbl-turn-round');
    if (closing) el.classList.add('dsbl-round-closing');
    if (entry.mark) el.classList.add(`dsbl-round-${entry.mark}`);
    label.textContent = closing ? `${entry.label} Ends` : entry.label;

    
    const crest = document.createElement('span');
    crest.className = 'dsbl-turn-crest';

    if (entry.mark === 'begin' && !closing) {
      const sword = (side) => {
        const i = document.createElement('i');
        i.className = `fa-solid fa-swords dsbl-turn-sword dsbl-turn-sword-${side}`;
        i.setAttribute('inert', '');
        return i;
      };
      crest.append(sword('left'), label, sword('right'));
    } else {
      crest.append(label);
    }

    
    if (closing || entry.mark === 'end') el.append(crest);
    else el.append(rule(), crest, rule());

    
    if (isCurrent || entry.mark === 'end') {
      el.classList.add('dsbl-turn-live');
      return el;
    }

    el.addEventListener('click', () => {
      setFold(entry, !isShut(entry, false));
      draw();
    });
    return el;
  }

  label.textContent = kind === 'end' ? entry.label + ' ended' : entry.label;
  if (entry.colour) {
    label.classList.add('dsbl-turn-played');
    label.style.webkitTextStrokeColor = entry.colour;
  }

  const faces = document.createElement('span');
  faces.className = 'dsbl-turn-faces';
  const ctlib = game.modules.get('draw-steel-ctlib')?.api;
  faces.innerHTML = ctlib?.faceChainHTML?.((entry.faces ?? []).map(chainFace)) ?? '';
  ctlib?.activateFaces?.(faces);

  
  if (kind === 'start' && !isCurrent) {
    const caret = document.createElement('i');
    caret.className = 'fa-solid fa-caret-down dsbl-turn-caret';
    caret.setAttribute('inert', '');
    el.append(caret);
  }
  el.append(label, rule(), faces);

  if (isCurrent) {
    el.classList.add('dsbl-turn-live');
    return el;
  }

  
  el.addEventListener('click', () => {
    setFold(entry, !isShut(entry, false));
    draw();
  });
  return el;
};

const logElement = () => {
  
  const log = ui.chat?.element?.querySelector('.chat-log');
  return log?.closest('#chat-notifications') ? null : (log ?? null);
};

let _drawing = false;

export const draw = () => {
  if (_drawing) return;
  const log = logElement();
  if (!log) return;

  
  const scroller = log.closest('.chat-scroll') ?? log;
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
  let anchor = null;
  if (!atBottom) {
    for (const row of log.querySelectorAll(':scope > .chat-message[data-message-id]')) {
      if (row.offsetTop + row.offsetHeight > scroller.scrollTop) { anchor = { row, above: row.offsetTop - scroller.scrollTop }; break; }
    }
  }

  _drawing = true;
  try {
    for (const old of log.querySelectorAll('.dsbl-turn-marker, .dsbl-res-row')) old.remove();
    for (const li of log.querySelectorAll('.chat-message')) {
      li.classList.remove('dsbl-in-turn', 'dsbl-turn-hidden', 'dsbl-round-hidden');
      delete li.dataset.dscpTurn;
    }
    const resEntries = [
      ...(setting('resourceLog') ? readResourceLog().filter(visibleEntry) : []),
      ...(setting('effectLog') ? readEffectLog().filter(visibleEffect) : []),
    ].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    placeResourceRows(log, resEntries, (e) => (e.kind === 'fx' ? effectRow(e) : resourceRow(e)));
    refreshCovered();
    if (!setting('turnMarkers') || olderCombatToolsLogs()) return;

    const rows = [...log.querySelectorAll(':scope > .chat-message[data-message-id], :scope > .dsbl-res-row')];
    const at = new Map(rows.filter((li) => li.dataset.messageId).map((li) => [li.dataset.messageId, rows.indexOf(li)]));
    const isRes = (r) => r.classList.contains('dsbl-res-row');
    const logsShown = !document.body.classList.contains('dsbl-res-off');
    const counted = (r) => (isRes(r) ? logsShown : !(logsShown && r.classList.contains('dsbl-covered')));
    const messagesIn = (s, e) => rows.slice(s, e).filter(counted).length;
    const foldedTitle = (s, e) => {
      const shown = rows.slice(s, e).filter(counted);
      const logs = shown.filter(isRes).length;
      const msgs = shown.length - logs;
      const part = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      const parts = [msgs ? part(msgs, 'message', 'messages') : null, logs ? part(logs, 'log line', 'log lines') : null].filter(Boolean);
      return `${parts.join(' and ')} folded away`;
    };

    const entries = readBoundaries();
    const order = new Map(entries.map((e, i) => [e.id, i]));
    const resTurn = new Map(resEntries.map((e) => [e.id, e.turn]));
    const pastEarlierRows = (start, index) => {
      let s = start;
      while (s < rows.length && isRes(rows[s])) {
        const turn = resTurn.get(rows[s].dataset.dsblRes);
        if ((turn == null ? -1 : (order.get(turn) ?? -1)) >= index) break;
        s++;
      }
      return s;
    };
    const sections = [];

    const placed = entries
      .map((entry, index) => ({ entry, index, start: entry.after === null ? 0 : (at.get(entry.after) ?? -1) + 1 }))
      .filter((b) => b.start > 0 || b.entry.after === null)
      .map((b) => ({ ...b, start: pastEarlierRows(b.start, b.index) }))
      .filter((b) => b.start <= rows.length);

    for (let i = 0; i < placed.length; i++) {
      const { entry, index, start } = placed[i];
      const end = i + 1 < placed.length ? placed[i + 1].start : rows.length;
      const first = rows[start];

      if (entry.kind === 'round') {
        const depth = depthOf(entry);
        
        const isOpen = !placed.slice(i + 1).some((p) => p.entry.kind === 'round' && depthOf(p.entry) <= depth);

        const line = marker(entry, 'round', isOpen);
        line.classList.toggle('dsbl-turn-shut', depth > 0 && isShut(entry, isOpen));
        if (first) log.insertBefore(line, first);
        else log.append(line);
        sections.push({ entry, depth, start, line, isOpen });
        continue;
      }

      
      const isCurrent = i === placed.length - 1;

      
      if (end === start && !isCurrent) continue;

      const hidden = isShut(entry, isCurrent);
      const head = marker(entry, 'start', isCurrent);
      head.classList.toggle('dsbl-turn-shut', hidden);

      if (first) log.insertBefore(head, first);
      else log.append(head);

      for (let r = start; r < end; r++) {
        rows[r].classList.add('dsbl-in-turn');
        rows[r].dataset.dscpTurn = entry.id;
        rows[r].classList.toggle('dsbl-turn-hidden', hidden);
      }

      const folded = messagesIn(start, end);
      if (hidden && folded) {
        const count = document.createElement('span');
        count.className = 'dsbl-turn-count';
        count.textContent = String(folded);
        count.title = foldedTitle(start, end);
        head.append(count);
      }

      
      if (i + 1 < placed.length && end > start) {
        const foot = marker(entry, 'end', false);
        foot.classList.toggle('dsbl-turn-hidden', hidden);
        const after = rows[end - 1];
        after.parentNode.insertBefore(foot, after.nextSibling);
      }
    }
    
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].depth !== 0) continue;
      const owner = sections.slice(0, i).reverse().find((x) => x.depth === 1);
      if (!owner || owner.isOpen) continue;
      const line = sections[i].line;
      line.classList.remove('dsbl-turn-live');
      line.addEventListener('click', () => {
        setFold(owner.entry, !isShut(owner.entry, false));
        draw();
      });
    }

    
    for (let i = 0; i < sections.length; i++) {
      const { entry, depth, start, line, isOpen } = sections[i];
      if (depth !== 2 || isOpen) continue;
      const closer = sections.slice(i + 1).find((x) => x.depth <= depth);
      const end = closer ? closer.start : rows.length;
      if (end === start) continue;
      const foot = marker(entry, 'roundend', false);
      if (closer) log.insertBefore(foot, closer.line);
      else log.append(foot);
      sections[i].foot = foot;
    }

    
    for (let i = 0; i < sections.length; i++) {
      const { entry, depth, start, line, isOpen } = sections[i];
      const closer = sections.slice(i + 1).find((x) => x.depth <= depth);
      const end = closer ? closer.start : rows.length;
      
      if (depth === 0) continue;
      if (!isShut(entry, isOpen)) continue;

      let hiddenCount = 0;
      for (let r = start; r < end; r++) { rows[r].classList.add('dsbl-round-hidden'); if (counted(rows[r])) hiddenCount++; }

      
      let n = line.nextElementSibling;
      const stop = closer ? closer.line : null;
      while (n && n !== stop) {
        if (n.classList.contains('dsbl-turn-marker')) n.classList.add('dsbl-round-hidden');
        n = n.nextElementSibling;
      }

      
      if (depth === 1 && closer?.depth === 0) closer.line.classList.add('dsbl-round-hidden');

      
      sections[i].foot?.classList.add('dsbl-round-hidden');

      
      if (hiddenCount && entry.mark !== 'begin') {
        const count = document.createElement('span');
        count.className = 'dsbl-turn-count';
        count.textContent = String(hiddenCount);
        count.title = foldedTitle(start, end);
        line.append(count);

        
        const twin = count.cloneNode(true);
        twin.classList.add('dsbl-turn-count-twin');
        twin.removeAttribute('title');
        line.prepend(twin);
      }
    }
  } finally {
    _drawing = false;
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    else if (anchor?.row?.isConnected) scroller.scrollTop = anchor.row.offsetTop - anchor.above;
  }
};

let _pending = null;

export const scheduleDraw = () => {
  if (_pending) clearTimeout(_pending);
  _pending = setTimeout(() => { _pending = null; draw(); }, 80);
};

const _movedTo = new Map();

export const noteDeletion = (message) => {
  if (!isDirector()) return;
  const all = game.messages.contents;
  const i = all.findIndex((m) => m.id === message.id);
  _movedTo.set(message.id, i > 0 ? all[i - 1].id : null);
};

const survivingAnchor = (after) => {
  const seen = new Set();
  let at = after;
  while (at !== null && !game.messages.has(at)) {
    if (seen.has(at)) return null;
    seen.add(at);
    if (!_movedTo.has(at)) return null;
    at = _movedTo.get(at);
  }
  return at;
};

export const pruneEmptySections = async () => {
  if (!isDirector()) return;
  const entries = readBoundaries();
  const drop = new Set();
  const logged = new Set([...readResourceLog(), ...readEffectLog()].map((e) => e.turn).filter(Boolean));

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.kind !== 'round') continue;
    const depth = depthOf(e);
    if (depth === 0) continue;

    const closerAt = entries.findIndex((x, j) => j > i && x.kind === 'round' && depthOf(x) <= depth);
    if (closerAt < 0) continue;
    if (entries[closerAt].after !== e.after) continue;
    if (entries.slice(i, closerAt).some((x) => logged.has(x.id))) continue;
    drop.add(i);
  }

  
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].kind !== 'round' || depthOf(entries[i]) !== 0) continue;
    let ownerAt = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (entries[j].kind === 'round' && depthOf(entries[j]) === 1) { ownerAt = j; break; }
    }
    if (ownerAt < 0 || drop.has(ownerAt)) drop.add(i);
  }

  if (!drop.size) return;
  const kept = entries.filter((_, i) => !drop.has(i));
  await game.settings.set(MODULE_ID, BOUNDARIES, kept);
};

export const pruneBoundaries = async ({ cleared = false } = {}) => {
  if (!isDirector()) return;
  const entries = readBoundaries();
  const empty = cleared && game.messages.size === 0;

  const kept = [];
  let changed = false;
  for (const e of entries) {
    if (e.after !== null && !game.messages.has(e.after)) {
      const moved = survivingAnchor(e.after);
      if (moved === null && empty) { changed = true; continue; }
      if (moved !== e.after) { kept.push({ ...e, after: moved }); changed = true; continue; }
    }
    if (e.after === null && empty) { changed = true; continue; }
    kept.push(e);
  }

  await pruneResourceLog(survivingAnchor, empty);
  await pruneEffectLog(survivingAnchor, empty);
  _movedTo.clear();
  if (changed) await game.settings.set(MODULE_ID, BOUNDARIES, kept);
};

export const watchClearAll = () => {
  const wrapper = async function (wrapped, ids = [], operation = {}) {
    const result = await wrapped(ids, operation);
    if (operation?.deleteAll) await pruneBoundaries({ cleared: true });
    return result;
  };
  if (globalThis.libWrapper) {
    libWrapper.register(MODULE_ID, 'CONFIG.ChatMessage.documentClass.deleteDocuments', wrapper, 'WRAPPER');
    return;
  }
  const cls = CONFIG.ChatMessage.documentClass;
  const original = cls.deleteDocuments;
  cls.deleteDocuments = function (...args) { return wrapper.call(this, original.bind(this), ...args); };
};

let _pruning = null;

export const schedulePrune = () => {
  if (!isDirector() || _pruning) return;
  _pruning = setTimeout(() => { _pruning = null; pruneBoundaries(); }, 500);
};
