# Draw Steel: Battle Log

[![Downloads](https://img.shields.io/github/downloads/TheGenieOfTheCode/draw-steel-battle-log/total?label=Downloads&color=4aa94a)](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/releases)
[![Latest Version](https://img.shields.io/github/downloads/TheGenieOfTheCode/draw-steel-battle-log/latest/total?label=Latest%20Version&color=4aa94a)](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/releases/latest)

*Keeping the logs orderly.*

A module for the Draw Steel system in Foundry VTT. It tidies the chat to be organized in battle and makes a few tweaks the look of abilities in the chat.

**Requires Foundry v14 and the Draw Steel system.**

---

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/genieofthecode)

*If you like what I do, consider donating on Ko-fi. Thanks!*

---

## Documentation

Full documentation is available on the **[Wiki](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/wiki)**.

---

## Cards that match your theme

The system's dark palette does not cover the chat cards. This module fixes that, so the chat is now dark in dark mode.

<div align="center">
  <table>
    <tr>
      <td><img src="docs/images/ability-dark.png" alt="An ability card in the dark theme" width="300"></td>
      <td><img src="docs/images/ability-light.png" alt="The same ability card in the light theme" width="300"></td>
    </tr>
  </table>
</div>

## Cards you can fold away

Click an ability's name and the card folds down to just that name.

<p align="center">
  <img src="docs/images/ability-collapsed.png" alt="The same ability card folded down to a single line showing only its name" width="300">
</p>


## The battle log

Every turn gets a line across the chat log with the name and token of whoever is acting. Click it to ping that token. The name is drawn in the colour of the player running it.

A turn folds away once it is over, leaving one line and a count of what is hidden. Rounds and whole fights fold the same way, so a long session collapses to a handful of lines. Nothing folds while it is still active.

<p align="center">
  <img src="docs/images/turn-markers.png" alt="Two rounds of a fight in the chat log. Round 1 is folded to a single line with a count of four, Round 2 is open, and inside it one turn is open showing an ability card." width="330">
</p>


## Settings

Every feature can be turned off on its own, and each person chooses what they see. The one exception is the record of where the turns fell, which the Director keeps on everybody's behalf.

---

## Installation

Install via the Foundry module browser, or paste this manifest URL directly:

```
https://github.com/TheGenieOfTheCode/draw-steel-battle-log/releases/latest/download/module.json
```

No dependencies. It runs on its own.

---

## Compatibility

- [Draw Steel: Target Damage](https://foundryvtt.com/packages/draw-steel-target-damage)
- [Draw Steel: Combat Tools](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools)
- [Draw Steel Plus](https://github.com/featureJosh/draw-steel-plus) works with this module, but both restyle the same cards and making them work together cleanly isn't a priority.

---

## Issues & Feedback

Bug reports and feature requests go in [Issues](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/issues).

