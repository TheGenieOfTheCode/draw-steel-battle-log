import { makeAbilitiesCollapsible, forgetMessage, pruneCollapsedState } from './collapse.mjs';
import { compactAbilityMetadata, inlineEffectLabels } from './compact.mjs';
import { collapsePowerRolls } from './power-roll.mjs';
import { flexMessageButtons } from './buttons.mjs';
import { registerTurnRecording, scheduleDraw, draw, pruneBoundaries, pruneEmptySections, schedulePrune, noteDeletion, olderCombatToolsLogs, currentTurn, watchClearAll } from './turn-markers.mjs';
import { registerResourceRecording, addResourceToggle, syncResourceToggle, markTurnGain } from './resource-log.mjs';
import { MODULE_ID } from './collapse.mjs';
import { migrateLocalStorage, migrateWorldSettings, MIGRATED } from './migrate.mjs';
import { addSpeakerRow, renderSpeech, scheduleSpeakerRefresh, scheduleBlend, watchChatLogs } from './speech.mjs';

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

  game.settings.register(MODULE_ID, 'collapsibleAbilities', {
    name: 'DSBL.Settings.collapsibleAbilities.name',
    hint: 'DSBL.Settings.collapsibleAbilities.hint',
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

  game.settings.register(MODULE_ID, 'speakerPicker', {
    name: 'DSBL.Settings.speakerPicker.name',
    hint: 'DSBL.Settings.speakerPicker.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, 'compactSpeech', {
    name: 'DSBL.Settings.compactSpeech.name',
    hint: 'DSBL.Settings.compactSpeech.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, 'blendSpeech', {
    name: 'DSBL.Settings.blendSpeech.name',
    hint: 'DSBL.Settings.blendSpeech.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: scheduleBlend,
  });

  game.settings.register(MODULE_ID, 'mentionNames', {
    name: 'DSBL.Settings.mentionNames.name',
    hint: 'DSBL.Settings.mentionNames.hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
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

  game.settings.register(MODULE_ID, 'resourceLog', {
    name: 'DSBL.Settings.resourceLog.name',
    hint: 'DSBL.Settings.resourceLog.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => { addResourceToggle(); syncBodyClasses(); scheduleDraw(); },
  });

  game.settings.register(MODULE_ID, 'resourceLogFullInfo', {
    name: 'DSBL.Settings.resourceLogFullInfo.name',
    hint: 'DSBL.Settings.resourceLogFullInfo.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: scheduleDraw,
  });

  game.settings.register(MODULE_ID, 'resourceLogOutOfCombat', {
    name: 'DSBL.Settings.resourceLogOutOfCombat.name',
    hint: 'DSBL.Settings.resourceLogOutOfCombat.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, 'resourceLogTokenCards', {
    name: 'DSBL.Settings.resourceLogTokenCards.name',
    hint: 'DSBL.Settings.resourceLogTokenCards.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, 'resourceLogTurnGainCards', {
    name: 'DSBL.Settings.resourceLogTurnGainCards.name',
    hint: 'DSBL.Settings.resourceLogTurnGainCards.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => { syncBodyClasses(); scheduleDraw(); },
  });

  game.settings.register(MODULE_ID, 'resourceLogEntries', { scope: 'world', config: false, type: Array, default: [], onChange: scheduleDraw });

  game.settings.register(MODULE_ID, 'resourceLogShown', { scope: 'client', config: false, type: Boolean, default: true, onChange: () => { syncResourceToggle(); scheduleDraw(); } });

  game.settings.register(MODULE_ID, 'turnBoundaries', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: scheduleDraw,
  });

  game.settings.register(MODULE_ID, MIGRATED, { scope: 'world', config: false, type: Array, default: [] });

  game.settings.register(MODULE_ID, 'speakAs', { scope: 'client', config: false, type: Object, default: { kind: 'selected' }, onChange: scheduleSpeakerRefresh });
});

Hooks.once('ready', async () => {
  syncBodyClasses();
  pruneCollapsedState();
  if (olderCombatToolsLogs()) {
    if (game.user.isGM) ui.notifications.warn(game.i18n.format('DSBL.notice.olderCombatTools', { version: game.modules.get('draw-steel-combat-tools')?.version ?? '' }), { permanent: true });
  } else registerTurnRecording();
  registerResourceRecording({ currentTurn });
  addResourceToggle();
  watchClearAll();

  await migrateWorldSettings(MODULE_ID, 'turnBoundaries');
  pruneBoundaries();
  pruneEmptySections();
  scheduleDraw();
});

const SETTING_HEADERS = {
  darkChat: 'chatCards',
  speakerPicker: 'typedChat',
  turnMarkers: 'turnMarkers',
  resourceLog: 'resourceLog',
};

Hooks.on('renderChatInput', (_app, elements) => addResourceToggle(elements?.['#chat-controls']));

Hooks.on('renderSettingsConfig', (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  for (const [key, header] of Object.entries(SETTING_HEADERS)) {
    const el = root.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest('.form-group')
      ?? root.querySelector(`[data-setting-id="${MODULE_ID}.${key}"]`);
    if (!el || el.previousElementSibling?.classList?.contains('dsbl-settings-header')) continue;
    const h = document.createElement('h3');
    h.className = 'dsbl-settings-header';
    h.textContent = game.i18n.localize(`DSBL.Settings.Headers.${header}`);
    el.insertAdjacentElement('beforebegin', h);
  }
});

Hooks.on('renderChatLog', scheduleDraw);
Hooks.on('renderChatLog', () => { addSpeakerRow(); watchChatLogs(); scheduleBlend(); });

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
  if (setting('compactSpeech')) renderSpeech(message, html);
  markTurnGain(message, html);
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
  document.body.classList.toggle('dsbl-hide-turn-gain', setting('resourceLog') && setting('resourceLogTurnGainCards'));
}
