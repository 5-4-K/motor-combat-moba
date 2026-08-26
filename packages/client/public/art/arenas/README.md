# Arena art

One directory per arena, named by its arena id: `arena-02/floor.png` is declared in
`../manifest.json` as `"arena.arena-02.floor"`.

`common/` holds art shared between arenas and is never pruned. Everything else here is pruned from
the release except the directory matching `ACTIVE_ARENA_ID`, so an experimental arena costs the
shipped zip nothing.

Nothing lives here yet — arenas are drawn procedurally. The convention is in place so the first PNG
does not require moving files.
