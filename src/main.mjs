import { makeAbilitiesCollapsible, forgetMessage, pruneCollapsedState } from './collapse.mjs';
import { compactAbilityMetadata, inlineEffectLabels } from './compact.mjs';
import { collapsePowerRolls } from './power-roll.mjs';
import { flexMessageButtons } from './buttons.mjs';
import { registerTurnRecording, scheduleDraw, draw, pruneBoundaries, pruneEmptySections, schedulePrune, noteDeletion, olderCombatToolsLogs } from './turn-markers.mjs';
import { MODULE_ID } from './collapse.mjs';
import { migrateLocalStorage, migrateWorldSettings, MIGRATED } from './migrate.mjs';

export { MODULE_ID };


migrateLocalStorage(MODULE_ID);

const setting = key => game.settings.get(MODULE_ID, key);

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'darkChat', {
    name: 'DSBL.Settings.darkChat.name',
    hint: 'DSBL.Settings.darkChat.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'compactAbilities', {
    name: 'DSBL.Settings.compactAbilities.name',
    hint: 'DSBL.Settings.compactAbilities.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'powerRollResults', {
    name: 'DSBL.Settings.powerRollResults.name',
    hint: 'DSBL.Settings.powerRollResults.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'flexButtons', {
    name: 'DSBL.Settings.flexButtons.name',
    hint: 'DSBL.Settings.flexButtons.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });

  game.settings.register(MODULE_ID, 'turnMarkers', {
    name: 'DSBL.Settings.turnMarkers.name',
    hint: 'DSBL.Settings.turnMarkers.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => { syncBodyClasses(); draw(); },
  });

  
  game.settings.register(MODULE_ID, 'turnBoundaries', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: scheduleDraw,
  });

  game.settings.register(MODULE_ID, MIGRATED, { scope: 'world', config: false, type: Array, default: [] });

  game.settings.register(MODULE_ID, 'collapsibleAbilities', {
    name: 'DSBL.Settings.collapsibleAbilities.name',
    hint: 'DSBL.Settings.collapsibleAbilities.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: syncBodyClasses,
  });
});

Hooks.once('ready', async () => {
  syncBodyClasses();
  pruneCollapsedState();
  if (olderCombatToolsLogs()) {
    if (game.user.isGM) ui.notifications.warn(game.i18n.format('DSBL.notice.olderCombatTools', { version: game.modules.get('draw-steel-combat-tools')?.version ?? '' }), { permanent: true });
  } else registerTurnRecording();
  
  await migrateWorldSettings(MODULE_ID, 'turnBoundaries');
  pruneBoundaries();
  pruneEmptySections();
  scheduleDraw();
});

Hooks.on('renderChatLog', scheduleDraw);

Hooks.on('canvasReady', scheduleDraw);

Hooks.on('preDeleteChatMessage', noteDeletion);
Hooks.on('deleteChatMessage', () => { scheduleDraw(); schedulePrune(); });

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

Hooks.on('renderChatMessageHTML', scheduleDraw);

Hooks.on('deleteChatMessage', message => forgetMessage(message.id));

function syncBodyClasses() {
  document.body.classList.toggle('dsbl-dark-chat', setting('darkChat'));
  document.body.classList.toggle('dsbl-collapse', setting('collapsibleAbilities'));
  document.body.classList.toggle('dsbl-compact', setting('compactAbilities'));
  document.body.classList.toggle('dsbl-power-roll', setting('powerRollResults'));
  document.body.classList.toggle('dsbl-flex-buttons', setting('flexButtons'));
  document.body.classList.toggle('dsbl-turn-markers', setting('turnMarkers'));
}
