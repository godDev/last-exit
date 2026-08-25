# LAST EXIT — technical prototype

**Play it: https://goddev.github.io/last-exit/**

Headphones help. Every sound in it is synthesised in the browser.


Night. October 1991. A fictional state where Nevada, Arizona and California meet.
You drive Western Trails route 17: Las Palmas → Red Creek → Ashford → Silver Lake → Carson,
about 400 miles of desert, out at 22:30, due in around 06:00.

The fiction retains that 400-mile route; the playable prototype compresses the authored
encounters into its first 16 physical miles. The first stop appears in roughly two minutes
of normal driving, with the later acts spaced two to three minutes apart.

This repository is **not the game**. It is the prototype that proves the four load-bearing
mechanics work in a browser and feel the way they need to feel:

1. an endless procedural night highway that is actually pleasant to drive,
2. a cabin with working instruments and a clock counting 22:30 → 06:00,
3. **the rear-view mirror**, which can show something the cabin does not contain,
4. **the radio**, a real dial across a real band with programmes already in progress.

The story layer is now in progress: the event scheduler, passenger manifest, bilingual
script system, persistent shift state, authored stops and on-foot interactions are in place.
The acts — Mile 86, the gas station, highway patrol, motel and the final twelve passengers —
can now be added as content rather than engine work.

The game design and shared implementation board live in [docs/DESIGN.md](docs/DESIGN.md) and
[docs/ROADMAP.md](docs/ROADMAP.md).

## Running it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

## Controls

| | |
|---|---|
| `W` / `S` | throttle / brake; hold `S` after stopping to reverse |
| `A` / `D` | steer |
| `Mouse` | look around in the cabin and on foot; click to capture, `ESC` to release |
| `Left Shift` | sprint while exploring on foot |
| `SPACE` | glance at the cabin mirror (hold) |
| `Q` | look at the left side mirror |
| `X` | look right around the cab |
| `J` | open / close the driver's journal |
| `1` / `2` / `3` | choose one of the first three story responses |
| `↑` / `↓`, `ENTER` | navigate and confirm any story response, including the final choice |
| `R` | radio on/off |
| `[` `]` | tune down / up the band |
| `T` | seek to the next station |
| `H` | high beams |
| `F` | air brakes in the cab; toggle flashlight while on foot |
| `L` | switch language (EN / RU) |
| `P` | autopilot — hands off the wheel, so you can just look |
| `ESC` | pause; resume, return to the main menu with autosave, or restart |

The development server additionally enables diagnostics, story jumps, mirror-state demos
and cabin inspection controls. They are deliberately unavailable in the published build.

The main menu offers a new shift, continuation from the autosave and authored checkpoints
for every route act. Checkpoints establish the required prior story state before opening
their scene.

`C` is not a tourist feature. Everything in the cab is placed by its angle from the
driver's eye at `(DRIVER_X, 2.05, -4.90)`, and placing it by eye from the driver's seat
alone is exactly how the gauges and the wheel ended up buried inside the dash the first
time. If you move anything in `src/bus/dashboard.ts`, look at it from the side afterwards.

## The band

| kHz | | |
|---|---|---|
| 512 | — · — | not on any list |
| 640 | COUNTY BAND | scanner traffic |
| 860 | KBSN | a ball game three time zones away |
| 1180 | KRDX | country, generated bar by bar, never repeats |
| 1330 | KGSP | all-night gospel |
| 1490 | KZQ-A | news and weather |

Everything between them is the band itself. On AM after dark the distant stations fade in
and out over tens of seconds, which is the excuse the finished game needs for a broadcast
to arrive that nobody transmitted.

## How it is built

Vite + TypeScript + three.js. The route itself uses no third-party runtime assets: every mesh
is built in code, every texture is drawn on a `<canvas>` at run time, and every sound is synthesised through
WebAudio. Nothing is downloaded, nothing is licensed, and the signage can be made to say
whatever the script needs it to say.

A few decisions worth knowing about before changing anything:

- **`src/render/retroMaterial.ts` replaces the lighting rig.** A night highway needs two
  headlight cones reaching a hundred metres across several hundred objects, which is
  exactly where per-object `SpotLight` plus shadow maps falls over in a browser. The cones
  are evaluated per fragment from view-space uniforms instead, so the cost does not depend
  on how much world is on screen. Fog, the PS1 vertex snapping and the cabin glow live in
  the same shader.

- **`src/bus/mirror.ts` is the whole point.** Three layers: `0` the world, `1` visible to
  the driver only, `2` visible in the glass only. "The passenger is gone, but he is still
  in the mirror" is one call to `setVisibility(object, 'mirror')` — not a bespoke effect,
  and reusable by every beat in the pitch that turns on the mirror.

- **`src/world/curvature.ts` makes the route a pure function of one seed.** What exists at
  station N is derived from N, so 400 miles costs nothing to store and driving back finds
  the same fence. `src/world/origin.ts` pulls the world back to the origin every few
  kilometres, because float32 loses enough precision past a few tens of kilometres that
  the geometry visibly crawls.

- **`src/audio/voice.ts` does not use `speechSynthesis`.** Browser TTS cannot be routed
  into a WebAudio graph, so it would arrive unfiltered, sitting outside the radio entirely.
  Instead each syllable is a buzz through two formant filters with a consonant burst in
  front of it. It carries cadence and mood while staying deliberately unintelligible; the
  subtitle does the actual talking.

- **The world is populated only as far as the fog allows** (~320 m), not as far as the road
  mesh reaches, and props are parked and reused rather than created and discarded. The
  `objects` figure in the diagnostics panel should sit flat all night.

## Layout

```
src/
  core/     loop, clock, input, seeded noise, event scheduler, settings
  render/   the shared shader, the VHS pass, the renderer, canvas textures
  world/    route generation, road ribbon, roadside props, traffic, sky, floating origin
  bus/      driving model, cabin, dashboard, mirror, passengers
  audio/    context and buses, engine, voice, radio, stations
  ui/       subtitles, diagnostics, styles
  content/  bilingual script, radio programmes
```

## What is deliberately not here

Free-form passenger conversations, combat, chases, random deaths and external art or audio
assets. The current shift is a compact authored investigation: its consequences live in the
mirror, radio, journal and final passenger choice.
