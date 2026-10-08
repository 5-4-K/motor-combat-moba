# Arena art

One directory per arena, named by its arena id: `arena-02/floor.png` is declared in
`../manifest.json` as `"arena.arena-02.floor"`.

`common/` holds art shared between arenas and is never pruned. Everything else here is pruned from
the release except the directory matching `ACTIVE_ARENA_ID`, so an experimental arena costs the
shipped zip nothing.

`arena-02/floor.png` is the one PNG using this convention, declared as `"arena.arena-02.floor"`
— a hand-made top-down pit whose walls and spike
banding are drawn to match where `SPIKE_CONFIG`'s `kind: "spike"` obstacles actually sit, so the
client suppresses the procedural lane markings, border stroke and drawn spikes for that arena and
lets the art carry all three. An arena with no directory here still renders — the generated asphalt
tile is the permanent fallback, not a placeholder waiting for art.

`arena-01` carries no floor art since 2026-10-09: it is a tile arena (spec tile arenas, TA9), whose
walls and spikes come from its grid.
