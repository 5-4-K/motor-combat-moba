# Browser Client Invariants

**Project:** 6-player top-down car combat shooter. Phaser client, laptop browsers, keyboard-only
control.

**Purpose:** Non-negotiable technical constraints for the client — Phaser usage, rendering,
viewport, memory, keyboard input, audio, storage, page lifecycle, and browser compatibility.

**How to use:** Run the [Review Procedure](#review-procedure) before writing code. **HARD**
violations block implementation. **GUARDED** items are implemented but flagged.

Companion: `NETCODE_INVARIANTS.md`.

---

## Support Matrix

| Browser | Minimum | Notes |
|---|---|---|
| Chrome | last 3 stable | Primary target |
| Edge | last 3 stable | Chromium, same engine |
| Firefox | last 3 stable | Independent engine — test separately |
| Safari | 17+ | Mac laptops. The one that breaks. Test every release. |
| Brave / Opera / Vivaldi | current | Chromium; Brave shields are the usual culprit |

**Out of scope:** IE, legacy Edge, mobile and tablet browsers, in-app webviews (Discord,
Instagram, Facebook embedded browsers).

**I-C0.1** Out-of-scope environments are **detected and refused with a clear message**, never
allowed to load and fail halfway. A phone gets "keyboard and a laptop required," not a black
canvas. This game is unplayable without a physical keyboard — the refusal is a genuine
requirement, not a nicety.

---

## Viewport Targets

The number that matters is the **CSS viewport**, not screen resolution. Browser chrome eats
80–130 px of height, and OS scaling shrinks it further.

| Screen | Usable viewport | Notes |
|---|---|---|
| 1366×768 | ~1366×640 | **The floor.** Common on budget laptops. |
| 1920×1080 @125% | ~1536×745 | Very common Windows default |
| 1920×1080 @100% | ~1920×945 | |
| 1440×900 MacBook Air | ~1440×780 | `devicePixelRatio: 2` |
| 1512×982 MacBook Pro 14" | ~1512×860 | `devicePixelRatio: 2` |
| 1280×800 | ~1280×680 | |

| Constant | Value |
|---|---|
| Design resolution | **1280×720** (fixed internal) |
| Scale mode | **`Phaser.Scale.FIT`** with letterboxing |
| Floor viewport | **1280×640** CSS px |
| Minimum effective scale | **0.85** — HUD must be legible here |
| `devicePixelRatio` cap | **2** |
| Peak heap budget | `__ MB` — set after first profiling pass |
| Initial download budget | `__ MB` — set and enforce in CI |
| Cold start to menu | `__ s` |

---

## 1. Phaser Boundary — HARD

**I-C1.1** **Phaser renders; it does not simulate.** The shared simulation module owns car
physics, collision, projectile motion, beam evaluation, and damage. Phaser draws the result.

**I-C1.2** **Phaser Arcade Physics is not used for gameplay.** It is delta-time driven and cannot
run on the server. It may be used only for purely cosmetic effects that never influence
simulation state.

**I-C1.3** The simulation module imports **nothing** from Phaser, the DOM, or the browser. It must
run in plain Node. If deleting Phaser breaks gameplay code, the boundary is broken.

**I-C1.4** `Scene.update(time, delta)` does not advance the simulation. It drives an accumulator
that steps the simulation at fixed 60 Hz, then renders the interpolated result. `delta` never
reaches gameplay code.

**I-C1.5** Data flows simulation → Phaser. Sprites are views of simulation entities. Nothing reads
a sprite's `x`/`y` as truth, and nothing writes simulation state from a Phaser callback.

**I-C1.6** No gameplay logic in Phaser input callbacks, tweens, timers, or animation events.

**Violation smells:** `this.physics.add.collider` on cars or projectiles; `sprite.x` read by
gameplay code; `delta` in a movement calculation; a Phaser import inside `/shared`.

---

## 2. Rendering Context — HARD

**I-C2.1** **WebGL context loss must be handled.** The GPU process restarts on driver updates,
long backgrounding, VRAM pressure from other tabs, and laptop GPU switching. Phaser does not fully
recover on its own. Register `webglcontextlost` (with `preventDefault()`) and
`webglcontextrestored`, restore textures and state, and resume. Unhandled, this is a permanent
black screen mid-match.

**I-C2.2** WebGL2 is the baseline. **WebGPU is not** — it may only be used behind a feature check
with a working WebGL fallback.

**I-C2.3** No GPU resource creation during a match. Textures, atlases, and shaders are loaded and
warmed at load. If a shader compiles on first use, that is a visible hitch at the worst moment.

**I-C2.4** Every GPU resource has an explicit destroy path. Phaser texture and Graphics objects
that are created dynamically must be destroyed; leaked textures exhaust VRAM and take the tab down.

**I-C2.5** `Graphics` objects are not rebuilt per frame for beams or trails. Beams are drawn with
a reusable, transformed sprite or a persistent Graphics object cleared and redrawn — never
`new Phaser.GameObjects.Graphics()` inside the render loop.

**I-C2.6** Canvas context options are set explicitly in the Phaser config — renderer type,
`antialias`, `powerPreference: 'high-performance'`, `transparent: false`. Never rely on defaults.

---

## 3. Viewport & Competitive Fairness — HARD

**I-C3.1** **The visible play area is identical for every player.** The design resolution is fixed
at 1280×720 and scaled with `FIT`; a larger window or wider monitor scales the same arena, never
reveals more of it. Letterbox the remainder.

**I-C3.2** The game must be fully playable and legible at the **1280×640 floor** (effective scale
~0.89). HUD, health bars, and any text are validated there, not at 1080p.

**I-C3.3** Nothing may depend on `screen.width`/`screen.height`. The authority is the container's
CSS size, which is smaller and changes on resize.

**I-C3.4** `devicePixelRatio` is handled explicitly and **capped at 2**. On a MacBook, uncapped
DPR is a silent 4× fill-rate cost for identical visible content — the usual cause of "runs at
45 fps on a machine that should be fine."

**I-C3.5** Browser zoom changes DPR at runtime. Resize handling must react without breaking layout.

**I-C3.6** Resize is debounced and does not reallocate GPU resources per event. Dragging a window
edge fires continuously.

**I-C3.7** Since aim is keyboard-driven, there is no cursor-to-world mapping to get wrong — but
any future mouse interaction (menus, minimap clicks) must account for DPR, zoom, and letterbox
offset.

---

## 4. Memory & Garbage Collection — HARD

**I-C4.1** Zero steady-state allocation per frame and per tick. You cannot control the GC in
JavaScript; the only lever is not allocating. A GC pause is a dropped frame and a missed input
send.

**I-C4.2** Watch the hidden allocators: `map`/`filter`/`slice`, object and array literals,
closures created per frame, string concatenation for HUD text, destructuring in hot loops.

**I-C4.3** Vectors and math results are written into reused scratch objects. Never
`return { x, y }` from a per-frame or per-tick function.

**I-C4.4** **Projectiles, beams, explosions, damage numbers, and particle emitters are pooled**
with a fixed cap — Phaser `Group` with `maxSize` and `createMultiple` at load, never
`Instantiate`-on-demand with unbounded growth.

**I-C4.5** Simulation state, snapshot buffers, input history, and rewind history use preallocated
typed arrays with fixed capacity. They never grow at runtime.

**I-C4.6** Every `addEventListener`, timer, `requestAnimationFrame` loop, Worker, `AudioContext`
node, WebRTC channel, and Phaser event subscription has a matched teardown. Scene shutdown
tears down everything the scene created.

**I-C4.7** Memory is stable across many matches in one tab. Players will not reload between games,
and a leak that survives scene transitions compounds every match.

---

## 5. Page Lifecycle & Tab Behaviour — HARD

**I-C5.1** `requestAnimationFrame` **stops entirely when the tab is hidden**, and background
timers throttle to ~1 Hz. The client loop must not assume it keeps running.

**I-C5.2** The fixed-timestep accumulator has a **hard catch-up cap**. Without it, a player who
alt-tabs for two minutes returns and tries to simulate 7,200 ticks in one frame — hanging the tab.
On return, resync from the server snapshot rather than catching up.

**I-C5.3** Networking survives backgrounding. Heartbeats and timeouts are driven by an interval or
worker, **never** by `requestAnimationFrame`. A player who alt-tabs is not disconnected within the
grace period.

**I-C5.4** **On focus loss, all held keys are released.** A key held when the tab loses focus
never fires `keyup`. In a driving game this means the car drives into a wall while the player is
in another tab — handle `blur` and `visibilitychange` and clear the input state.

**I-C5.5** `pagehide` cleanly closes the connection so the server frees the match slot. Do not use
`unload`.

**I-C5.6** Client timing uses `performance.now()`, never `Date.now()`.

---

## 6. Keyboard Input — HARD

This game is keyboard-only for gameplay. Input is the highest-risk client area.

**I-C6.1** All gameplay input goes through one abstraction. Gameplay reads actions
(`Accelerate`, `TurnLeft`, `Fire`), never `KeyboardEvent` directly.

**I-C6.2** Bindings use `event.code` (physical key), **not** `event.key`. Arrow keys are
layout-stable, but any letter-key alternative (WASD) is not — an AZERTY player must get the same
physical keys.

**I-C6.3** **`preventDefault()` is mandatory on arrow keys and space.** Arrow keys scroll the
page; space scrolls the page. Without this the whole page jumps while the player drives. Scope it
to the game canvas/container having focus.

**I-C6.4** Browser-reserved combinations are **never** captured — Ctrl+W, Ctrl+T, Ctrl+N, F5,
F11, Ctrl+Shift+I. Do not bind gameplay to a key you cannot own.

**I-C6.5** **Keyboard ghosting is a first-class concern.** Cheap laptop membrane keyboards
frequently cannot register three simultaneous keys — Up+Left+Space is a very common failure.
This game requires exactly that combination constantly.
- Test the full simultaneous-input set on a real budget laptop keyboard, not a mechanical one.
- Provide at least one **alternative binding set** (e.g. WASD + a different fire key) whose
  simultaneous combinations are known to work on keyboards where the default fails.
- If a player cannot fire while turning, that is a blocking bug, not a hardware complaint.

**I-C6.6** Key repeat is ignored. Held-key state is tracked as a boolean set updated on
`keydown`/`keyup`; the OS auto-repeat stream must not generate repeated fire actions.

**I-C6.7** The input state is sampled **once per fixed tick**, immediately before the simulation
step, and drained as a coherent snapshot. Never read live key state from inside simulation code.

**I-C6.8** No artificial smoothing, buffering, or acceleration in the input layer. The path from
`keydown` to simulation is as short as the loop allows.

**I-C6.9** Pointer lock is **not** used. If a future mode adds mouse aim, that is a project-level
change requiring its own lifecycle handling (Esc exits pointer lock silently and browsers
rate-limit re-requests).

**Violation smells:** `event.key === 'ArrowUp'`; no `preventDefault` on arrows; input read inside
the simulation step; a single hardcoded binding set.

---

## 7. Audio — HARD

**I-C7.1** `AudioContext` **cannot start without a user gesture** in every browser in the matrix.
It is created or resumed on an explicit entry action — a "Click to play" gate — and the game
handles the suspended state until then.

**I-C7.2** Web Audio is used for gameplay sound. `<audio>` elements are for background music at
most; their latency and concurrency limits make them unusable for weapon fire and impacts.

**I-C7.3** Short frequent sounds (fire, impact, ram) are decoded to `AudioBuffer` at load.
Never `decodeAudioData` during gameplay.

**I-C7.4** **Voice count is capped with an explicit priority policy.** Six cars with beams,
projectiles, engine loops, and collisions will exceed a sane voice budget. Gameplay-informative
audio — nearby fire, incoming projectile, ram impact — outranks cosmetic audio.

**I-C7.5** Engine loops are per-car persistent sources with modulated pitch/gain, not retriggered
one-shots.

**I-C7.6** Audio events fire only on fresh simulation ticks, never on replayed ones
(`NETCODE_INVARIANTS.md` §3.8). A reconciliation that re-fires six explosion sounds is
immediately audible.

**I-C7.7** The context is resumed after tab backgrounding and after audio device changes, both of
which can leave it suspended or silent.

---

## 8. Assets & Loading — GUARDED

**I-C8.1** **Build size is download time.** Every asset is on the critical path to first play.
Budget the initial payload and enforce it in CI.

**I-C8.2** Load is split: menu-critical assets first, match assets after or in parallel. Never one
monolithic blocking download.

**I-C8.3** All assets are loaded and decoded **before** the match starts. No fetch, image decode,
or audio decode during gameplay.

**I-C8.4** Sprites are packed into atlases. Each texture switch is a draw call; each separate file
is an HTTP request.

**I-C8.5** Content — car stats, weapon stats, arena layouts — is data-driven and validated on
load. Malformed content fails loudly at load with a clear message, never silently mid-match.
Note that tuning data is part of the protocol version (`NETCODE_INVARIANTS.md` §10.2).

**I-C8.6** Assets are content-hashed with long cache lifetimes; the HTML entry point is not
cached long.

**I-C8.7** Loading handles slow, flaky, and interrupted connections: visible progress, retry, and
a clear error — not an indefinite spinner.

**I-C8.8** If a service worker is used, it must have a working update path. A stale service worker
serving an old client against a new server is a version-mismatch outage users cannot fix by
refreshing.

---

## 9. Storage — HARD

**I-C9.1** No browser storage is authoritative for anything competitive. Progression, unlocks,
stats, and ranking are server-side. `localStorage` is editable from the console in one line.

**I-C9.2** All storage access is wrapped in try/catch. `localStorage` **throws** in Safari private
browsing and on quota exhaustion. An unhandled throw here kills the boot sequence.

**I-C9.3** Storage may be absent, disabled, cleared mid-session, or full. Every read has a default;
every write may fail without breaking the game.

**I-C9.4** Everything persisted carries a schema version, with explicit migration or a clean reset
on mismatch. Key bindings in particular will change shape as the game evolves.

**I-C9.5** Corrupt or hand-edited data is detected and recovered from, never crashes the client.

**I-C9.6** No credentials or tokens in `localStorage` where a safer mechanism exists. Prefer
httpOnly cookies for session material.

**I-C9.7** `localStorage` is synchronous and blocks the main thread. Never write per frame or per
tick; batch on meaningful events.

---

## 10. Cross-Browser Discipline — HARD

**I-C10.1** Feature detection, never user-agent sniffing — except the out-of-scope refusal in §0.

**I-C10.2** **Safari is tested every release.** It is the only non-Chromium, non-Gecko engine in
the matrix and will differ on: audio unlocking, WebGL extensions and precision, `localStorage` in
private mode, WebRTC behaviour, and memory limits. "Works in Chrome" is not evidence.

**I-C10.3** **Firefox is tested every release.** Independent engine, different GC behaviour,
different WebRTC stack.

**I-C10.4** Keyboard behaviour is verified per browser. Modifier handling, `preventDefault` scope,
and `code` values for arrows and space are not identical everywhere.

**I-C10.5** No API used outside the common baseline without a feature check and a fallback.

**I-C10.6** The client behaves sanely with an ad blocker or privacy extension active. Brave
shields in particular affect WebRTC. Analytics being blocked must never block gameplay.

**I-C10.7** The page is served over **HTTPS**. WebRTC and secure-context APIs require it.

---

## 11. Debug Hygiene & Client Trust — HARD

**I-C11.1** **Everything shipped to the browser is readable and editable by the player.**
Minification is not security.

**I-C11.2** Debug features — free camera, spawn commands, invulnerability, state overlays,
teleport — are **compiled out** of production builds by dead-code elimination, not hidden behind a
runtime flag someone can flip in the console.

**I-C11.3** No global handles on `window` in production. A `window.game` reference is a cheat API.

**I-C11.4** No development endpoints, test credentials, or internal URLs in the shipped bundle.

**I-C11.5** Production source maps are not shipped publicly, or are access-restricted.

**I-C11.6** Anything the client sends is validated server-side. Assume every value has been edited.
The strongest protection here is structural: the client sends only input bits, and input bits are
cheap to validate exhaustively.

---

## 12. Errors & Diagnostics — GUARDED

**I-C12.1** Global `error` and `unhandledrejection` handlers report with build version and browser
info.

**I-C12.2** An exception in the render or simulation loop must not permanently break the loop.
Catch at the loop boundary, report, degrade.

**I-C12.3** No `console.log` in hot paths. Console output in a loop is a measurable cost,
especially with DevTools open.

**I-C12.4** Never `catch {}` with an empty body. Loud in development, graceful in production.

**I-C12.5** No credentials or personal data in logs or error reports.

---

## 13. Text & Accessibility — GUARDED

**I-C13.1** No hardcoded user-facing strings in gameplay or UI code — localization table with
stable keys.

**I-C13.2** Strings are parameterized templates, never concatenated.

**I-C13.3** UTF-8 end to end, including player names and chat. Font atlases cover the character
sets you accept; define the policy for names outside the atlas.

**I-C13.4** UI tolerates ~2× text expansion without clipping **at the 1280×640 floor**.

**I-C13.5** **Team identity is never conveyed by color alone.** TDM needs a shape, outline, icon,
or marker channel distinguishing teammates from enemies — cars are small at this camera distance
and red/green is the most common colorblindness axis.

**I-C13.6** Screen shake and flash intensity are user-adjustable, and there is no unavoidable
rapid flashing. A car combat game with beams and explosions is a realistic photosensitivity risk.

---

## 14. Code Health — GUARDED

**I-C14.1** The shared simulation module is Phaser-free, DOM-free, and unit-testable in Node.

**I-C14.2** Tuning values live in data, not literals scattered through logic. A balance change must
not require touching simulation code.

**I-C14.3** Update order is explicit, not reliant on module import order or Phaser event
registration order.

**I-C14.4** Anything that must stay in sync across two places — client/server, code/data,
enum/table, binding set/action list — needs a single source of truth or an automated check.

---

## Review Procedure

Before implementing any change:

1. **Phaser boundary** — Does this put simulation in Phaser, Phaser in simulation, or use Arcade
   Physics for gameplay? (§1)
2. **GPU context** — Resources created at the wrong time, missing destroy, Graphics rebuilt per
   frame, or context loss unhandled? (§2)
3. **Viewport** — Does this break at 1280×640, grant more view on a bigger window, or mishandle
   DPR/zoom? (§3)
4. **Allocation** — Per-frame or per-tick allocation? Unpooled entities? Unmatched listener,
   timer, or subscription? (§4)
5. **Lifecycle** — Behaviour when the tab is hidden, refocused, or closed? Are held keys
   released on blur? Is catch-up capped? (§5)
6. **Input** — Bypasses the abstraction, uses `event.key`, misses `preventDefault` on arrows,
   captures a reserved combo, or adds a three-key requirement that will ghost? (§6)
7. **Audio** — Assumes a running context, decodes during gameplay, adds voices without a
   priority policy, or fires on replayed ticks? (§7)
8. **Assets** — Adds download weight or a load during gameplay? Is new content data-driven and
   validated? (§8)
9. **Storage** — Wrapped, versioned, non-authoritative, off the hot path? (§9)
10. **Cross-browser** — Feature-checked? Reasoned about for Safari and Firefox specifically? (§10)
11. **Client trust** — Exploitable by someone reading the bundle or typing in the console? (§11)
12. **Diagnostics** — Behaviour on exception, and is it diagnosable? (§12)
13. **Text & a11y** — New string? New color-coded information? Fits at the floor viewport? (§13)
14. **Sync risk** — Does this create a second place that must be kept manually in step? (§14)

### Standing rules

- Phaser renders; it does not simulate.
- The player owns the client. Every byte of it.
- A stutter is a bug. GC pauses and shader compiles are stutters.
- If you only tested in Chrome, you have not tested.
- Test at 1280×640 before shipping anything with UI.
- Test three-key combinations on a cheap laptop keyboard before shipping anything with a binding.
- Editing this document is a project decision, not part of a feature change.
