# Draw Steel: Battle Log

Notes on how this module works and why it is built the way it is. The
[README](https://github.com/TheGenieOfTheCode/draw-steel-battle-log) is the short version: what the
module does and what it looks like. These pages are the long version, kept because most of what is
here was learned the hard way and is not obvious from reading the code.

## Pages

- **[Turn Markers](Turn-Markers)** covers why the markers are drawn into the log rather than posted
  to it, how the Director decides where a line lands, and the two browser behaviours that cost an
  evening each.
- **[Chat Cards](Chat-Cards)** covers the theme fix, why it is needed at all, and how folding a card
  works.

## The shape of it

The module does three things, and only the first is really its own invention.

1. It records where each turn, round and fight began, and draws lines into the chat log at those
   points. Nothing is posted and nothing is written onto anybody's messages.
2. It redeclares the system's dark palette on the chat containers, so the cards follow your theme
   instead of a quirk of how the system scoped its own CSS.
3. It lets you fold an ability card down to its name, and remembers that choice per person.

Everything a player sees is theirs alone, apart from the record of where the turns fell, which the
Director keeps on everybody's behalf.

## History

Called **Draw Steel: Chat Polish** until 2026-09-27, when the turn markers had made the old name
wrong: the log had become the point, rather than the polish. The rename changed the module id, and
a Foundry setting is stored under the id, so `src/migrate.mjs` carries the old settings across the
first time the renamed module loads. It copies rather than moves, so rolling back loses nothing.
