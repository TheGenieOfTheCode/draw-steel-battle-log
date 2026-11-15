import { MODULE_ID } from './collapse.mjs';
import { setTip, tip } from './tips.mjs';

const CT = 'draw-steel-combat-tools';
const DIE = (face) => `modules/${MODULE_ID}/icons/dice/die-${face}.png`;
const L = (k, data) => game.i18n.format(`DSBL.TargetStyle.${k}`, data ?? {});
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
const setting = (key) => game.settings.get(MODULE_ID, key);
const mods = () => (game.modules.get(CT)?.active ? game.modules.get(CT).api?.resultModifiers ?? null : null);
const opened = new Map();
const isDamage = (roll) => roll instanceof ds.rolls.DamageRoll && !roll.isHeal;

export const targetStyleOn = () => setting('targetSectionStyle') === 'targetDamage'
  && !!globalThis.ds?.CONFIG?.MessagePart?.targetResult && !game.modules.get('draw-steel-target-damage')?.active;

function pillRow(list, message, partId) {
  if (!setting('showModifiersInChat') || !list?.length) return null;
  const row = document.createElement('div');
  row.className = 'dsbl-td-pills';
  for (const p of list) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `dsbl-td-pill dsbl-td-${p.tone}${p.off ? ' dsbl-td-off' : ''}`;
    pill.innerHTML = `<span class="dsbl-td-short">${esc(p.short ?? p.text)}</span><span class="dsbl-td-full">${esc(p.text)}</span>`;
    setTip(pill, tip('targetPill', { title: p.text, body: [p.sub, L(p.off ? 'pillOn' : 'pillOff')].filter(Boolean).join('<br>') }));
    pill.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      pill.disabled = true;
      await mods()?.toggle(game.messages.get(message.id) ?? message, partId, p.key, p.off);
    });
    row.append(pill);
  }
  return row;
}

function fitLine(line) {
  const result = line.querySelector('.inline-result');
  if (!result) return;
  result.classList.add('dsbl-td-line');
  let split = result.querySelector(':scope > .ctlib-split');
  if (!split) {
    const buttons = [...result.querySelectorAll(':scope > button')];
    if (!buttons.length) return;
    split = document.createElement('span');
    split.className = 'ctlib-split';
    buttons[0].before(split);
    split.append(...buttons);
  }
  split.classList.add('dsbl-td-split');
}

function rollBlock(part, ability) {
  const roll = part.rolls[0];
  const block = document.createElement('div');
  block.className = 'dsbl-td-rollblock';
  const tier = document.createElement('div');
  tier.className = 'dsbl-td-tier';
  tier.innerHTML = `<span class="dsbl-td-tier-label">${esc(L('tier', { n: part.tier }))}</span><span class="dsbl-td-outcome"></span>`;
  ability?.system?.powerRollText?.(part.tier)?.then((text) => { tier.querySelector('.dsbl-td-outcome').innerHTML = text ?? ''; });
  block.append(tier);
  const results = (roll?.dice?.[0]?.results ?? []).filter((r) => r.active !== false);
  const NumericTerm = foundry.dice.terms.NumericTerm;
  let sign = 1;
  let rest = 0;
  for (const term of roll?.terms ?? []) {
    if (term instanceof foundry.dice.terms.OperatorTerm) sign = term.operator === '-' ? -1 : 1;
    else if (term instanceof NumericTerm && !/edge|bane/i.test(term.flavor ?? term.options?.flavor ?? '')) rest += sign * term.number;
  }
  const line = document.createElement('div');
  line.className = 'dsbl-td-rollline';
  const dice = results.map((r) => `<img class="dsbl-td-die" src="${DIE(r.result)}" alt="${r.result}">`).join('');
  line.innerHTML = `<div class="dsbl-td-dice">${dice}<span>${rest >= 0 ? '+' : '-'} ${Math.abs(rest)}</span></div><div class="dsbl-td-total">${roll?.total ?? ''}</div>`;
  block.append(line);
  return block;
}

function quickDamage(sec) {
  const real = sec.querySelector('.message-part-rolls [data-action=applyDamage]');
  if (!real) return null;
  const proxy = real.cloneNode(true);
  proxy.removeAttribute('data-action');
  proxy.classList.add('dsbl-td-quick');
  proxy.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    real.click();
  });
  return proxy;
}

function buildRow(message, part, sec, ability, pills, single) {
  const key = `${message.id}:${part.id}`;
  const row = sec;
  row.classList.add('dsbl-td-row');
  if (opened.get(key) ?? single) row.classList.add('dsbl-td-open');
  const head = document.createElement('div');
  head.className = 'dsbl-td-rowhead';
  const img = sec.querySelector('.message-part-header img');
  if (img) { img.classList.add('dsbl-td-portrait'); head.append(img); }
  const name = sec.querySelector('.message-part-header .targetName');
  if (name) { name.classList.add('dsbl-td-name'); head.append(name); }
  const quick = quickDamage(sec);
  if (quick) head.append(quick);
  const menu = sec.querySelector('.message-part-header [data-action=resultPartContext]');
  if (menu) { menu.classList.add('dsbl-td-menu'); head.append(menu); }
  const chevron = document.createElement('i');
  chevron.className = 'fa-solid fa-chevron-right dsbl-td-chevron';
  head.append(chevron);
  head.addEventListener('click', (event) => {
    if (event.target.closest('button, a, [data-action]')) return;
    row.classList.toggle('dsbl-td-open');
    opened.set(key, row.classList.contains('dsbl-td-open'));
  });

  const body = document.createElement('div');
  body.className = 'dsbl-td-body';
  if (part.rolls[0] instanceof ds.rolls.PowerRoll) {
    body.append(rollBlock(part, ability));
    const rp = pillRow(pills?.roll, message, part.id);
    if (rp) body.append(rp);
  }
  const rolls = sec.querySelector('.message-part-rolls');
  const damageIdx = part.rolls.map((r, i) => (isDamage(r) ? i : -1)).filter((i) => i >= 0);
  let d = 0;
  for (const line of [...(rolls?.children ?? [])]) {
    if (line.matches('.dice-roll.expanded, dl.power-roll-display')) continue;
    if (line.matches('.dice-roll') && line.querySelector('[data-action=applyDamage]')) {
      const index = damageIdx[d++];
      fitLine(line);
      body.append(line);
      const p = pillRow(pills?.damage?.[index], message, part.id);
      if (p) body.append(p);
    } else if (line.matches('.dsct-fm-roll')) {
      const index = Number(line.dataset.fmIndex ?? 0);
      fitLine(line);
      body.append(line);
      const p = pillRow(pills?.forced?.[index], message, part.id);
      if (p) body.append(p);
    } else if (line.matches('.dsct-effect-roll')) {
      const id = line.dataset.effectId;
      fitLine(line);
      body.append(line);
      const p = pillRow(pills?.effects?.[id], message, part.id);
      if (p) body.append(p);
    } else {
      if (line.matches('.dice-roll')) fitLine(line);
      body.append(line);
    }
  }
  for (const rest of [...sec.children]) if (!rest.matches('.message-part-header, .message-part-rolls')) body.append(rest);
  sec.replaceChildren(head, body);
  return row;
}

function sameRoll(parts) {
  const first = parts[0]?.rolls?.[0];
  return parts.length > 1 && first instanceof ds.rolls.PowerRoll
    && parts.every((p) => p.tier === parts[0].tier && p.rolls[0]?.total === first.total);
}

function adoptFooter(html, panel) {
  const footer = [...html.querySelectorAll('footer.dsct-apply-all-row')].find((f) => !panel.contains(f));
  if (!footer) return;
  const update = footer.querySelector('.dsct-update-targets-wrap');
  if (update) { panel.querySelector(':scope > .dsbl-td-head .dsct-update-targets-wrap')?.remove(); panel.querySelector(':scope > .dsbl-td-head').append(update); }
  const applyAll = footer.querySelector('.ctlib-split.dsct-apply-all');
  if (applyAll) {
    let row = panel.querySelector(':scope > .dsbl-td-applyall');
    if (!row) {
      row = document.createElement('div');
      row.className = 'dsbl-td-applyall';
      panel.querySelector(':scope > .dsbl-td-head').after(row);
    }
    row.replaceChildren(applyAll);
  }
  if (!footer.querySelector('button, .ctlib-split')) footer.remove();
}

export function restyleTargets(message, html) {
  if (!targetStyleOn()) return;
  const built = html.querySelector('.dsbl-td-panel');
  if (built) return adoptFooter(html, built);
  const parts = Array.from(message?.system?.parts?.contents ?? []);
  const found = parts.filter((p) => p.type === 'targetResult')
    .map((part) => ({ part, sec: html.querySelector(`section[data-message-part="${part.id}"]`) }))
    .filter((x) => x.sec);
  if (!found.length) return;
  const use = parts.find((p) => p.type === 'abilityUse');
  const ability = use?.abilityUuid ? fromUuidSync(use.abilityUuid) : null;
  const anchor = [...html.children].find((c) => found.some(({ sec }) => c === sec || c.contains(sec)));
  if (!anchor) return;

  const panel = document.createElement('div');
  panel.className = 'dsbl-td-panel';
  const head = document.createElement('div');
  head.className = 'dsbl-td-head';
  const who = ability?.actor?.name ?? message.speaker?.alias ?? '';
  const area = ability?.system?.keywords?.has?.('area');
  head.innerHTML = `<div class="dsbl-td-title"><strong>${esc(L('targets'))}</strong><span>${esc(L(area ? 'targetingArea' : 'targeting', { name: who }))}</span></div>`;
  const footer = html.querySelector('footer.dsct-apply-all-row');
  const update = footer?.querySelector('.dsct-update-targets-wrap');
  if (update) head.append(update);
  panel.append(head);
  const applyAll = footer?.querySelector('.ctlib-split.dsct-apply-all');
  if (applyAll) {
    const row = document.createElement('div');
    row.className = 'dsbl-td-applyall';
    row.append(applyAll);
    panel.append(row);
  }
  if (footer && !footer.querySelector('button, .ctlib-split')) footer.remove();
  if (sameRoll(found.map((f) => f.part))) panel.append(rollBlock(found[0].part, ability));
  anchor.before(panel);

  const api = mods();
  for (const { part, sec } of found) {
    const row = buildRow(message, part, sec, ability, api?.sections?.(message, part.id) ?? null, found.length === 1);
    const group = sec.closest('details.dsct-squad12');
    if (group) {
      if (!group.closest('.dsbl-td-panel')) { group.classList.add('dsbl-td-group'); panel.append(group); }
      group.querySelector('.dsct-dstd-squad-rows')?.append(row);
    } else panel.append(row);
  }
}

export function applyCompactPills(on = setting('compactPills')) {
  document.body.classList.toggle('dsct-compact-pills', !!on);
}

function migrateCompactPills() {
  const key = `${MODULE_ID}.compactPills`;
  try {
    if (game.settings.storage.get('client').getItem(key) !== null) return;
    if (game.settings.settings.has(`${CT}.compactChatPills`) && game.settings.get(CT, 'compactChatPills')) game.settings.set(MODULE_ID, 'compactPills', true);
  } catch { }
}

export function refreshTargetStyle() {
  for (const li of document.querySelectorAll('li.chat-message[data-message-id]')) {
    const message = game.messages.get(li.dataset.messageId);
    if (message?.system?.parts?.contents?.some?.((p) => p.type === 'targetResult')) ui.chat?.updateMessage?.(message);
  }
}

export function registerTargetStyle() {
  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!targetStyleOn()) return;
    queueMicrotask(() => {
      try { restyleTargets(message, html); } catch (err) { console.warn(`${MODULE_ID} | target style`, err); }
    });
  });
  Hooks.once('ready', () => setTimeout(() => {
    migrateCompactPills();
    applyCompactPills();
    if (!targetStyleOn()) return;
    for (const li of document.querySelectorAll('li.chat-message[data-message-id]')) {
      const message = game.messages.get(li.dataset.messageId);
      if (message) try { restyleTargets(message, li); } catch (err) { console.warn(`${MODULE_ID} | target style`, err); }
    }
  }, 0));
}
