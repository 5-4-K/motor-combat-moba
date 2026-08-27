# Roadmap

Plans and tracker: [`docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md`](superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md).

**v1 is complete.** P0–P5 are all Done with Validation run: monorepo and room (P0), config tables and
schema (P1), lobby (P2), match flow (P3), driving and netcode (P4), combat and last standing (P5).

The tracker's Notes column carries what each plan was validated by, the deviations from its plan
text, and the open questions left for a human — read it before starting anything new.

## Deferred

**Device-pixel-ratio rendering (post-v1, unplanned).** The client renders a 1408x720 canvas (a
1280x720 arena viewport plus the 128px HUD gutter) and lets the Scale Manager `FIT` it to the
window, so on a Windows-scaled display (125–150 %, most 14" laptops) the browser upscales the
finished frame and the whole picture is uniformly soft. Phaser 3 has no `resolution` switch (removed
in 3.16), so native pixels would have to be built by hand — and it touches every scene, which is why
it was split out of the 2026-08-25 scaling change:

- game size becomes `VIEW_WIDTH·dpr × VIEW_HEIGHT·dpr` (read `devicePixelRatio` once at boot, cap at
  2 so a 4K@200 % desktop does not quadruple the fill), with `FIT` still displaying it at the same
  CSS size;
- every scene's camera zooms by `dpr` and scrolls so the logical region fills the canvas
  (`ArenaScene` multiplies its `CAMERA_CONFIG.zoom` by it, and both its cameras need the same
  treatment);
- `scrollFactor(0)` HUD objects (`ArenaScene` countdown and spectator banner) ignore that scroll and
  need dpr-aware positioning;
- every `Text` needs `setResolution(dpr)` or it rasterises at its font size and is upscaled — the
  very softness the change exists to remove;
- the `JoinScene` DOM name input's behaviour under camera zoom must be verified in a browser.

Fairness is unaffected either way: the logical world window is the same on every screen. Zoom and
car-texture size are coupled (see `CAMERA_CONFIG.zoom` and the importer's `SUPERSAMPLE`); a dpr of
2 draws the 96 px textures at 2:1 magnification, which is soft-but-stable, so a re-import at 4x
should be part of this plan.
