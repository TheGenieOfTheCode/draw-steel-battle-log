# Draw Steel: Battle Log

[![Downloads](https://img.shields.io/github/downloads/TheGenieOfTheCode/draw-steel-battle-log/total?label=Downloads&color=4aa94a)](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/releases)
[![Latest Version](https://img.shields.io/github/downloads/TheGenieOfTheCode/draw-steel-battle-log/latest/total?label=Latest%20Version&color=4aa94a)](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/releases/latest)

*Keeping the logs orderly.*

A module for the Draw Steel system in Foundry VTT. It tidies the chat to be organized in battle and makes a few tweaks the look of abilities in the chat.

**Requires Foundry v14, the Draw Steel system, and [Draw Steel: CTLib](https://github.com/TheGenieOfTheCode/draw-steel-ctlib).**

---

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/genieofthecode)

*If you like what I do, consider donating on Ko-fi. Thanks!*

---

## Documentation

Full documentation is available on the **[Wiki](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/wiki)**.

---

## Dark Theme 

The system's dark palette does not cover the chat, now interface includes the chat as well.

<div align="center">
  <table>
    <tr>
      <td><img src="images/ability-dark.png" alt="An ability card in the dark theme" width="300"></td>
      <td><img src="images/ability-light.png" alt="The same ability card in the light theme" width="300"></td>
    </tr>
  </table>
</div>

## Compact Abilities

Click an ability's name and the card folds down to just that name, good for when you're done with an ability. The message format is also restructured so it fits the basic details in less space like in the books while preserving the default Draw Steel Foundry aesthetic.

<p align="center">
  <img src="images/ability-collapsed.png" alt="The same ability card folded down to a single line showing only its name" width="300">
</p>


## Clean Comms

OOC or IC messages can fit on one line (as long as you're not playing a high elf with a canon name) and should overall take less space. They also carry a little portrait of the speaker, which is clickable if the speaker is a token. Finally, messages blend together if they're from the same speaker.

<div align="center">
  <table>
    <tr>
      <td><img src="images/clean-comms-dark.png" alt="A conversation in the chat log in the dark theme. Each line shows the speaker's portrait and name, two emotes are in italics, a whisper from the Director is at the bottom, and the row above the chat buttons reads Speaking as Agatha Pinwhistle." width="300"></td>
      <td><img src="images/clean-comms-light.png" alt="The same conversation in the light theme" width="300"></td>
    </tr>
  </table>
</div>

## Turn Markers

Every turn gets a line across the chat log with the name and token of whoever is acting. Click it to ping that token. The name is drawn in the colour of the player running it. 

A turn marker folds away the messages during it once it ends, leaving one line and a count of how many messages are hidden. Rounds and whole fights fold the same way, so a long session collapses to a handful of lines. None of the markers can be collapsed while what they contain is still active (turn, round, combat).

<p align="center">
  <img src="images/turn-markers.png" alt="Two rounds of a fight in the chat log. Round 1 is folded to a single line with a count of four, Round 2 is open, and inside it one turn is open showing an ability card." width="330">
</p>


## Settings

Every feature can be turned off on its own, and each person chooses what they see. The one exception is the record of where the turns fell, which the Director keeps on everybody's behalf.

---

## Installation

Install via the Foundry module browser, or paste this manifest URL directly:

```
https://github.com/TheGenieOfTheCode/draw-steel-battle-log/releases/latest/download/module.json
```

Requires [Draw Steel: CTLib](https://github.com/TheGenieOfTheCode/draw-steel-ctlib), the shared library behind these modules. Foundry offers to install it alongside.

---

## Compatibility

- [Draw Steel: Target Damage](https://foundryvtt.com/packages/draw-steel-target-damage)
- [Draw Steel: Combat Tools](https://github.com/TheGenieOfTheCode/draw-steel-combat-tools)
- [Draw Steel Plus](https://github.com/featureJosh/draw-steel-plus) works with this module, but both restyle the same cards and making them work together cleanly isn't a priority.

---

## Issues & Feedback

Bug reports and feature requests go in [Issues](https://github.com/TheGenieOfTheCode/draw-steel-battle-log/issues).

