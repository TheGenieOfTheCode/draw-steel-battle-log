

import { readResourceLog, visibleEntry, placeResourceRows, pruneResourceLog, resourceRow, refreshCovered, logStartShown, rewriteResourceLog } from './resource-log.mjs';
import { readEffectLog, visibleEffect, effectRow, fmRow, moveRow, pruneEffectLog, rewriteEffectLog } from './effect-log.mjs';
import { isDirector, primaryGM } from './director.mjs';
import { syncLoadOlder } from './load-older.mjs';
import { setTip, tip } from './tips.mjs';

export const MODULE_ID = 'draw-steel-battle-log';

const BOUNDARIES = 'turnBoundaries';
const FOLD_KEY = `${MODULE_ID}.turnFolds`;
const MAX_BOUNDARIES = 300;

const setting = (key) => game.settings.get(MODULE_ID, key);

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
  return setting('turnMarkersAutoCollapse') !== false;
};

const shownKind = (entry) => {
  if (entry.kind !== 'round') return setting('turnMarkersTurns') !== false;
  if (entry.mark === 'round') return setting('turnMarkersRounds') !== false;
  return setting('turnMarkersCombats') !== false;
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
  const director = primaryGM() ?? game.users.find((u) => u.isGM);
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
  Hooks.on('deleteCombat', async (combat) => {
    
    const last = readBoundaries().findLast((e) => e.kind === 'round' && depthOf(e) <= 1);
    if (combat.started || last?.mark === 'begin') await round('Combat Ends', 'end');
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

const logElements = () => {
  const ChatLog = foundry.applications.sidebar.tabs.ChatLog;
  const apps = new Set([ui.chat, ...[...foundry.applications.instances.values()].filter((a) => a instanceof ChatLog && a.rendered)]);
  return [...apps].map((app) => app?.element?.querySelector('.chat-log')).filter((log) => log && !log.closest('#chat-notifications'));
};

let _drawing = false;

const TOP_ROW = 'dsbl-log-top';
const keepTopRow = (log) => {
  let top = log.querySelector(`:scope > .${TOP_ROW}`);
  if (!top) {
    top = document.createElement('li');
    top.className = `message ${TOP_ROW}`;
    top.setAttribute('aria-hidden', 'true');
  }
  if (log.firstElementChild !== top) log.prepend(top);
  syncLoadOlder(log);
};

const KINDS = /^dsbl-turn-(start|end|round|roundend)$/;
const selectorFor = (el) => {
  if (el.dataset.messageId) return `[data-message-id="${el.dataset.messageId}"]`;
  if (el.dataset.dsblRes) return `.dsbl-res-row[data-dsbl-res="${el.dataset.dsblRes}"]`;
  const kind = [...el.classList].find((c) => KINDS.test(c));
  if (kind && el.dataset.dscpTurn) return `.dsbl-turn-marker.${kind}[data-dscp-turn="${el.dataset.dscpTurn}"]`;
  return null;
};

const _lastFor = new WeakMap();

const drawSignature = (log) => JSON.stringify([setting('resourceLog'), setting('effectLog'), setting('turnMarkers'), olderCombatToolsLogs(),
  document.body.classList.contains('dsbl-res-off'), logStartShown(log), readBoundaries(), [...folds()]]);

const logEntries = () => [
  ...(setting('resourceLog') ? readResourceLog().filter(visibleEntry) : []),
  ...(setting('effectLog') ? readEffectLog().filter(visibleEffect) : []),
].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

const rowOf = (e) => (e.kind === 'fx' ? effectRow(e) : e.kind === 'fm' ? fmRow(e) : e.kind === 'move' ? moveRow(e) : resourceRow(e));
const messageRows = (log) => [...log.querySelectorAll(':scope > .chat-message[data-message-id]')];
const TURN_CLASSES = ['dsbl-in-turn', 'dsbl-turn-hidden', 'dsbl-round-hidden'];

const remember = (log, sig, current) => {
  const lis = messageRows(log);
  const assign = new Map();
  for (const li of lis) {
    if (li.dataset.dscpTurn === undefined) continue;
    assign.set(li.dataset.messageId, { turn: li.dataset.dscpTurn, cls: TURN_CLASSES.filter((c) => li.classList.contains(c)) });
  }
  const entries = logEntries();
  _lastFor.set(log, { sig, current, assign, ids: lis.map((li) => li.dataset.messageId), res: entries.map((e) => e.id), resJson: JSON.stringify(entries),
    markers: log.querySelectorAll(':scope > .dsbl-turn-marker').length, rows: log.querySelectorAll(':scope > .dsbl-res-row').length });
};

const appendOnly = (log, scroller, atBottom) => {
  const last = _lastFor.get(log);
  if (!last || last.current === false) return false;
  const sig = drawSignature(log);
  if (sig !== last.sig) return false;
  if (log.querySelectorAll(':scope > .dsbl-turn-marker').length !== last.markers || log.querySelectorAll(':scope > .dsbl-res-row').length !== last.rows) return false;
  const lis = messageRows(log);
  const ids = lis.map((li) => li.dataset.messageId);
  const n = last.ids.length;
  if (ids.length < n || last.ids.some((id, i) => ids[i] !== id)) return false;
  const entries = logEntries();
  const m = last.res.length;
  if (entries.length < m || JSON.stringify(entries.slice(0, m)) !== last.resJson) return false;
  const fresh = new Set(ids.slice(n));
  const added = entries.slice(m);
  if (added.some((e) => !fresh.has(e.after))) return false;
  _drawing = true;
  try {
    placeResourceRows(log, added, rowOf);
    refreshCovered();
    const tag = (el) => { if (!last.current) return; el.classList.add('dsbl-in-turn'); el.dataset.dscpTurn = last.current; };
    for (const li of lis.slice(n)) tag(li);
    for (const e of added) {
      const row = log.querySelector(`:scope > .dsbl-res-row[data-dsbl-res="${CSS.escape(e.id)}"]`);
      if (row) tag(row);
    }
    
    for (let i = 0; i < n; i++) {
      const li = lis[i];
      const was = li.dataset.dscpTurn === undefined ? last.assign.get(ids[i]) : null;
      if (!was) continue;
      li.classList.add(...was.cls);
      li.dataset.dscpTurn = was.turn;
    }
    remember(log, sig, last.current);
  } finally {
    _drawing = false;
    keepTopRow(log);
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  }
  return true;
};

export const draw = () => {
  if (_drawing) return;
  for (const log of logElements()) drawLog(log);
};

const drawLog = (log) => {
  const scroller = log.closest('.chat-scroll') ?? log;
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
  if (appendOnly(log, scroller, atBottom)) return;
  _lastFor.delete(log);
  const sig = drawSignature(log);
  let current = null;
  let drawn = false;
  let anchor = null;
  if (!atBottom) {
    for (const row of log.children) {
      if (row.offsetParent === null || row.classList.contains(TOP_ROW)) continue;
      if (row.offsetTop + row.offsetHeight <= scroller.scrollTop) continue;
      const selector = selectorFor(row);
      if (selector) { anchor = { selector, above: row.offsetTop - scroller.scrollTop }; break; }
    }
  }

  _drawing = true;
  try {
    for (const old of log.querySelectorAll('.dsbl-turn-marker, .dsbl-res-row')) old.remove();
    for (const li of log.querySelectorAll('.chat-message')) {
      li.classList.remove('dsbl-in-turn', 'dsbl-turn-hidden', 'dsbl-round-hidden');
      delete li.dataset.dscpTurn;
    }
    const resEntries = logEntries();
    placeResourceRows(log, resEntries, rowOf);
    refreshCovered();
    if (!setting('turnMarkers') || olderCombatToolsLogs()) { drawn = true; return; }

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
      const F = (key, data) => game.i18n.format(`DSBL.tip.folded.${key}`, data);
      const parts = [msgs ? F(msgs === 1 ? 'message' : 'messages', { n: msgs }) : null, logs ? F(logs === 1 ? 'logLine' : 'logLines', { n: logs }) : null].filter(Boolean);
      return tip('folded', { body: F('body', { what: parts.length > 1 ? F('both', { a: parts[0], b: parts[1] }) : (parts[0] ?? '') }) });
    };

    const entries = readBoundaries();
    const fromStart = logStartShown(log);
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
      .filter((b) => shownKind(b.entry))
      .filter((b) => b.start > 0 || (b.entry.after === null && fromStart))
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
      if (isCurrent) current = hidden ? false : entry.id;
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
        setTip(count, foldedTitle(start, end));
        head.append(count);
      }

      
      if (i + 1 < placed.length && end > start) {
        const foot = marker(entry, 'end', false);
        foot.classList.toggle('dsbl-turn-hidden', hidden);
        const after = rows[end - 1];
        after.parentNode.insertBefore(foot, after.nextSibling);
      }
    }
    
    
    const orphans = [];
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].depth !== 0) continue;
      const owner = sections.slice(0, i).reverse().find((x) => x.depth <= 1);
      if (owner?.depth !== 1) { orphans.push(sections[i].line); continue; }
      if (owner.isOpen) continue;
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
        setTip(count, foldedTitle(start, end));
        line.append(count);

        
        const twin = count.cloneNode(true);
        twin.classList.add('dsbl-turn-count-twin');
        twin.removeAttribute('title');
        line.prepend(twin);
      }
    }
    for (const line of orphans) line.remove();
    drawn = true;
  } finally {
    _drawing = false;
    keepTopRow(log);
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    else if (anchor) {

      let row = log.querySelector(`:scope > ${anchor.selector}`);
      while (row && row.offsetParent === null) row = row.previousElementSibling;
      if (row) scroller.scrollTop = row.offsetTop - anchor.above;
    }
    if (drawn) remember(log, sig, current);
  }
};

let _pending = null;

export const scheduleDraw = () => {
  if (_pending) clearTimeout(_pending);
  _pending = setTimeout(() => { _pending = null; draw(); }, 80);
};

let _order = null;

export const noteMessage = (message) => {
  if (_order && isDirector()) _order.push(message.id);
};

const survivingAnchor = (after) => {
  if (after === null || game.messages.has(after)) return after;
  const i = _order?.indexOf(after) ?? -1;
  if (i < 0) return after;
  for (let j = i - 1; j >= 0; j--) if (game.messages.has(_order[j])) return _order[j];
  return null;
};

export const rememberOrder = () => {
  if (isDirector()) _order = game.messages.contents.map((m) => m.id);
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
      if (entries[j].kind !== 'round' || depthOf(entries[j]) > 1) continue;
      if (depthOf(entries[j]) === 1) ownerAt = j;
      break;
    }
    const prev = entries[i - 1];
    const closes = !!prev && !(prev.kind === 'round' && depthOf(prev) === 0);
    if (ownerAt < 0 ? !closes : drop.has(ownerAt)) drop.add(i);
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
  rememberOrder();
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

const levelOf = (entry) => (entry.kind === 'round' ? depthOf(entry) : 3);
const closerAt = (entries, i) => entries.findIndex((x, j) => j > i && levelOf(x) <= levelOf(entries[i]));

const openerAt = (entries, id) => {
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0 || levelOf(entries[i]) !== 0) return i;
  for (let j = i - 1; j >= 0; j--) {
    const level = levelOf(entries[j]);
    if (level > 1) continue;
    return level === 1 ? j : -1;
  }
  return -1;
};

const contentsOf = (entries, i) => {
  const all = game.messages.contents;
  const index = new Map(all.map((m, n) => [m.id, n]));
  const order = new Map(entries.map((e, n) => [e.id, n]));
  const pos = (after) => (after === null ? -1 : index.get(after));
  const c = closerAt(entries, i);
  const from = pos(entries[i].after);
  const to = c < 0 ? null : pos(entries[c].after);
  if (from === undefined || to === undefined) return null;
  const past = (a, t, j, at) => a > at || (a === at && t >= j);
  const within = (a, t) => a !== undefined && past(a, t, i, from) && (c < 0 || !past(a, t, c, to));
  const turnOf = (e) => (e.turn == null ? -1 : (order.get(e.turn) ?? -1));
  const logged = (on, list) => new Set(on ? list.filter((e) => within(pos(e.after), turnOf(e))).map((e) => e.id) : []);
  return {
    messages: all.filter((_, n) => within(n, -1)).map((m) => m.id),
    resources: logged(setting('resourceLog'), readResourceLog()),
    effects: logged(setting('effectLog'), readEffectLog()),
  };
};

const contentsAt = (id) => {
  const entries = readBoundaries();
  const i = openerAt(entries, id);
  return i < 0 ? null : { entry: entries[i], ...contentsOf(entries, i) };
};

const deleteMarker = async (id) => {
  if (!game.user.isGM) return;
  const entries = readBoundaries();
  const i = openerAt(entries, id);
  if (i < 0) return;
  const drop = new Set([i]);
  const c = closerAt(entries, i);
  if (levelOf(entries[i]) === 1 && c >= 0 && levelOf(entries[c]) === 0) drop.add(c);

  
  const home = new Map();
  for (const k of drop) {
    let j = k - 1;
    while (j >= 0 && drop.has(j)) j--;
    home.set(entries[k].id, entries[j]?.id ?? null);
  }
  const rehome = (e) => (home.has(e.turn) ? { ...e, turn: home.get(e.turn) } : e);

  await game.settings.set(MODULE_ID, BOUNDARIES, entries.filter((_, k) => !drop.has(k)));
  await rewriteResourceLog(rehome);
  await rewriteEffectLog(rehome);
};

const L = (key, data) => (data ? game.i18n.format(`DSBL.Markers.${key}`, data) : game.i18n.localize(`DSBL.Markers.${key}`));

const deleteContents = async (id) => {
  if (!game.user.isGM) return;
  const found = contentsAt(id);
  if (!found) return;
  const { entry, messages, resources, effects } = found;
  const logs = resources.size + effects.size;
  if (!messages.length && !logs) return;

  const parts = [
    messages.length ? (messages.length === 1 ? L('oneMessage') : L('messages', { count: messages.length })) : null,
    logs ? (logs === 1 ? L('oneLogLine') : L('logLines', { count: logs })) : null,
  ].filter(Boolean);
  const what = parts.length > 1 ? L('both', { first: parts[0], second: parts[1] }) : parts[0];
  const scope = entry.kind !== 'round' ? 'turn' : entry.mark === 'begin' ? 'combat' : 'round';
  const label = foundry.utils.escapeHTML(String(entry.label ?? ''));

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: 'DSBL.Markers.deleteMessages', icon: 'fa-solid fa-trash' },
    content: `<p>${L(`confirm.${scope}`, { what, label })}</p>`,
  });
  if (ok !== true) return;

  if (resources.size) await rewriteResourceLog((e) => (resources.has(e.id) ? null : e));
  if (effects.size) await rewriteEffectLog((e) => (effects.has(e.id) ? null : e));
  const ids = messages.filter((m) => game.messages.has(m));
  if (ids.length) await ChatMessage.implementation.deleteDocuments(ids);
};

const _menus = new WeakSet();

export const addMarkerMenu = (root) => {
  if (!game.user.isGM || !root?.querySelector || _menus.has(root)) return;
  _menus.add(root);
  const holds = (li) => {
    const found = contentsAt(li.dataset.dscpTurn);
    return !!found && found.messages.length + found.resources.size + found.effects.size > 0;
  };
  new foundry.applications.ux.ContextMenu.implementation(root, '.dsbl-turn-marker[data-dscp-turn]', [
    {
      label: 'DSBL.Markers.deleteMarker',
      icon: 'fa-solid fa-eraser',
      visible: (li) => openerAt(readBoundaries(), li.dataset.dscpTurn) >= 0,
      onClick: (_event, li) => deleteMarker(li.dataset.dscpTurn),
    },
    {
      label: 'DSBL.Markers.deleteMessages',
      icon: 'fa-solid fa-trash',
      visible: holds,
      onClick: (_event, li) => deleteContents(li.dataset.dscpTurn),
    },
  ], { jQuery: false, fixed: true });
};
