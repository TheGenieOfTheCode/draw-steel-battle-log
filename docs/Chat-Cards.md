# Chat Cards

Two smaller features, both about the system's own cards rather than the log around them.

## Why the theme fix is needed

The system ships a full dark palette. It declares it with:

```css
@scope (.theme-dark) to (.themed)
```

That reads as "apply inside a dark themed element, but stop at the next themed element". The trouble
is that Foundry puts **`themed` and the theme class on the same chat sidebar element**, so the scope
ends exactly where it begins and the palette never reaches the cards inside.

Foundry also has two independent theme settings, Applications and Interface, so the chat can end up
reading the light palette while the rest of the interface is dark. The chat log carries `theme-light`
even then, which is worth knowing before debugging anything else in that log.

This module redeclares the same tokens on the chat containers with a plain selector, resolving them
with `light-dark()` against the `color-scheme` Foundry already sets. Because it works through the
tokens rather than restyling components, panels other modules add to those cards are covered too,
including the Draw Steel: Target Damage panel.

## Folding a card

Clicking the name of an ability folds the card down to just its name. The state is remembered per
person in `localStorage`, so it survives a reload, and it is forgotten when the message is deleted.

Folding hides the description, the system's own use buttons, and the Target Damage panel if that
module is present. A power roll result in the same message stays visible, because that is the part you
are usually scrolling back to find.

The clickable element is the embed's own `h5`, which gets a caret prepended and a class of its own.
The caret is marked `inert` so a click always lands on the heading rather than the icon.

## Draw Steel Plus

The manifest lists Draw Steel Plus as a conflict. Nothing breaks if both are enabled and in practice
they run side by side, but both restyle the same cards and the two looks can fight. Matching them is
not planned.

Foundry treats a `conflicts` relationship as a note rather than a block, so it appears in the module
listing and the choice is left to the user.
