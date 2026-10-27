import { makeAbilitiesCollapsible, forgetMessage, pruneCollapsedState } from './collapse.mjs';
import { compactAbilityMetadata, inlineEffectLabels } from './compact.mjs';
import { collapsePowerRolls } from './power-roll.mjs';
import { flexMessageButtons } from './buttons.mjs';
import { registerTurnRecording, scheduleDraw, draw, pruneBoundaries, pruneEmptySections, schedulePrune, noteMessage, olderCombatToolsLogs, currentTurn, watchClearAll, addMarkerMenu } from './turn-markers.mjs';
import { registerResourceRecording, addResourceToggle, syncResourceToggle, markCovered } from './resource-log.mjs';
import { registerChatTabs } from './chat-tabs.mjs';
import { registerEffectRecording } from './effect-log.mjs';
import { MODULE_ID } from './collapse.mjs';
import { migrateLocalStorage, migrateWorldSettings, MIGRATED } from './migrate.mjs';
import { addSpeakerRow, renderSpeech, scheduleSpeakerRefresh, scheduleBlend, watchChatLogs } from './speech.mjs';
import { registerCompatibilityMenu } from './compat-menu.mjs';
import { registerLoadOlder } from './load-older.mjs';
import { onEveryDocument, toggleBodyClass } from './windows.mjs';

export { MODULE_ID };

migrateLocalStorage(MODULE_ID);

const setting = key => game.settings.get(MODULE_ID, key);

Hooks.once('init', () => {
  registerCompatibilityMenu();
  registerChatTabs();

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

  for (const key of ['turnMarkersCombats', 'turnMarkersRounds', 'turnMarkersTurns', 'turnMarkersAutoCollapse']) {
    game.settings.register(MODULE_ID, key, {
      name: `DSBL.Settings.${key}.name`,
      hint: `DSBL.Settings.${key}.hint`,
      scope: 'client',
      config: true,
      type: Boolean,
      default: true,
      onChange: () => draw(),
    });
  }

  game.settings.register(MODULE_ID, 'loadOlderMessages', {
    name: 'DSBL.Settings.loadOlderMessages.name',
    hint: 'DSBL.Settings.loadOlderMessages.hint',
    scope: 'client',
    config: true,
    type: String,
    choices: {
      button: 'DSBL.Settings.loadOlderMessages.button',
      scroll: 'DSBL.Settings.loadOlderMessages.scroll',
    },
    default: 'button',
    onChange: () => draw(),
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

  game.settings.register(MODULE_ID, 'effectLog', {
    name: 'DSBL.Settings.effectLog.name',
    hint: 'DSBL.Settings.effectLog.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => { addResourceToggle(); scheduleDraw(); },
  });

  game.settings.register(MODULE_ID, 'effectLogEntries', { scope: 'world', config: false, type: Array, default: [], onChange: scheduleDraw });

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
  registerEffectRecording({ currentTurn });
  registerLoadOlder();
  addResourceToggle();
  watchClearAll();

  await migrateWorldSettings(MODULE_ID, 'turnBoundaries');
  pruneBoundaries();
  pruneEmptySections();
  scheduleDraw();
});

Hooks.on('renderChatInput', (_app, elements) => {
  addResourceToggle(elements?.['#chat-controls']);
});

Hooks.once('ready', () => {
  const H = (key) => `DSBL.Settings.Headers.${key}`;
  game.modules.get('draw-steel-ctlib')?.api?.registerSettingsLayout?.(MODULE_ID, [
    { label: H('chatCards'), wiki: 'Compact-Abilities', items: ['darkChat', 'compactAbilities', 'collapsibleAbilities', 'powerRollResults', 'flexButtons'] },
    { label: H('typedChat'), wiki: 'Clean-Comms', items: ['speakerPicker', 'compactSpeech', 'blendSpeech', 'mentionNames'] },
    { label: H('turnMarkers'), wiki: 'Turn-Markers', items: ['turnMarkers', 'turnMarkersCombats', 'turnMarkersRounds', 'turnMarkersTurns',
      'turnMarkersAutoCollapse', 'loadOlderMessages'] },
    { label: H('resourceLog'), wiki: 'Resource-Log', items: ['resourceLog', 'resourceLogFullInfo', 'resourceLogOutOfCombat', 'resourceLogTokenCards',
      'resourceLogTurnGainCards', 'effectLog'] },
  ], {
    dependencies: {
      turnMarkersCombats: 'turnMarkers',
      turnMarkersRounds: 'turnMarkers',
      turnMarkersTurns: 'turnMarkers',
      turnMarkersAutoCollapse: 'turnMarkers',
    },
    wiki: {
      base: 'https://github.com/TheGenieOfTheCode/draw-steel-battle-log/wiki/',
      pages: {
        darkChat: 'Compact-Abilities#why-the-theme-fix-is-needed',
        collapsibleAbilities: 'Compact-Abilities#folding-a-message',
        speakerPicker: 'Clean-Comms#speaking-as',
        compactSpeech: 'Clean-Comms#compact-messages',
        blendSpeech: 'Clean-Comms#joining-messages',
        mentionNames: 'Clean-Comms#highlighting-names',
        effectLog: 'Effect-Log',
      },
    },
  });
});

Hooks.on('renderChatLog', scheduleDraw);
Hooks.on('renderChatLog', () => { addSpeakerRow(); watchChatLogs(); scheduleBlend(); });
Hooks.on('renderChatLog', (_app, html) => addMarkerMenu(html));

Hooks.on('canvasReady', scheduleDraw);

Hooks.on('createChatMessage', noteMessage);
Hooks.on('deleteChatMessage', () => { scheduleDraw(); schedulePrune(); });

Hooks.on('renderChatMessageHTML', (message, html) => {
  if (setting('compactAbilities')) {
    inlineEffectLabels(html);
    compactAbilityMetadata(html);
  }
  if (setting('powerRollResults')) collapsePowerRolls(message, html);
  if (setting('flexButtons')) flexMessageButtons(html);
  if (setting('compactSpeech')) renderSpeech(message, html);
  markCovered(message, html);
  if (!setting('collapsibleAbilities')) return;
  makeAbilitiesCollapsible(message, html);
});

Hooks.on('renderChatMessageHTML', scheduleDraw);


Hooks.on('renderChatPopout', (app) => {
  if (!setting('darkChat') || !document.getElementById('interface')?.classList.contains('theme-dark')) return;
  app.element?.classList.replace('theme-light', 'theme-dark');
});

Hooks.on('deleteChatMessage', message => forgetMessage(message.id));

function syncBodyClasses() {
  toggleBodyClass('dsbl-dark-chat', setting('darkChat'));
  toggleBodyClass('dsbl-collapse', setting('collapsibleAbilities'));
  toggleBodyClass('dsbl-compact', setting('compactAbilities'));
  toggleBodyClass('dsbl-power-roll', setting('powerRollResults'));
  toggleBodyClass('dsbl-flex-buttons', setting('flexButtons'));
  toggleBodyClass('dsbl-turn-markers', setting('turnMarkers'));
}

onEveryDocument((doc) => doc.addEventListener('scroll', (event) => {
  const log = event.target;
  if (!log?.classList?.contains('chat-scroll')) return;
  const pct = log.scrollTop / (log.scrollHeight - log.clientHeight);
  if (!(pct < 0.01)) return;
  if (log.closest('.chat-sidebar, #chat, .application')?.querySelector('.jump-to-bottom')?.hidden) return;
  const loaded = log.querySelectorAll('li.chat-message[data-message-id]').length;
  if (loaded < game.messages.contents.filter((m) => m.visible).length) return;
  event.stopPropagation();
}, { capture: true, passive: true }));
