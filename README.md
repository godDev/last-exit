# LAST EXIT — technical prototype

**Play it: https://goddev.github.io/last-exit/**

Headphones help. Every sound in it is synthesised in the browser.


Night. October 1991. A fictional state where Nevada, Arizona and California meet.
You drive Western Trails route 17: Las Palmas → Red Creek → Ashford → Silver Lake → Carson,
about 400 miles of desert, out at 22:30, due in around 06:00.

This repository is **not the game**. It is the prototype that proves the four load-bearing
mechanics work in a browser and feel the way they need to feel:

1. an endless procedural night highway that is actually pleasant to drive,
2. a cabin with working instruments and a clock counting 22:30 → 06:00,
3. **the rear-view mirror**, which can show something the cabin does not contain,
4. **the radio**, a real dial across a real band with programmes already in progress.

There is no story yet. The event scheduler, the passenger manifest and the bilingual script
system are all in place so that the acts — Mile 86, the gas station, the highway patrol,
the motel, the twelve passengers thirty miles out — can be written as content rather than
as engine work.

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
| `SPACE` | glance at the mirror (hold) |
| `Q` / `E` | look around the cab |
| `R` | radio on/off |
| `[` `]` | tune down / up the band |
| `T` | seek to the next station |
| `H` | high beams |
| `F` | air brakes |
| `L` | switch language (EN / RU) |
| `P` | autopilot — hands off the wheel, so you can just look |
| `G` | mirror demo: cycles the three passenger states |
| `C` | inspect the cab from three fixed vantage points |
| `ESC` | pause |
| `F3` | diagnostics |

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

Vite + TypeScript + three.js. **No external assets at all**: every mesh is built in code,
every texture is drawn on a `<canvas>` at run time, and every sound is synthesised through
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

The story and its acts, leaving the bus on foot, conversations with passengers, the police
stop, the motel, the deduction system for finding which passenger the bus cannot leave the
route without, and saves. The engine is shaped for all of it: triggers in
`src/core/events.ts`, people in `src/bus/passengers.ts`, lines in `src/content/`.
