import { MODULE_ID } from './collapse.mjs';

const L = key => game.i18n.localize(`DSBL.Compat.${key}`);

const MODULES = [
  { id: 'CautiousGamemastersPack', title: "Cautious Gamemaster's Pack", key: 'cgmp' },
  { id: 'draw-steel-plus', title: 'Draw Steel Plus', key: 'dsPlus' },
  { id: 'polyglot', title: 'Polyglot', key: 'polyglot' },
];

const active = id => game.modules.get(id)?.active ?? false;

export function registerCompatibilityMenu() {
  const Base = game.modules.get('draw-steel-ctlib')?.api?.settingsSubmenu?.();
  if (!Base) return;

  class CompatibilitySettingsMenu extends Base {
    static DEFAULT_OPTIONS = {
      id: 'dsbl-compatibility-settings',
      window: { title: 'DSBL.Compat.title' },
    };

    static get moduleId() { return MODULE_ID; }

    static get regularKeys() {
      const keys = [];
      for (const m of MODULES.filter(m => active(m.id))) {
        keys.push({ isSectionHeader: true, label: m.title });
        keys.push({ isInfo: true, name: L(`${m.key}.name`), hint: L(`${m.key}.hint`), isActive: true });
      }
      return keys;
    }

    async render(...args) {
      if (!this.constructor.regularKeys.length) return void ui.notifications.info(L('none'));
      return super.render(...args);
    }
  }

  game.settings.registerMenu(MODULE_ID, 'compatibilitySettings', {
    name: 'DSBL.Settings.compatibilitySettings.name',
    label: 'DSBL.Settings.compatibilitySettings.label',
    hint: 'DSBL.Settings.compatibilitySettings.hint',
    icon: 'fas fa-puzzle-piece',
    type: CompatibilitySettingsMenu,
    restricted: true,
  });
}
