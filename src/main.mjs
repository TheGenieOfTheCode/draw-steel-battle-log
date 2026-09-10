import { makeAbilitiesCollapsible, forgetMessage, pruneCollapsedState } from './collapse.mjs';

export const MODULE_ID = 'draw-steel-chat-polish';

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
  if (!setting('collapsibleAbilities')) return;
  makeAbilitiesCollapsible(message, html);
});

Hooks.on('deleteChatMessage', message => forgetMessage(message.id));

function syncBodyClasses() {
  document.body.classList.toggle('dscp-dark-chat', setting('darkChat'));
  document.body.classList.toggle('dscp-collapse', setting('collapsibleAbilities'));
}
