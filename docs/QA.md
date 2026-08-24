# Route 17 QA checklist

Run `npm run build` before the manual checks below. Use the development server only for
story jumps; production builds must not expose those keys.

## Critical path

1. Start a clean shift and reach each authored stop normally. Confirm the landmark is beside
   the coach, can be inspected, and the required clue permits returning to the bus.
2. At each stop, reload after the forced park, while outside, after collecting a clue and
   while a choice is open. The reload must park the bus at the same stop or restore the same
   choice; driving past an unresolved act must be impossible.
3. Drive beyond the first floating-origin rebase before approaching the next unplaced stop.
   Confirm its marker, objects and interaction radius still line up with the bus.

## Narrative branches

1. Complete the Mile 86 choices: board, pass and radio. Verify that each adds a different
   journal observation and that Miller's Gas resolves Nora's physical presence coherently.
2. Complete the roadside choices: board, leave and radio. Confirm their mirror/radio result
   is retained through save/load and none blocks the core evidence path.
3. At the motel, inspect the photograph and manifest, then check that the journal shows the
   roster without revealing any passenger's hidden boarding year.

## Endings and production controls

1. Select Nora, any other passenger and refusal. Verify the correct terminal screen, no
   Escape unpause, a reload restores the same screen, and restart clears the shift.
2. Build and serve the production bundle. Verify F3, F5–F10, G and C do not activate game
   diagnostics, teleportation or visual demos.
