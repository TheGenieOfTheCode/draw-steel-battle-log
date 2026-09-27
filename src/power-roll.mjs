import { isStored, setStored, MODULE_ID } from './collapse.mjs';

const DIE = (face) => `modules/${MODULE_ID}/icons/dice/die-${face}.png`;

const hasTargetPanel = (message, html) =>
  !!html.querySelector('[class*="draw-steel-target-damage"]')
  || !!message?.flags?.['draw-steel-target-damage']?.state;

function buildRolls(html, characteristic, message) {
  let sources = [...html.querySelectorAll('.dice-roll')];
  if (hasTargetPanel(message, html)) sources = sources.filter(s => s.querySelector('.tier'));
  if (!sources.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'dsbl-pr-rolls';

  for (const source of sources) {
    const row = document.createElement('div');
    row.className = 'dsbl-pr-row';

    if (sources.length > 1) {
      const who = source.querySelector('.header')?.textContent?.trim();
      if (who) {
        const label = document.createElement('span');
        label.className = 'dsbl-pr-who';
        label.textContent = who;
        row.append(label);
      }
    }

    
    
    const box = document.createElement('div');
    box.className = 'dsbl-pr-box';

    const left = document.createElement('span');
    left.className = 'dsbl-pr-formula';

    for (const die of source.querySelectorAll('ol.dice-rolls li.roll')) {
      const face = die.textContent.trim();
      const dropped = die.classList.contains('discarded') || die.classList.contains('rerolled');

      if (/^([1-9]|10)$/.test(face)) {
        const img = document.createElement('img');
        img.className = 'dsbl-pr-die';
        img.src = DIE(face);
        img.alt = face;
        if (dropped) img.classList.add('dsbl-pr-dropped');
        left.append(img);
      } else {
        const chip = document.createElement('span');
        chip.className = 'dsbl-pr-face';
        chip.textContent = face;
        if (dropped) chip.classList.add('dsbl-pr-dropped');
        left.append(chip);
      }
    }

    
    const formula = source.querySelector('.dice-formula')?.textContent ?? '';
    const bonus = formula.replace(/^\s*\d*d\d+/i, '').trim();
    if (bonus) {
      const chip = document.createElement('span');
      chip.className = 'dsbl-pr-mod';
      chip.textContent = bonus;
      if (characteristic) chip.dataset.tooltip = characteristic;
      left.append(chip);
    }

    box.append(left);

    const total = document.createElement('span');
    total.className = 'dsbl-pr-total';
    total.textContent = source.querySelector('.dice-total')?.textContent?.trim() ?? '';
    box.append(total);

    row.append(box);
    wrap.append(row);
  }

  return wrap;
}

export function collapsePowerRolls(message, html) {
  const sections = html.querySelectorAll('document-embed.draw-steel.ability > section.powerResult');

  sections.forEach((section, index) => {
    if (section.dataset.dscpPr) return;

    const heading = section.querySelector(':scope > p');
    const tiers = section.querySelector(':scope > dl.power-roll-display');
    if (!heading || !tiers) return;

    section.dataset.dscpPr = '1';

    
    const characteristic = heading.querySelector('em')?.textContent?.trim() ?? '';

    const toggle = document.createElement('p');
    toggle.className = 'dsbl-pr-toggle';
    const caret = document.createElement('i');
    caret.className = 'fa-solid fa-caret-down dsbl-caret';
    caret.setAttribute('inert', '');
    toggle.append(caret, document.createTextNode(game.i18n.localize('DSBL.powerRoll.heading')));
    heading.replaceWith(toggle);

    const body = document.createElement('div');
    body.className = 'dsbl-pr-body';
    const rolls = buildRolls(html, characteristic, message);
    if (rolls) body.append(rolls);
    body.append(tiers);
    section.append(body);

    
    const key = `pr-open:${message.id}:${index}`;
    const apply = open => section.classList.toggle('dsbl-pr-open', open);
    apply(isStored(key));

    toggle.addEventListener('click', () => {
      const open = !section.classList.contains('dsbl-pr-open');
      apply(open);
      setStored(key, open);
    });
  });
}
