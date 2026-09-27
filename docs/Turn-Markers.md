# Turn Markers

The markers are lines drawn **into** the chat log, never posted to it. Nothing is stored on anybody's
messages, and turning the feature off leaves no trace behind.

## Why they cannot be chat messages

The obvious build is to post "so and so starts their turn" and let it sit in the log like everything
else. That cannot work, and the reason is a matter of ordering rather than taste.

The system posts a hero's start of turn resource gain from `Combatant._preUpdate`, and Foundry awaits
that before it calls any `preUpdateCombatant` hook, let alone `combatTurnChange`. **The message
therefore exists before the turn does.** No hook fires early enough to get a "turn started" message
above it, so a posted marker would always land underneath the first thing the turn said.

So the Director records a **boundary** instead: the id of the last message that existed at that
moment. The marker is then drawn above whatever that id points at.

Message order is identical on every client. Wall clocks are not. Nothing here depends on a timestamp.

## Where the line lands

Recording the last message id is not quite enough, because between two turns there is usually a small
pile of messages that could belong to either side.

When it records a boundary, the Director walks back over any trailing messages spoken by the
combatant who is **about to** act, and puts the line above them. The rule in one sentence:

> In the gap between two turns, a message belongs to whoever speaks it if that is the next combatant,
> and otherwise to the turn that just ended.

That is what puts a hero's resource gain below their start marker, while end of turn effects stay
above the end marker. Both end up where a reader expects them.

The walk back stops at the moment the previous turn ended, so a triggered action taken during someone
else's turn stays in that turn rather than being dragged forward.

The end marker only appears once the next turn begins, because that is the first moment anything can
prove the previous turn actually finished.

## Folding

Every level folds: a turn, the round holding it, and the fight holding that. Folding one level never
disturbs the level below it, so opening a round gives its turns back exactly as they were left.

Nothing folds while it is still happening. The turn being taken stays open, so does its round, and so
does the fight until combat ends. This is not a preference, it is enforced: the one thing on screen
that is still going is the one thing you cannot hide.

A choice made by hand outranks the automatic folding from then on. Choices live in `localStorage`
under `turnFolds`, capped so the map cannot grow without limit.

**The fold map is cached in memory on first read.** Writing `localStorage` after that does nothing
until a reload, which matters when scripting the module rather than clicking it.

## Empty sections

A round nobody spoke in would otherwise leave a heading with nothing under it. Empty rounds and
encounters are dropped from the **record** once they close, at load and at combat end.

Doing this at draw time is the obvious fix and the wrong one: when a fight starts nothing has been
said yet, so it hides the very headings that announce it. A section is judged empty by its boundary
carrying the same anchor id as its closer, which means nothing landed between them. A section with no
closer is still running and is left alone.

## Squad rosters

A turn shows the roster it had when it began. A squad that loses minions later still shows its full
strength on the turn it took before those losses, because the faces are recorded **with the boundary**
rather than asked of the group afterwards.

## Two browser behaviours that cost an evening each

**`pointer-events` is inherited, and something above the chat log sets it to `none`** so the empty
chat column does not swallow clicks meant for the canvas. Messages take it back with
`pointer-events: all`. Anything else put in the log has to do the same or it is invisible to the
mouse: `elementFromPoint` over a marker returned `CANVAS`.

**Markers are `li.message`, never `chat-message`.** Scrolling into the top of the log makes Foundry
pin the view to the first `li.message` it finds, in `#onScrollLog`. A marker above that point could be
scrolled to and never seen: `scrollTop = 0` settled at 155 pixels. As an `li.message` the pin lands on
the marker instead. `chat-message` is the class that draws a card, and every other `.message` lookup in
that log also asks for a `data-message-id`, which a marker does not have.

Two smaller ones from the same evening. The list does not scroll, `div.chat-scroll` does, so reading
`scrollTop` off the `ol` gives a constant zero and silently turns scroll restoring into nothing. And
the log carries `theme-light` even when the interface is dark, so the marker ink follows an ancestor
carrying `theme-dark` rather than the log's own class, or it comes out near black on a near black card.

## Limits

- Turns from before the module was installed have no boundary, so they are not marked. Nothing is
  filled in after the fact.
- Only the Director records. Everyone sees the markers because the record is world scoped, but a game
  with no Director present records nothing.
- A boundary whose anchor message has scrolled out of the rendered batch is skipped until you scroll
  back up to it.
