# LAST EXIT — graphics baseline

This document is the performance contract for the visual upgrade. Measure in a normal
driving scene with traffic, passengers and the mirror visible; the main menu is not a
representative benchmark.

## Presets

| Preset | Internal height | MSAA | Target hardware | Frame target |
|---|---:|---:|---|---:|
| Low | 540p | off | integrated / older laptop GPU | 30 fps |
| Medium | 810p | 2x | mainstream integrated or entry GPU | 45 fps |
| High | 1080p | 4x | discrete desktop GPU | 60 fps |

The internal width follows the window aspect ratio and is capped at 1920 pixels. The
fullscreen post pass always runs at the display size.

## Scene budgets

These are guardrails rather than targets to fill:

- normal driving: at most 220 draw calls and 450,000 visible triangles;
- authored stops: at most 320 draw calls and 750,000 visible triangles;
- WebGL textures: at most 160 resident textures during a shift;
- dynamic shadow-casting lights in later stages: at most two visible at once;
- unique 2K textures: reserved for the bus, hero props and authored locations;
- repeated roadside assets must use pooling/instancing and LOD where applicable;
- no sustained frame may exceed 33.3 ms on Low or 22.2 ms on Medium.

## Lighting architecture

The renderer is hybrid. Procedural world geometry keeps the shared fragment-lighting
shader for stable long-range cost. Upgraded hero assets use physical lights and standard
PBR materials. Low disables shadow maps, Medium enables a 1024px moon shadow, and High
uses a 2048px moon shadow plus one shadow-casting headlamp. The second headlamp remains
unshadowed to avoid rendering the scene depth twice for nearly identical cones.
Shadow maps update once per simulation frame and are reused by both mirrors and the main
camera. Transparent glass never casts an opaque shadow.

## Material vocabulary

New or upgraded assets must use `createPBRMaterial` and classify themselves as paint,
metal, rubber, plastic, fabric, glass or asphalt. Procedural assets that must remain on the
shared retro shader should still provide roughness and metalness. Do not encode perceived
brightness into base colour to compensate for a missing light; fix the lighting exposure
or material response instead.

## Stage 4–7 baseline

- Road detail remains procedural in route UV space and stable through floating-origin
  rebases. The proven single road shader is kept as the visibility baseline.
- The coach exterior uses PBR paint, metal, glass and rubber for its hero surfaces. Service
  hardware is separate geometry so it can receive highlights and shadows at story stops.
- Driver controls and ancillary equipment may use individual meshes; passenger-saloon
  repetition should remain merged or instanced to preserve the draw-call budget.

## Measuring

Development builds expose the diagnostics panel with `F3`. It reports FPS, average frame
time, draw calls, triangles, object count, geometry/texture memory counters, active preset
and internal resolution. Capture measurements at the depot, in normal traffic, at Miller's
Gas, at Sunset Motor Inn and with the rear-view mirror anomaly active.

Before each graphics stage is accepted:

1. compare all three presets at the same checkpoint;
2. confirm that changing preset does not require restarting the shift;
3. check that object and texture counts remain flat after ten minutes of driving;
4. record any deliberate budget exception in this file.
