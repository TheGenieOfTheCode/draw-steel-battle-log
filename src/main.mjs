import { makeAbilitiesCollapsible, forgetMessage, pruneCollapsedState } from './collapse.mjs';
import { compactAbilityMetadata, inlineEffectLabels } from './compact.mjs';
import { collapsePowerRolls } from './power-roll.mjs';
import { flexMessageButtons } from './buttons.mjs';
import { MODULE_ID } from './collapse.mjs';

export { MODULE_ID };

const setting = key => game.settings.get(MODULE_ID, key);

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'darkChat', {
    name: 'DSCP.Settings.darkChat.name',
    hint: 'DSCP.Settings.darkChat.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'compactAbilities', {
    name: 'DSCP.Settings.compactAbilities.name',
    hint: 'DSCP.Settings.compactAbilities.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'powerRollResults', {
    name: 'DSCP.Settings.powerRollResults.name',
    hint: 'DSCP.Settings.powerRollResults.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'flexButtons', {
    name: 'DSCP.Settings.flexButtons.name',
    hint: 'DSCP.Settings.flexButtons.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'collapsibleAbilities', {
    name: 'DSCP.Settings.collapsibleAbilities.name',
    hint: 'DSCP.Settings.collapsibleAbilities.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });
});

Hooks.once('ready', () => {
  syncBodyClasses();
  pruneCollapsedState();
});

Hooks.on('renderChatMessageHTML', (message, html) => {
  if (setting('compactAbilities')) {
    inlineEffectLabels(html);
    compactAbilityMetadata(html);
  }
  if (setting('powerRollResults')) collapsePowerRolls(message, html);
  if (setting('flexButtons')) flexMessageButtons(html);
  if (!setting('collapsibleAbilities')) return;
  makeAbilitiesCollapsible(message, html);
});

Hooks.on('deleteChatMessage', message => forgetMessage(message.id));

function syncBodyClasses() {
  document.body.classList.toggle('dscp-dark-chat', setting('darkChat'));
  document.body.classList.toggle('dscp-collapse', setting('collapsibleAbilities'));
  document.body.classList.toggle('dscp-compact', setting('compactAbilities'));
  document.body.classList.toggle('dscp-power-roll', setting('powerRollResults'));
  document.body.classList.toggle('dscp-flex-buttons', setting('flexButtons'));
}
