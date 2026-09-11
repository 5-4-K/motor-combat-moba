# Arena art

One directory per arena, named by its arena id: `arena-02/floor.png` is declared in
`../manifest.json` as `"arena.arena-02.floor"`.

`common/` holds art shared between arenas and is never pruned. Everything else here is pruned from
the release except the directory matching `ACTIVE_ARENA_ID`, so an experimental arena costs the
shipped zip nothing.

`arena-01/floor.png` is the first PNG to use this convention, declared as `"arena.arena-01.floor"`.
An arena with no directory here still renders — the generated asphalt tile is the permanent
fallback, not a placeholder waiting for art.
