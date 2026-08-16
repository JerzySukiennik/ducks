# Credits — Ducks

Every sound this game ships, and nothing it does not. The game plays exactly
40 clips, all in `assets/audio/`; this file lists all 40 and where each came from.

Earlier revisions of this file listed 59 attributions for the whole downloaded
library rather than for what was actually used — that is both incomplete (7 of the
shipped CC BY files were missing) and misleading (it credited files the game never
loads). Attribution follows the ship list, not the download folder.

## CC BY 4.0 — attribution required

Field recordings from the **Work With Sounds** project, an EU-funded archive of
industrial and workplace sounds, via Wikimedia Commons. These are the real
machines: the crank, the press, the belt, the fans and the pumps you hear are
recordings of actual industrial equipment, not synthesised.

| In-game sound | Source file | Recorded by |
|---|---|---|
| `box_spill` | [WWS_Crackingnuts.ogg](https://commons.wikimedia.org/wiki/File:WWS_Crackingnuts.ogg) | Work With Sounds / Technical Museum of Slovenia |
| `build_demolish` | [WWS_Pneumaticpick.ogg](https://commons.wikimedia.org/wiki/File:WWS_Pneumaticpick.ogg) | Work With Sounds / Konrad Gutkowski |
| `cart_loop` | [WWS_Woodenwagon.ogg](https://commons.wikimedia.org/wiki/File:WWS_Woodenwagon.ogg) | Work With Sounds / Museum of Municipal Engineering |
| `conveyor_loop` | [WWS_Conveyorbelt.ogg](https://commons.wikimedia.org/wiki/File:WWS_Conveyorbelt.ogg) | Work With Sounds / Konrad Gutkowski |
| `crank_click` | [WWS_Crankwheel.ogg](https://commons.wikimedia.org/wiki/File:WWS_Crankwheel.ogg) | Work With Sounds / Konrad Gutkowski |
| `duck_rare` | [WWS_Signalbell.ogg](https://commons.wikimedia.org/wiki/File:WWS_Signalbell.ogg) | Work With Sounds / Konrad Gutkowski |
| `fan_loop` | [WWS_Airhardeningfans.ogg](https://commons.wikimedia.org/wiki/File:WWS_Airhardeningfans.ogg) | Work With Sounds / Technical Museum of Slovenia |
| `machine_eject` | [WWS_Eccentricpress.ogg](https://commons.wikimedia.org/wiki/File:WWS_Eccentricpress.ogg) | Work With Sounds / Konrad Gutkowski |
| `machine_jam` | [WWS_Firealarm.ogg](https://commons.wikimedia.org/wiki/File:WWS_Firealarm.ogg) | Work With Sounds / Torsten Nilsson |
| `machine_loop` | [WWS_Compressingunit.ogg](https://commons.wikimedia.org/wiki/File:WWS_Compressingunit.ogg) | Work With Sounds / Werstas |
| `player_fall` | [WWS_Siren.ogg](https://commons.wikimedia.org/wiki/File:WWS_Siren.ogg) | Work With Sounds / Konrad Gutkowski |
| `prestige` | [WWS_SteamWhistle.ogg](https://commons.wikimedia.org/wiki/File:WWS_SteamWhistle.ogg) | Work With Sounds / Konrad Gutkowski |
| `tube_drop` | [WWS_Woodenbarrel.ogg](https://commons.wikimedia.org/wiki/File:WWS_Woodenbarrel.ogg) | Work With Sounds / La Fonderie |
| `vacuum_loop` | [WWS_Pump.ogg](https://commons.wikimedia.org/wiki/File:WWS_Pump.ogg) | Work With Sounds / La Fonderie |

All of the above are licensed CC BY 4.0:
<https://creativecommons.org/licenses/by/4.0/>. They are trimmed, level-adjusted
and re-rendered for the game (see **Processing** below), which makes them
adaptations; the licence permits this and requires only the attribution given
above.

## CC0 / public domain — no attribution required

Attribution is not required for these, but crediting the people who gave the
work away for free costs nothing.

- **Kenney — Impact Sounds** — `build_place`, `duck_impact`, `footstep`
- **Kenney — Interface Sounds** — `buy_fail`, `buy_ok`, `duck_pit`, `player_join`, `shop_close`, `shop_open`, `tab_switch`, `ui_hover`
- **Kenney — UI Audio** — `build_rotate`, `ui_click`
- **Kenney — RPG Audio** — `broom`, `cash`, `grab`
- **Kenney — Music Jingles** — `achievement`, `session_end`
- **Kenney — Sci-Fi Sounds** — `pit_burp`
- **Local universal-audio library** — `jump_land`, `pit_ambient`, `radio`, `world_ambient`

Kenney assets: <https://kenney.nl/assets> (CC0 1.0).

## Generated for this project — no third-party material

- `throw` and `build_invalid` are SYNTHESIZED, not sourced. Both were previously
  byte-identical copies of another clip in the set (`throw` = `broom`, so every
  throw sounded like sweeping a floor; `build_invalid` = `buy_fail`, so "you
  cannot put it there" and "you cannot afford it" were the same sound). They were
  replaced with original audio generated from noise and oscillators — a swept
  band-passed whoosh and a two-step wooden refusal — so the duplication is gone
  and nothing new was brought in from outside. They are moved from the Kenney
  lists above for that reason: the files no longer contain that work.
- The pit payoff (`duck_pit`) and the gambling box (`gamble_box`) have no files at
  all — they are built live in `src/audio/pitsynth.js` and
  `src/audio/gamblesynth.js`.
- The **room** has no file either. The reverb send added in `src/audio/bus.js`
  runs a `ConvolverNode` whose impulse response is generated at boot from noise,
  an exponential decay and five discrete early reflections (`buildImpulse`). An
  impulse response of a real hall would be a download and a third-party licence;
  a concrete box is arithmetic.

## Processing — what was done to every file, and why it is still their work

The whole bank was re-rendered by `tools/audio-bank.py`, in one pass, from the
files that were already here. **Nothing was fetched, sourced or substituted**:
every output is the corresponding input, resampled and level-adjusted, so the
attributions above are unchanged and remain complete.

What the pass does:

- **44 100 Hz** instead of 22 050. The sources were 22 050 Hz 56 kbps, which
  cannot hold anything above 11 kHz — so the bank had no top end at all, and
  resampling on its own would not have given it one. The missing octave is
  **generated from each clip's own 5–11 kHz band**, folded up through `|v|·v`
  and set to the level that clip's own spectral slope predicts, capped 9 dB
  under the band it came from. It is derived from the recording and from
  nothing else; no new material enters the project and no new attribution is
  owed.
- **Levels matched** to ±3 dB inside each category, on the loudest K-weighted
  10 ms.
- **−1 dBFS ceiling**, verified by decoding each finished mp3 and measuring it,
  because an mp3's decoded waveform can overshoot the samples that went in —
  which is how ten files in the old bank ended up peaking over 0 dBFS.
- **Loop points trimmed and moved inside the buffer.** Each looping clip is
  crossfaded onto itself, rotated so the wrap sits at a flat zero crossing, and
  padded with 0.15 s of its own tail and head; `assets/audio/loops.json` names
  the period and `src/audio/bus.js` sets `loopStart`/`loopEnd` from it.
- `assets/audio/mix.json` was recomputed so each clip's **output** level is what
  Jurek set by ear, to within about a dB — the balance moved from the files into
  the mixer, it was not rewritten.

`cutscene.mp3` got the ceiling and nothing else: its length (30.000 s) and rate
are load-bearing for `cutscene.beats.json`.

## Art

The 32 models in `assets/models/` are generated by `tools/blender-models.py` and
contain no third-party geometry, so nothing there needs attribution.

No third-party art ships in the repo.

`assets/kenney-input-prompts/` (Kenney — Input Prompts, CC0 1.0) has been
removed. It existed for the on-screen key-prompt bar, which cut its glyphs out
of the sheet using the atlas XML; that bar (`src/ui/keybar.js`) was deleted when
the key list moved into the menu's Controls panel, and the 60 KB of sheet, XML
and licence went on shipping with nothing in the codebase referencing them.
Nothing else used it: a grep over `src/`, `index.html` and `tools/` returned
this credits entry and nothing more. If a glyph sheet is ever wanted again,
Kenney's assets are at <https://kenney.nl/assets> (CC0 1.0) and the licence file
travels with the download.

## Needs resolving before public deploy

- `duck_squeak` — the squeak Jurek chose by ear
  (`Rubber Duck Sound Effect - GamingSoundEffects`). It came from a YouTube
  sound-effects channel with **no stated licence**, so the game currently ships
  one clip whose rights are unclear. It is also the single most-played sound in
  the game, which makes it the worst one to be unsure about. Options: find the
  original uploader's terms, replace it with a CC0 squeak that sounds close, or
  record a real rubber duck — that last one takes about a minute and settles it
  permanently.

## Other assets

- **3D models** — all 32 generated procedurally in Blender by `tools/blender-models.py`.
  No third-party geometry ships in this game.
- **Key prompt icons** — Kenney Input Prompts (CC0).
- **Interface font** — VT323 by Peter Hull, SIL Open Font License 1.1. Shipped in
  `assets/fonts/` as two woff2 subsets (latin 7.2 KB, latin-ext 7.2 KB) and
  declared by the `@font-face` pair in `src/ui/theme.js`. Self-hosted rather than
  linked from Google Fonts so the game boots and renders with the network
  unplugged.
- **Physics** — Rapier (Apache-2.0). **Rendering** — three.js (MIT).
