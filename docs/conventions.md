# Conventions

Follow the hard invariants in root `CLAUDE.md`.

- TypeScript **ESM** (`"type": "module"`). Relative imports use the **`.js` extension** (`./foo.js` from `foo.ts`).
- `@motor-combat-moba/shared` is consumed as **built `dist`**. Rebuild shared after changing it.
- Server and client call the same `stepSim`. Do not fork sim math.
- Enum uint8 values stay stable. New fields go on the schema if `stepSim` will read them (P1+).
- Package names: `@motor-combat-moba/shared` | `server` | `client`. Room: `arena` / `ArenaRoom`.
- `docs/ideas/` and `docs/invariants/` are the user's personal notes, **not** project reference. Do
  not read or plan against them unless the user names them in the request — see root `CLAUDE.md`.
