
const lib = () => game.modules.get('draw-steel-ctlib')?.api;

const esc = (value) => foundry.utils.escapeHTML(String(value ?? ''));

export function tip(key, { title, category, body, html, data = {} } = {}) {
  const prefix = `DSBL.tip.${key}`;
  const spec = lib()?.tipFrom?.(prefix, { title, category, body, data }) ?? {
    title: title ?? (game.i18n.has(`${prefix}.title`) ? game.i18n.format(`${prefix}.title`, data) : ''),
    category: '',
    body: body ?? (game.i18n.has(`${prefix}.body`) ? game.i18n.format(`${prefix}.body`, data) : ''),
  };
  return html ? { ...spec, html } : spec;
}

const plain = (spec) => [spec.title, spec.body || (spec.html ? spec.html.replace(/<[^>]+>/g, ' ').trim() : '')].filter(Boolean).join(': ');

export function tipAttrs(spec) {
  const rich = lib()?.tipAttrs;
  return rich ? rich(spec) : `data-tooltip="${esc(plain(spec))}"`;
}

export function setTip(el, spec) {
  const rich = lib()?.setTip;
  if (rich) return rich(el, spec);
  el.dataset.tooltip = plain(spec);
  return el;
}
