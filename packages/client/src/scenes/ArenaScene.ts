import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type {
  ArenaDef,
  ArenaState,
  InputMessage,
  PlayerState,
  SimBody,
  StepContext,
  WeaponSlotState,
} from "@motor-combat-moba/shared";
import {
  ARENA_IDS,
  CAMERA_CONFIG,
  DRIVE_CONFIG,
  STATUS_CONFIG,
  GameMode,
  INPUT_MESSAGE,
  MAX_PLAYERS,
  MS_PER_TICK,
  PlayerStatus,
  muzzleOf,
  RoomPhase,
  TICK_RATE_HZ,
  WEAPON_SLOT_CONFIG,
  getArena,
  isArenaId,
  isWeaponId,
  weaponDefOf,
  weaponTicksOf,
} from "@motor-combat-moba/shared";
import { applyCarSprite, phaserTextures, resolveCarSprite } from "../assets/car-sprite.js";
import { isDebugEnabled } from "../config/client-mode.js";
import { ARENA_VIEW_WIDTH, HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import { SLOT_KEYS, slotMaskFrom } from "../config/slot-keys.js";
import { InterpolationBuffer } from "../net/interpolation.js";
import { PredictionBuffer } from "../net/prediction.js";
import { blendPose } from "../net/interpolation.js";
import { buildStepContext, localModifiers } from "../net/step-context.js";
import { bindViewRouter } from "../net/view.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderArenaMismatch } from "../ui/screens/arena-mismatch.js";
import { arenaMismatchMessage } from "./arena-mismatch.js";
import { axisOf, drainTicks } from "./arena-input.js";
import { arenaBorderRect, arenaColorsOf } from "./arena-visual.js";
import { fitsViewport } from "./arena-camera.js";
import { assetManifest, assetsReady } from "./BootScene.js";
import { freshImpacts, newImpactTracker, type ImpactTracker } from "./impact-feedback.js";
import { carFillOf, carShapeOf, deathFadeAlpha, hexagonPoints } from "./car-visual.js";
import {
  AURA_FILL_ALPHA,
  AURA_RING_WIDTH,
  allegianceOf,
  beamFadeAlpha,
  hpBarColor,
  hpBarPoints,
  isAuraWeapon,
  hpFraction,
  instanceDrawShape,
  beamDrawLayers,
  chargeOrbBands,
  instanceGlowBands,
  lockBracketArms,
  SHOW_LOCK_BRACKET,
  weaponFillOf,
  type Allegiance,
  type HpBarGeometry,
} from "./combat-visual.js";
import {
  cycleSpectate,
  isSpectating,
  panFreeCam,
  resolveSpectateTarget,
  smoothFollow,
  spectatableIds,
  type SpectateCandidate,
} from "./spectate.js";
import {
  HUD_DIM,
  countdownSeconds,
  HUD_ICON_FIT_SCALE,
  resolveWeaponIcon,
  SLOT_KEY_FONT_PX,
  SLOT_NAME_FONT_PX,
  type SlotBox,
  slotBarLayout,
  slotVisualState,
  sweepFraction,
  type ResolvedWeaponIcon,
  type SlotVisual,
} from "./weapon-hud.js";
import {
  STATUS_BADGE_HEIGHT_PX,
  STATUS_BAR_WIDTH_PX,
  STATUS_LABEL_FONT_PX,
  statusBadges,
  statusStripLayout,
} from "./status-hud.js";
import { arrowBobOffset, countdownArrowPoints } from "./countdown-arrow.js";
import {
  ROSTER_NAME_FONT_PX,
  rosterPanelLayout,
  rosterRows,
  truncateName,
} from "./roster-panel.js";

const ARENA_BORDER_PX = 4;
const HUD_TEXT = "#1d1f21";
const HITBOX_STROKE = 0x1d1f21;
const HITBOX_PX = 1;

// --- the world layer stack ---------------------------------------------------------------------
/**
 * Every world-space depth in one ordered block, highest first, so the constants read top to bottom
 * as the picture does. HUD depths are a separate stack far above all of these (`HUD_DEPTH`).
 *
 * The one thing to keep true when adding a layer: a depth that is not written down here is a layer
 * whose position is an accident of display-list insertion order, and the next person to add an
 * object will move it without knowing they did.
 *
 * Over everything: a bar is the last thing that may ever be hidden.
 */
const HP_BAR_DEPTH = 60;
/** Under the hp bar, over the cars: the bracket frames a car, it never occludes its own hp. */
const LOCK_DEPTH = 55;
/**
 * The countdown arrow that marks your own car (`drawCountdownArrow`). Above the cars so the marker
 * is never hidden by the car it is marking, and below `LOCK_DEPTH` / `HP_BAR_DEPTH` so it can never
 * occlude a bracket or a bar.
 */
const ARROW_DEPTH = 52;
/**
 * The cars. Previously nothing set this at all and the whole stack rested on Phaser's implicit
 * default of 0 — harmless while every other layer was explicitly above or below it, and no longer
 * harmless now that weapon instances sit *underneath* the cars: the default became load-bearing the
 * moment something depended on being below it, so it is written down.
 */
const CAR_DEPTH = 0;
/**
 * Every live weapon instance — projectiles and beams alike — draws below every car (D7).
 *
 * One rule for all instances rather than a per-weapon "is this a ground effect" flag, and the cost
 * of that is real and accepted: a `fireball` crossing behind a car is briefly hidden by it. The
 * alternative is a second taxonomy on top of `kind`, encoding a distinction the table already has.
 * Ship the one rule, play it, and split it only if the hidden projectile turns out to matter more
 * than the simplicity. The name stays `SHOT_DEPTH` — it is still every instance, it has only
 * changed layers.
 */
const SHOT_DEPTH = -5;
/** The floor everything else is drawn on. */
const ARENA_DEPTH = -10;

/** The bar lies across the car's tail, so these are in the car's frame, not the screen's. */
const HP_BAR_GEOMETRY: HpBarGeometry = {
  length: 44,
  thickness: 5,
  // Clear of the car's own silhouette, which is `DRIVE_CONFIG.carWidth` long nose to tail.
  offset: DRIVE_CONFIG.carWidth / 2 + 6,
};
const HP_BAR_BACK = 0x22252b;

const LOCK_COLOR = 0xf2e14c;
const LOCK_WIDTH = 2;

/**
 * The countdown arrow's paint: the same green the local player's own hp bar draws in, taken from
 * `hpBarColor` rather than copied as a hex so the two can never drift apart.
 *
 * Deliberately not the player's own CAR colour — the arrow means "you" rather than "someone", and a
 * colour the player has not learned yet would be one more thing to tell apart at exactly the moment
 * they cannot tell anything apart. Ally green is the colour the HUD is already teaching them in that
 * same three seconds, on the bar directly under the arrow, so the marker and the bar say "you" in
 * one voice.
 *
 * It replaced an off-white that sat too close to the arena floor to read. Anything painted on this
 * floor has to clear a light, low-contrast ground; that is the constraint to test against if this is
 * ever re-picked, and `ARENA_COLOR_DEFAULTS.floor` (`arena-visual.ts`, 0xEBEBEB) is the ground in
 * question — an arena may override it, so a colour that only just clears the default is not safe.
 *
 * Near-opaque — it is only ever on screen while nothing is moving.
 */
const ARROW_COLOR = hpBarColor("ally");
const ARROW_ALPHA = 0.95;

/**
 * There is no wreck any more. A dead car is intangible and frozen from the tick it dies (shared
 * `isOnField` reads `alive`), and the client fades it to nothing over `DEATH_FADE_MS` and then stops
 * drawing it — see `deathFadeAlpha`. Nothing here holds a fixed wreck alpha.
 */

const HUD_DEPTH = 1000;

// --- weapon slot HUD ---------------------------------------------------------------------------
/**
 * Explicit per-layer depths, strictly above `HUD_DEPTH` itself (which stays the depth of unrelated
 * top-of-screen HUD text). Phaser resolves equal-depth objects by display-list insertion order, so
 * without these a slot's manifest icon — added to the display list in `buildHudTextPool`, after
 * that slot's own key/countdown/stock text — would draw ON TOP of its countdown number, and the
 * cooldown sweep wedge — previously just another shape drawn into the same `Graphics` as the box
 * background — would draw entirely UNDER the icon instead of over it. Order here must stay ring,
 * icon, sweep, text: the sweep is a cooldown overlay and has to sit above whatever it is timing out
 * (icon or procedural glyph alike), and the text has to stay legible above that overlay.
 */
const HUD_BOX_DEPTH = HUD_DEPTH;
const HUD_ICON_DEPTH = HUD_DEPTH + 1;
const HUD_SWEEP_DEPTH = HUD_DEPTH + 2;
const HUD_TEXT_DEPTH = HUD_DEPTH + 3;
/**
 * The slot's copper ring and the wash inside it.
 *
 * A slot used to be a filled black disc, which read as a hole punched in the cream gutter rather
 * than a frame around a weapon. It is now a ring with the icon in the middle and the gutter showing
 * through. Everything in this block is a knob rather than a derived value: the look was settled
 * against mockups, so the numbers most likely to want another pass are named and gathered here.
 */
const HUD_RING_COLOR = 0xc67139;
const HUD_RING_WIDTH_PX = 3;
/** Fill inside the ring, as an alpha on `HUD_RING_COLOR`. 0 leaves the slot fully transparent. */
const HUD_RING_WASH_ALPHA = 0.12;
/**
 * The unspent part of the ring while a cooldown drains it. Deliberately low: the bright remaining
 * arc is the "how much is left" channel now that no wedge darkens the middle, and a track drawn at
 * full strength would compete with it.
 */
const HUD_RING_TRACK_ALPHA = 0.22;
/**
 * Whether the draining ring keeps full brightness while the rest of the slot dims to
 * `HUD_DIM.recharging`. True is the shipped look: the arc is the one live thing in a recharging
 * slot, and dimming it to 0.4 alongside the wash and glyph left the timer the hardest part of the
 * slot to read. Flip to false to have the whole slot, ring included, dim as one.
 */
const HUD_SWEEP_HOLDS_FULL = true;

/**
 * The procedural glyph's colours. A manifest icon PNG never reaches these — it keeps whatever
 * colour it shipped with (`colorMode: "none"`, see `applyWeaponIcon`) — so this is the palette of
 * the permanent fallback only.
 *
 * The outline is what keeps a bright yellow legible: `HUD_GLYPH_COLOR` and the cream gutter sit
 * close enough in luminance that a bare flame reads as a smudge at 64px, and the ring's wash under
 * it only narrows the gap.
 */
const HUD_GLYPH_COLOR = 0xffe066;
const HUD_GLYPH_CORE_COLOR = 0xfff3b0;
const HUD_GLYPH_OUTLINE_COLOR = 0x8a4f1c;
const HUD_GLYPH_OUTLINE_PX = 1.5;
/** Fraction of the box half-width the procedural glyph fills, leaving a frame around it. */
const HUD_GLYPH_SCALE = 0.42;
/** The hot core, as a fraction of the flame's radius. */
const HUD_GLYPH_CORE_SCALE = 0.55;
/** How far the core sits below the flame's centre, so the flame's tip stays a single tone. */
const HUD_GLYPH_CORE_OFFSET_SCALE = 0.1;
/** Beam glyph is a bar, not a flame — this is its width as a fraction of the icon radius. */
const HUD_BEAM_WIDTH_SCALE = 0.5;
// --- buff / debuff badges ------------------------------------------------------------------
/** The strip's own text colour, over each badge's `STATUS_TABLE.color` wash. */
const HUD_STATUS_TEXT = "#ffffff";
/** Alpha on the badge's colour for the body of the pill. The drain bar draws at full. */
const HUD_STATUS_WASH_ALPHA = 0.45;
/** Inset from the badge box to its label. */
const HUD_STATUS_LABEL_PAD_X = 6;

// --- roster panel ------------------------------------------------------------------------------
/**
 * How a dead player is greyed out: one text colour and one alpha on the swatch, so "greyed" is two
 * constants rather than a scattering of literals in the draw loop. The row stays listed either way
 * (D3) — the grey is the whole difference between alive and out.
 *
 * The colour is `HUD_TEXT` lifted toward the cream gutter until the name reads as present but not
 * current; the alpha is on the swatch's own player colour, which must stay recognisable as that
 * player's colour rather than becoming a neutral grey chip.
 */
const ROSTER_DEAD_TEXT = "#8d9096";
const ROSTER_DEAD_SWATCH_ALPHA = 0.3;
/** A living row's name, matching the rest of the gutter's text. */
const ROSTER_LIVE_TEXT = HUD_TEXT;

const HUD_KEY_FONT_PX = SLOT_KEY_FONT_PX;
const HUD_NAME_FONT_PX = SLOT_NAME_FONT_PX;

/**
 * `HUD_RING_COLOR` as a CSS string, for the `Text` objects that have to match the ring — `Graphics`
 * takes the number, `Text` takes the string, and deriving the second from the first is what stops
 * the two drifting apart the next time the ring is re-coloured.
 */
const HUD_RING_CSS = `#${HUD_RING_COLOR.toString(16).padStart(6, "0")}`;
/**
 * The key label's pill: the ring's colour behind it, white on top. Padding is what turns the label
 * into a pill rather than a tight swatch, and it is also why `SLOT_KEY_COLUMN_PX` had to grow —
 * see that constant, and `HUD_GUTTER_WIDTH` behind it.
 */
const HUD_KEY_PILL_TEXT = "#ffffff";
/**
 * The weapon name's weight. Bold because the name is the only thing in the gutter carrying a word
 * rather than a shape, and at `SLOT_NAME_FONT_PX` in the ring's copper it was the first thing to
 * fall away against the cream — a heavier face buys back contrast that a smaller palette cannot.
 */
const HUD_NAME_FONT_STYLE = "bold";
const HUD_KEY_PILL_PAD_X = 8;
const HUD_KEY_PILL_PAD_Y = 3;
/**
 * Stock count offset from the centre along the diagonal, as a fraction of the radius. Pulled in
 * from 0.55 when the black disc went: the count used to have an opaque backing and could sit near
 * the edge, but against a ring it collided with the stroke itself.
 */
const HUD_STOCK_RADIUS_SCALE = 0.45;
const HUD_COUNTDOWN_FONT_PX = 18;
const HUD_STOCK_FONT_PX = 13;
/**
 * The countdown hangs under the key label rather than in the middle of the slot. The middle used to
 * be free — a dark wedge covered it and the glyph was a small dot — but the flame owns it now, and
 * a number over the flame is unreadable at this size. Left-aligned on `SlotBox.keyX`, the same
 * column the key uses, so the two stack.
 *
 * 24, not the 20 it shipped at: measured against Phaser's default Courier, the key pill is 22px
 * tall and the 18px countdown 20px, so 20 put the number 1px INSIDE the pill above it. 24 clears
 * the pill by 3px and still stops 4px short of the name band at `SLOT_NAME_GAP_PX` below.
 */
const HUD_COUNTDOWN_KEY_OFFSET_PX = 24;
/** Straight up, so the arc drains clockwise from 12 o'clock like a standard ability cooldown. */
const HUD_SWEEP_START_ANGLE = -Math.PI / 2;

/**
 * The flame silhouette in unit space: a teardrop with its tip at (0, -1) and its belly at (0, 1).
 *
 * The shape was authored as four cubic beziers, but `Graphics` has no bezier command — only
 * `Curves.Path` does, and building one per slot per frame to draw a 27px glyph is not worth it. So
 * the curves are flattened to a polygon once here, at module load, and `drawWeaponGlyph` scales the
 * same points twice: once for the flame, once for its hot core.
 *
 * Each segment's samples start at `t` one step in, because a segment's start point is the previous
 * segment's end and has already been pushed. The outline is closed by the caller, which is what
 * supplies the one missing edge back to the tip.
 */
const FLAME_UNIT_POINTS: ReadonlyArray<{ readonly x: number; readonly y: number }> = (() => {
  const segments: ReadonlyArray<readonly number[]> = [
    [0, -1, 0.5, -0.5, 0.9, -0.2, 0.9, 0.25],
    [0.9, 0.25, 0.9, 0.75, 0.5, 1, 0, 1],
    [0, 1, -0.5, 1, -0.9, 0.75, -0.9, 0.25],
    [-0.9, 0.25, -0.9, -0.2, -0.5, -0.5, 0, -1],
  ];
  const stepsPerSegment = 10;
  const points: { x: number; y: number }[] = [];
  for (const seg of segments) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = seg as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 1; i <= stepsPerSegment; i++) {
      const t = i / stepsPerSegment;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      points.push({ x: a * x0 + b * x1 + c * x2 + d * x3, y: a * y0 + b * y1 + c * y2 + d * y3 });
    }
  }
  return points;
})();

/**
 * Scratch buffer `flamePoints` writes into, so drawing a flame costs no allocation per frame.
 *
 * One buffer, deliberately: the flame and its core are drawn back to back, and every `fillPoints` /
 * `strokePoints` call reads the array before returning. Anything that needs two flame outlines
 * ALIVE at once has to stop sharing this.
 */
const flameScratch: Phaser.Geom.Point[] = FLAME_UNIT_POINTS.map(() => new Phaser.Geom.Point());

/** The subset of `PlayerState` the arena renders and predicts from. */
interface ArenaPlayer {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
  angVel: number;
  shoveX: number;
  shoveY: number;
  authority: number;
  status: number;
  carId: string;
  colorId: number;
  lastProcessedInputSeq: number;
  hp: number;
  alive: boolean;
  diedAtTick: number;
  name: string;
}

/**
 * WASD, sitting alongside the cursor keys rather than replacing them. Both sets steer at all times
 * and there is no setting: two players on one keyboard is not a mode this game has, so accepting
 * both costs nothing (D5).
 *
 * These are the same four codes `bindKeys` binds for the spectator's free-roam pan, and Phaser's
 * `addKey` hands back the Key it already made for a code — so this is one binding read from two
 * places, not two bindings competing. The modes never overlap anyway: free roam is only reachable
 * once you are a wreck with no car to drive.
 */
interface DriveKeys {
  up: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
}

/** The keys this scene binds beyond the drive keys and the weapon slots: spectator controls. */
interface SpectateKeys {
  prev: Phaser.Input.Keyboard.Key;
  next: Phaser.Input.Keyboard.Key;
  freeRoam: Phaser.Input.Keyboard.Key;
  panLeft: Phaser.Input.Keyboard.Key;
  panRight: Phaser.Input.Keyboard.Key;
  panUp: Phaser.Input.Keyboard.Key;
  panDown: Phaser.Input.Keyboard.Key;
}

function bodyOf(player: ArenaPlayer): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
    shoveX: player.shoveX,
    shoveY: player.shoveY,
    authority: player.authority,
  };
}

/**
 * A car is redrawn from scratch only when its chassis, colour, or living state changes, not every
 * frame. `alive` is part of the key because a dead car is drawn differently, and without it a car that
 * died would keep its living silhouette until something else happened to change the key.
 */
function visualKeyOf(player: ArenaPlayer): string {
  return `${player.carId}:${player.colorId}:${player.alive}`;
}

export class ArenaScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private prediction = new PredictionBuffer();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private readonly cars = new Map<string, Phaser.GameObjects.Container>();
  private readonly visualKeys = new Map<string, string>();
  private arenaGfx: Phaser.GameObjects.Graphics | undefined;
  private arena: ArenaDef | undefined;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  /** WASD, ORed with `cursors` in `sendInputTick`; see `DriveKeys`. */
  private driveKeys: DriveKeys | undefined;
  /** One Phaser key per `SLOT_KEYS` entry, same order, so `slotMaskFrom` reads them index-for-index. */
  private slotKeys: Phaser.Input.Keyboard.Key[] | undefined;
  private predicted: SimBody | undefined;
  /** The predicted pose before the newest tick; `renderCars` blends from it toward `predicted`. */
  private predictedPrev: SimBody | undefined;
  private camFocus: { x: number; y: number } | undefined;
  private inputAccumulatorMs = 0;
  /**
   * Monotonic for the lifetime of the page, deliberately *not* reset in `create`. The server never
   * resets `PlayerState.lastProcessedInputSeq`, so a seq that restarted at 1 for a second match
   * would sit below the standing ack and reconciliation would discard every pending input — the car
   * would fall back to pure server-follow. It is only ever nudged forward, never back.
   */
  private inputSeq = 0;
  private debug = false;
  /**
   * Whether the boot loader is still running. Inspectable state only — the rebuild that swaps
   * silhouettes for sprites is caused by the `visualKeys.clear()` beside where this is cleared,
   * not by this flag, which nothing reads on the draw path.
   */
  private artPending = true;
  private unbind: Array<() => void> = [];
  private countdownText: Phaser.GameObjects.Text | undefined;
  private shotGfx: Phaser.GameObjects.Graphics | undefined;
  private hpGfx: Phaser.GameObjects.Graphics | undefined;
  private lockGfx: Phaser.GameObjects.Graphics | undefined;
  private arrowGfx: Phaser.GameObjects.Graphics | undefined;
  private spectateText: Phaser.GameObjects.Text | undefined;
  private keys: SpectateKeys | undefined;
  /** Session id of the car the spectate camera is watching. `""` means "nobody left to watch". */
  private spectateTarget = "";
  private freeRoam = false;
  /**
   * True when the arena is small enough to be on screen in its entirety, which is what `ARENA_01`
   * is authored for. The camera is then parked on the arena centre for the whole match: following a
   * car could only scroll a picture that is already complete, and would jitter it every time
   * reconciliation nudged the local pose. Larger arenas keep the follow camera and free roam.
   */
  private staticCamera = false;
  /**
   * When the last state patch landed, for drawing shots between patches. `performance.now()` rather
   * than Phaser's clock, for the reason spelled out in `pushRemoteSnapshots`.
   */
  private lastPatchMs = 0;
  private mismatchOverlay: ScreenOverlay | undefined;

  /**
   * The weapon slot HUD: one Graphics for every box and glyph, a second Graphics for the cooldown
   * sweep wedge (kept separate so it can sit at `HUD_SWEEP_DEPTH`, above the icon pool — see that
   * constant's comment), both cleared and redrawn each frame same as `shotGfx`/`hpGfx`, and a
   * fixed-size pool of Text objects — one per possible slot — reused across frames rather than
   * created and destroyed at the render rate.
   */
  private hudCamera: Phaser.Cameras.Scene2D.Camera | undefined;
  private hudGfx: Phaser.GameObjects.Graphics | undefined;
  private hudSweepGfx: Phaser.GameObjects.Graphics | undefined;
  private hudKeyTexts: Phaser.GameObjects.Text[] = [];
  private hudNameTexts: Phaser.GameObjects.Text[] = [];
  private hudCountdownTexts: Phaser.GameObjects.Text[] = [];
  private hudStockTexts: Phaser.GameObjects.Text[] = [];
  /**
   * One pooled Image per possible slot, for the manifest icon. Hidden and left textureless until a
   * slot resolves one; a slot with no manifest icon never touches this pool and keeps drawing
   * `drawWeaponGlyph`'s procedural shape instead, same fallback contract as a car's silhouette.
   */
  private hudIconImages: Phaser.GameObjects.Image[] = [];
  /** One pooled label per badge the strip can ever show — `STATUS_CONFIG.maxActive` of them. */
  private hudStatusTexts: Phaser.GameObjects.Text[] = [];
  /**
   * The roster panel: one pooled name per seat (`MAX_PLAYERS` of them), and its **own** Graphics for
   * the colour swatches.
   *
   * The second Graphics is the point. `hudGfx` is `clear()`ed at the top of `renderWeaponHud`, so
   * swatches drawn into it from a different method would live or die on which method ran last — a
   * silent ordering dependency that the next person to reorder `update()` would break without a
   * failing test anywhere. One extra draw call removes the trap entirely.
   */
  private rosterGfx: Phaser.GameObjects.Graphics | undefined;
  private rosterNameTexts: Phaser.GameObjects.Text[] = [];

  /**
   * Local-only contact tracker for {@link showImpact}. Purely a render-feel aid — see
   * `impact-feedback.ts` — and reset in `create` alongside the rest of per-match scene state so a
   * re-entered arena does not carry a stale "still touching" contact from the previous match.
   */
  private impacts: ImpactTracker = newImpactTracker();

  constructor() {
    super({ key: "arena" });
  }

  create(): void {
    this.resetMatchState();
    this.debug = isDebugEnabled();
    // Reuses the existing rebuild path rather than adding a second one: dropping the cached visual
    // keys makes `syncCar` treat every car as changed, so each is redrawn once, now with its sprite.
    void assetsReady()
      .then(() => {
        this.artPending = false;
        this.visualKeys.clear();
      })
      // Nothing in `loadArt` rejects today, but an unhandled rejection here would be silent and the
      // match would simply never swap in its sprites. Warn instead.
      .catch((error: unknown) => console.warn(`[art] asset load rejected: ${String(error)}`));
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    this.inputSeq = Math.max(
      this.inputSeq,
      this.room.state.players.get(this.room.sessionId)?.lastProcessedInputSeq ?? 0,
    );

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.driveKeys = this.bindDriveKeys();
    this.keys = this.bindKeys();
    this.slotKeys = this.bindSlotKeys();

    // Guarded rather than resolved directly: `getArena` throws, and this line runs before the rest
    // of create() builds anything, so an unknown id would leave a half-constructed scene and a
    // stack trace instead of a black screen with a reason on it.
    const arenaId = this.room.state.arenaId;
    if (!isArenaId(arenaId)) {
      const message = arenaMismatchMessage(arenaId, ARENA_IDS);
      this.mismatchOverlay = new ScreenOverlay(this);
      this.mismatchOverlay.render(renderArenaMismatch(message));
      console.error(`[arena] ${message}`);
      return;
    }

    // Hoisted out of the 30 Hz prediction path: `getArena` is a lookup that throws, and the arena
    // cannot change while the scene is alive.
    this.arena = getArena(arenaId);
    this.drawArena(this.arena);

    // One Graphics for every shot, one for every hp bar, one for every lock bracket and one for the
    // countdown arrow, cleared and redrawn each frame. All four are drawn in *world* space but must
    // not rotate with any car, so none can live inside a car's own Graphics; a per-shot object would
    // also mean creating and destroying objects at the fire rate for no gain.
    this.shotGfx = this.add.graphics().setDepth(SHOT_DEPTH);
    this.hpGfx = this.add.graphics().setDepth(HP_BAR_DEPTH);
    this.lockGfx = this.add.graphics().setDepth(LOCK_DEPTH);
    this.arrowGfx = this.add.graphics().setDepth(ARROW_DEPTH);
    this.hudGfx = this.add.graphics().setScrollFactor(0).setDepth(HUD_BOX_DEPTH);
    this.hudSweepGfx = this.add.graphics().setScrollFactor(0).setDepth(HUD_SWEEP_DEPTH);
    this.rosterGfx = this.add.graphics().setScrollFactor(0).setDepth(HUD_BOX_DEPTH);
    this.buildHudTextPool();

    // Centred on the arena, not on the canvas: the gutter is off to the right of both of these, and
    // a countdown that drifted to the canvas centre would sit off-centre over the floor everyone is
    // actually looking at.
    this.countdownText = this.add
      .text(ARENA_VIEW_WIDTH / 2, 280, "", { fontSize: "96px", color: HUD_TEXT })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH)
      .setVisible(false);

    this.spectateText = this.add
      .text(ARENA_VIEW_WIDTH / 2, 660, "", { fontSize: "22px", color: HUD_TEXT })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH)
      .setVisible(false);

    this.splitCameras();
    this.bindRoom(this.room);
    this.syncMatchHud();
  }

  /**
   * `[` / `]` and, once you are a wreck, Left / Right cycle who you are watching; `V` toggles free
   * roam.
   *
   * The arrows do double duty on purpose, and the modes are what keep that unambiguous: while you
   * are alive they steer, and only a spectator can cycle with them. In free roam they pan instead,
   * so cycling is on the bracket keys there.
   */
  private bindKeys(): SpectateKeys | undefined {
    const keyboard = this.input.keyboard;
    if (!keyboard) return undefined;
    const Codes = Phaser.Input.Keyboard.KeyCodes;
    return {
      prev: keyboard.addKey(Codes.OPEN_BRACKET),
      next: keyboard.addKey(Codes.CLOSED_BRACKET),
      freeRoam: keyboard.addKey(Codes.V),
      panLeft: keyboard.addKey(Codes.A),
      panRight: keyboard.addKey(Codes.D),
      panUp: keyboard.addKey(Codes.W),
      panDown: keyboard.addKey(Codes.S),
    };
  }

  /** WASD for steering and throttle, read beside the cursor keys. See `DriveKeys` for why both. */
  private bindDriveKeys(): DriveKeys | undefined {
    const keyboard = this.input.keyboard;
    if (!keyboard) return undefined;
    const Codes = Phaser.Input.Keyboard.KeyCodes;
    return {
      up: keyboard.addKey(Codes.W),
      left: keyboard.addKey(Codes.A),
      down: keyboard.addKey(Codes.S),
      right: keyboard.addKey(Codes.D),
    };
  }

  /**
   * One Phaser key per `SLOT_KEYS` entry. Bound explicitly, like the old single `fire` key, so a
   * slot key never falls through to whatever the page would otherwise do with it.
   */
  private bindSlotKeys(): Phaser.Input.Keyboard.Key[] | undefined {
    const keyboard = this.input.keyboard;
    if (!keyboard) return undefined;
    return SLOT_KEYS.map((key) => keyboard.addKey(key.code));
  }

  private drawArena(arena: ArenaDef): void {
    const colors = arenaColorsOf(arena);
    const gfx = this.add.graphics().setDepth(ARENA_DEPTH);
    gfx.fillStyle(colors.obstacle, 1);
    for (const obstacle of arena.obstacles) {
      gfx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    }
    gfx.lineStyle(ARENA_BORDER_PX, colors.border, 1);
    const border = arenaBorderRect(arena, ARENA_BORDER_PX);
    gfx.strokeRect(border.x, border.y, border.w, border.h);
    this.arenaGfx = gfx;

    const cam = this.cameras.main;
    // Clipped to the arena's share of the canvas, leaving `HUD_GUTTER_WIDTH` down the right for the
    // weapon slots. This must come before `centerOn` below, which reads the camera's width to work
    // out its scroll — resizing the viewport afterwards would leave the arena off-centre by half the
    // gutter. It also bounds the background fill on the next line, which is what stops the floor
    // colour flooding the gutter the way it used to flood the whole canvas.
    cam.setViewport(0, 0, ARENA_VIEW_WIDTH, VIEW_HEIGHT);
    // Scene-scoped: the global game background stays dark for the lobby and results screens.
    cam.setBackgroundColor(colors.floor);
    cam.setZoom(CAMERA_CONFIG.zoom);
    // Stops the soft follow from panning past the arena edge into empty space.
    cam.setBounds(0, 0, arena.width, arena.height);

    // `ARENA_VIEW_WIDTH`, never `VIEW_WIDTH`: how much world anyone can see is the camera's
    // business, and widening the canvas for HUD must not quietly widen the view of the floor.
    this.staticCamera = fitsViewport(
      arena,
      { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT },
      CAMERA_CONFIG.zoom,
    );
    if (this.staticCamera) cam.centerOn(arena.width / 2, arena.height / 2);
  }

  /**
   * Splits the scene across two cameras: the world one clipped to the arena, and a HUD one covering
   * the whole canvas so the slot column can live in the gutter that the world camera cannot reach.
   *
   * Phaser renders the entire display list once PER camera, so the two `ignore` lists are not an
   * optimisation — without them the arena would draw twice, once clipped into its viewport and once
   * whole across the canvas on top of it. Every object in the scene must therefore be ignored by
   * exactly one camera: ignored by neither and it double-draws, ignored by both and it vanishes.
   *
   * That makes this the one place to remember when adding to the scene. Everything the HUD owns is
   * pooled up front and listed here; the only object created later is a car's container, which
   * `syncCar` hands to the HUD camera's ignore list at birth.
   */
  private splitCameras(): void {
    const world = this.cameras.main;
    const hud = this.cameras.add(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    this.hudCamera = hud;

    const hudObjects: Phaser.GameObjects.GameObject[] = [
      ...(this.hudGfx ? [this.hudGfx] : []),
      ...(this.hudSweepGfx ? [this.hudSweepGfx] : []),
      ...(this.rosterGfx ? [this.rosterGfx] : []),
      ...(this.countdownText ? [this.countdownText] : []),
      ...(this.spectateText ? [this.spectateText] : []),
      ...this.hudKeyTexts,
      ...this.hudNameTexts,
      ...this.hudCountdownTexts,
      ...this.hudStockTexts,
      ...this.hudIconImages,
      ...this.hudStatusTexts,
      ...this.rosterNameTexts,
    ];
    const worldObjects: Phaser.GameObjects.GameObject[] = [
      ...(this.arenaGfx ? [this.arenaGfx] : []),
      ...(this.shotGfx ? [this.shotGfx] : []),
      ...(this.hpGfx ? [this.hpGfx] : []),
      // Was in neither list, and so drew twice — once clipped into the arena viewport and once
      // unclipped across the whole canvas, over the gutter (D13). It draws in world space at
      // `LOCK_DEPTH`, so the world camera is the one that keeps it.
      ...(this.lockGfx ? [this.lockGfx] : []),
      // World space at `ARROW_DEPTH`, drawn over the local car during the countdown, so the world
      // camera keeps it and the HUD camera must not draw it a second time over the gutter.
      ...(this.arrowGfx ? [this.arrowGfx] : []),
      ...this.cars.values(),
    ];

    world.ignore(hudObjects);
    hud.ignore(worldObjects);
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
      this.lastPatchMs = performance.now();
      this.syncMatchHud();
      this.reconcileLocal(room);
      this.pushRemoteSnapshots(room);
    };
    room.onStateChange(onState);
    this.unbind.push(() => room.onStateChange.remove(onState));

    const onLeave = (): void => {
      this.registry.remove("room");
      this.scene.start("join");
    };
    room.onLeave(onLeave);
    this.unbind.push(() => room.onLeave.remove(onLeave));
  }

  private unbindAll(): void {
    for (const fn of this.unbind) fn();
    this.unbind = [];
  }

  private onShutdown(): void {
    this.resetMatchState();
    this.room = undefined;
  }

  /**
   * The single teardown path, called from both `create` and `onShutdown`.
   *
   * Phaser guarantees shutdown-before-create, so one of these is always redundant — but only as long
   * as both reset the *same* fields. Two partial reset paths is exactly the shape that let a
   * `PredictionBuffer` survive across matches and replay a previous match's pending inputs. Adding a
   * field here covers both entry points at once; adding it to only one covers neither reliably.
   */
  private resetMatchState(): void {
    this.unbindAll();
    for (const gfx of this.cars.values()) gfx.destroy();
    this.cars.clear();
    this.visualKeys.clear();
    this.interps.clear();
    this.arenaGfx?.destroy();
    this.arenaGfx = undefined;
    this.arena = undefined;
    this.countdownText?.destroy();
    this.countdownText = undefined;
    this.spectateText?.destroy();
    this.spectateText = undefined;
    this.shotGfx?.destroy();
    this.shotGfx = undefined;
    this.hpGfx?.destroy();
    this.hpGfx = undefined;
    this.lockGfx?.destroy();
    this.lockGfx = undefined;
    this.arrowGfx?.destroy();
    this.arrowGfx = undefined;
    this.hudGfx?.destroy();
    this.hudGfx = undefined;
    this.hudSweepGfx?.destroy();
    this.hudSweepGfx = undefined;
    this.rosterGfx?.destroy();
    this.rosterGfx = undefined;
    for (const text of this.hudKeyTexts) text.destroy();
    for (const text of this.hudNameTexts) text.destroy();
    for (const text of this.hudCountdownTexts) text.destroy();
    for (const text of this.hudStockTexts) text.destroy();
    for (const image of this.hudIconImages) image.destroy();
    for (const text of this.hudStatusTexts) text.destroy();
    for (const text of this.rosterNameTexts) text.destroy();
    this.hudKeyTexts = [];
    this.hudNameTexts = [];
    this.hudCountdownTexts = [];
    this.hudStockTexts = [];
    this.hudIconImages = [];
    this.hudStatusTexts = [];
    this.rosterNameTexts = [];
    // Phaser tears the camera itself down with the scene; this just stops `syncCar` handing a
    // destroyed camera an ignore during the shutdown frame.
    this.hudCamera = undefined;
    this.cursors = undefined;
    this.driveKeys = undefined;
    this.keys = undefined;
    this.slotKeys = undefined;
    this.prediction = new PredictionBuffer();
    this.predicted = undefined;
    this.predictedPrev = undefined;
    this.camFocus = undefined;
    this.inputAccumulatorMs = 0;
    this.spectateTarget = "";
    this.freeRoam = false;
    this.lastPatchMs = 0;
    this.mismatchOverlay?.destroy();
    this.mismatchOverlay = undefined;
    this.impacts = newImpactTracker();
  }

  update(_time: number, delta: number): void {
    const room = this.room;
    // `this.room` is assigned before the arena-mismatch guard in `create()`, and that guard can
    // return early without clearing it — so a truthy room is not proof `create()` finished. `arena`
    // is the field the mismatch path actually leaves unset, and everything below reaches it sooner
    // or later (`pumpInput` -> `stepContext` falls back to `getArena(room.state.arenaId)`, the same
    // id that just failed `isArenaId`), so it is the one precondition worth checking here.
    if (!room || !this.arena) return;

    this.syncMatchHud();
    this.pumpInput(room, delta);
    this.updateSpectate(room, delta);
    this.renderCars(room, delta);
    this.renderShots(room);
    // The panel's height is the slots' top inset, so the roster draws first and hands that one
    // number to the rest of the gutter. Derived here and nowhere else on purpose: the panel lists
    // every IN_MATCH player while `renderWeaponHud` lays out for `hudTargetPlayer` — the
    // *spectated* car, which is not always yours — so a second derivation would count a different
    // set of players and the two would disagree about where the panel ends (D12).
    const panelHeight = this.renderRosterPanel(room);
    this.renderWeaponHud(room, panelHeight);
  }

  // --- input -------------------------------------------------------------------------------

  /** Inputs go out on the sim clock, not the render clock. See `drainTicks` for the arithmetic. */
  private pumpInput(room: Room<ArenaState>, delta: number): void {
    if (!this.canDrive(room)) {
      this.inputAccumulatorMs = 0;
      return;
    }

    const { accMs, ticks } = drainTicks(this.inputAccumulatorMs, delta);
    this.inputAccumulatorMs = accMs;
    for (let i = 0; i < ticks; i++) this.sendInputTick(room);
  }

  /**
   * The same gate `serverTick` and `runCombat` use, so a client never predicts a step the server
   * would not have run. `alive` is part of it: a wreck's inputs are drained and acked but move
   * nothing and fire nothing, so continuing to send them would only spend bandwidth predicting a
   * car that cannot move.
   */
  private canDrive(room: Room<ArenaState>): boolean {
    if (room.state.phase !== RoomPhase.MATCH) return false;
    const local = room.state.players.get(room.sessionId);
    return local?.status === PlayerStatus.IN_MATCH && local.alive;
  }

  private sendInputTick(room: Room<ArenaState>): void {
    const local = room.state.players.get(room.sessionId);
    if (!local) return;

    this.inputSeq += 1;
    const input: InputMessage = {
      seq: this.inputSeq,
      steer: axisOf(
        (this.cursors?.left.isDown ?? false) || (this.driveKeys?.left.isDown ?? false),
        (this.cursors?.right.isDown ?? false) || (this.driveKeys?.right.isDown ?? false),
      ),
      throttle: axisOf(
        (this.cursors?.down.isDown ?? false) || (this.driveKeys?.down.isDown ?? false),
        (this.cursors?.up.isDown ?? false) || (this.driveKeys?.up.isDown ?? false),
      ),
      // Held, not tapped: the server's weapon cooldown decides the rate, so holding a slot key fires
      // it as fast as that slot allows and no faster. Sampling `JustDown` here instead would drop
      // shots whenever a frame straddled two input ticks.
      fireSlots: slotMaskFrom(this.slotKeys?.map((key) => key.isDown) ?? []),
    };
    room.send(INPUT_MESSAGE, input);

    // Predict immediately: the local car has to answer on this frame, not a round-trip later.
    const from = this.predicted ?? bodyOf(local);
    this.predictedPrev = from;
    this.predicted = this.prediction.predict(from, { seq: input.seq, input }, this.stepContext(room));
  }

  private stepContext(room: Room<ArenaState>): StepContext {
    return buildStepContext(
      this.arena ?? getArena(room.state.arenaId),
      room.state,
      room.sessionId,
      // Read fresh on every predicted and reconciled step rather than cached: an effect can lapse
      // between two of them, and the tick it lapses on is the one thing both halves of the lockstep
      // have to agree about.
      localModifiers(room.state, room.sessionId, room.state.tick),
    );
  }

  private reconcileLocal(room: Room<ArenaState>): void {
    const local = room.state.players.get(room.sessionId);
    // Same gate as `canDrive`. A wreck stops predicting: the server has stopped stepping it, so a
    // prediction buffer left running would replay pending inputs against a car that cannot move and
    // then be snapped back every patch.
    if (!local || local.status !== PlayerStatus.IN_MATCH || !local.alive) {
      this.predicted = undefined;
      this.predictedPrev = undefined;
      return;
    }

    const authoritative = bodyOf(local);
    if (!this.predicted) {
      this.predicted = authoritative;
      this.predictedPrev = undefined;
      return;
    }
    // `predictedPrev` is left alone: reconcile eases `predicted`, so the blend simply carries the
    // correction across the rest of the tick window instead of landing it on one frame.
    this.predicted = this.prediction.reconcile(
      authoritative,
      local.lastProcessedInputSeq,
      this.predicted,
      this.stepContext(room),
    );
  }

  // --- rendering ---------------------------------------------------------------------------

  private renderCars(room: Room<ArenaState>, delta: number): void {
    const seen = new Set<string>();
    const hp = this.hpGfx;
    const lock = this.lockGfx;
    const arrow = this.arrowGfx;
    hp?.clear();
    lock?.clear();
    // Cleared here and refilled below, so the first frame after the countdown draws nothing at all:
    // the arrow going away is the absence of a draw call, not an animation that has to be stopped.
    arrow?.clear();
    const poses = new Map<string, SimBody>();
    // Teams alongside poses so the impact-spark pass below can gate on them without a second walk of
    // `room.state.players` (and without carrying `team` through `SimBody`, which has no business
    // knowing about it).
    const teams = new Map<string, 0 | 1>();
    // Whose side each bar is on is answered once per frame, against the LOCAL player and never
    // against `cameraTarget(room)`: a wreck can cycle the spectate camera through living cars, and
    // green must stay your team's green while you watch an enemy fill the screen (D2).
    //
    // A pure spectator who never took a seat has no `viewer`, and every car is then an enemy —
    // nobody is your ally if you have no seat, and the alternative (colouring the watched car
    // green) is exactly the camera-follows-allegiance bug the signature exists to prevent.
    const viewer = room.state.players.get(room.sessionId);
    // Hoisted rather than derived twice: the impact-spark pass below wants the same answer, and two
    // copies of this expression is two things that can drift about what game we are in.
    const mode = room.state.mode === GameMode.TEAM ? "team" : "ffa";

    room.state.players.forEach((player, sessionId) => {
      if (player.status !== PlayerStatus.IN_MATCH) return;
      seen.add(sessionId);

      const serverPose = bodyOf(player);
      const isLocal = sessionId === room.sessionId;
      // The local car draws its predicted pose; remotes draw an interpolated one, so they glide
      // between patches instead of stepping once per packet. A wreck draws the raw server pose:
      // it is not moving, so there is nothing to smooth and nothing to predict.
      const pose = !player.alive
        ? serverPose
        : isLocal
          ? this.localRenderPose(serverPose)
          : this.remotePose(sessionId, serverPose);

      // No wreck: a dead car fades out and is then gone. At alpha 0 the container is destroyed
      // rather than left invisible, so nothing accumulates on the field over a long match.
      const alpha = deathFadeAlpha(player.alive, player.diedAtTick, room.state.tick);
      if (alpha <= 0) {
        this.cars.get(sessionId)?.destroy();
        this.cars.delete(sessionId);
        this.visualKeys.delete(sessionId);
        return;
      }

      this.syncCar(sessionId, player, pose);
      this.cars.get(sessionId)?.setAlpha(alpha);
      poses.set(sessionId, pose);
      teams.set(sessionId, player.team === 1 ? 1 : 0);
      if (hp && player.alive) {
        const allegiance = viewer
          ? allegianceOf(viewer, { sessionId, team: player.team }, mode)
          : "enemy";
        this.drawHpBar(hp, player, pose, allegiance);
      }
      if (sessionId === this.cameraTarget(room)) this.followCamera(pose, delta);
    });

    // Instant, render-only impact feedback: covers the round trip before the authoritative ram
    // knock arrives from the server (see `impact-feedback.ts`). Placed here because this is the
    // first point in the frame where every car's final render pose is known — predicted for the
    // local car, interpolated for remotes, raw for a wreck — so contact is tested against exactly
    // what is on screen, not a pose that will still move this frame.
    //
    // Team-gated: a ram is structurally impossible between teammates (R15), so the spark must not
    // fire on one either — see `freshImpacts`'s doc comment.
    const selfId = this.room?.sessionId;
    const selfPose = selfId ? poses.get(selfId) : undefined;
    const selfTeam = selfId ? teams.get(selfId) : undefined;
    if (selfId && selfPose && selfTeam !== undefined) {
      const others = [...poses.entries()]
        .filter(([id]) => id !== selfId)
        .map(([id, pose]) => ({
          sessionId: id,
          x: pose.x,
          y: pose.y,
          angle: pose.angle,
          team: teams.get(id) ?? 0,
        }));
      for (const impact of freshImpacts(
        { sessionId: selfId, team: selfTeam, ...selfPose },
        others,
        this.impacts,
        mode,
      )) {
        this.showImpact(impact.x, impact.y);
      }
    }

    // The same render pose the spark pass above tested against — predicted and blended for the local
    // car — so the marker sits on the car that is on screen instead of trailing it by a tick.
    if (arrow && selfPose) this.drawCountdownArrow(arrow, room, selfPose);

    // The bracket follows the CAMERA's subject -- the local car while driving, the watched car while
    // spectating -- which is the same rule the weapon slot bar already uses. Read straight off the
    // wire and never computed here: combat is server-only, and a mispredicted bracket is a lie about
    // where your shot is going. `SHOW_LOCK_BRACKET` is the source switch that suppresses the draw;
    // it is read here rather than folded into `lockBracketArms` so that hiding the bracket skips the
    // stroke entirely instead of stroking an empty list.
    const subject = room.state.players.get(this.cameraTarget(room));
    const target = subject?.lockTargetSessionId ?? "";
    const at = target === "" ? undefined : poses.get(target);
    if (SHOW_LOCK_BRACKET && lock && at) {
      lock.lineStyle(LOCK_WIDTH, LOCK_COLOR, 0.9);
      for (const arm of lockBracketArms(at.x, at.y)) {
        lock.beginPath();
        lock.moveTo(arm.x1, arm.y1);
        lock.lineTo(arm.x2, arm.y2);
        lock.strokePath();
      }
    }

    for (const [sessionId, gfx] of this.cars) {
      if (seen.has(sessionId)) continue;
      gfx.destroy();
      this.cars.delete(sessionId);
      this.visualKeys.delete(sessionId);
      this.interps.delete(sessionId);
    }
  }

  /**
   * One snapshot per state patch, taken on patch arrival rather than per frame. Pushing every frame
   * would fill the window with copies of the same unchanged pose, and the buffer would then
   * "interpolate" between identical entries and jump a whole patch in one frame — a delayed snap
   * wearing interpolation's clothes.
   */
  private pushRemoteSnapshots(room: Room<ArenaState>): void {
    // Arrival time, not `this.time.now`. Phaser's clock only advances once per frame in `preUpdate`,
    // while this fires from the websocket callback *between* frames, so two patches landing in the
    // same frame would share a timestamp and the earlier pose would be silently shadowed. Phaser's
    // own clock is driven from `performance.now()`, so `sample` reads the same epoch.
    const now = performance.now();
    room.state.players.forEach((player, sessionId) => {
      if (sessionId === room.sessionId) return;
      if (player.status !== PlayerStatus.IN_MATCH) return;
      let buf = this.interps.get(sessionId);
      if (!buf) {
        buf = new InterpolationBuffer();
        this.interps.set(sessionId, buf);
      }
      buf.push(now, bodyOf(player));
    });
  }

  /**
   * The local car between ticks. Prediction steps on the sim clock, frames come faster, so the
   * drawn pose is the previous tick blended toward the newest by how far the input accumulator has
   * got through the current tick. Render-only: `predicted` itself is what the next step reads.
   */
  private localRenderPose(serverPose: SimBody): SimBody {
    if (!this.predicted) return serverPose;
    if (!this.predictedPrev) return this.predicted;
    return blendPose(this.predictedPrev, this.predicted, this.inputAccumulatorMs / MS_PER_TICK);
  }

  private remotePose(sessionId: string, pose: SimBody): SimBody {
    return this.interps.get(sessionId)?.sample(this.time.now) ?? pose;
  }

  private syncCar(sessionId: string, player: ArenaPlayer, pose: SimBody): void {
    const key = visualKeyOf(player);
    let gfx = this.cars.get(sessionId);
    if (!gfx || this.visualKeys.get(sessionId) !== key) {
      gfx?.destroy();
      gfx = this.drawCar(player.carId, player.colorId, player.alive);
      // The one world object born after `splitCameras` ran, so it opts out of the HUD camera here or
      // it would be drawn a second time, unclipped, over the gutter. Ignoring the container covers
      // the sprite and hitbox inside it.
      this.hudCamera?.ignore(gfx);
      this.cars.set(sessionId, gfx);
      this.visualKeys.set(sessionId, key);
    }
    gfx.setPosition(pose.x, pose.y);
    gfx.setRotation(pose.angle);
  }

  /**
   * Impact feedback: a brief shake and a spark at the contact point. Render-only — this reacts to
   * locally observed contact, not to an authoritative ram, so it must never change anything the sim
   * or the schema can see.
   */
  private showImpact(x: number, y: number): void {
    this.cameras.main.shake(120, 0.006);
    const spark = this.add.circle(x, y, 10, 0xffffff, 0.9);
    this.hudCamera?.ignore(spark);
    this.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 2.2,
      duration: 180,
      onComplete: () => spark.destroy(),
    });
  }

  /**
   * The car's visual in its own local frame, centred on the origin with +x forward, so the whole
   * thing follows `angle` with a single `setRotation` on the container.
   *
   * A manifest sprite is drawn when one exists and its texture actually loaded; otherwise this falls
   * through to the silhouette the game has always drawn. The fallback is permanent, not legacy: it
   * is what lets art be added one file at a time and what keeps a missing or malformed entry from
   * costing the game its render.
   */
  private drawCar(carId: string, colorId: number, alive: boolean): Phaser.GameObjects.Container {
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const fill = carFillOf(colorId);
    const container = this.add.container(0, 0);

    const body = this.spriteFor(carId, fill) ?? this.silhouette(carId, fill, w, h);
    container.add(body);

    // The hitbox is the OBB the sim actually collides with, which is not the drawn silhouette for
    // bullseye or bastion. Only shown behind `?debug=1` so ordinary play sees the shape, not the box.
    if (this.debug) {
      const box = this.add.graphics();
      box.lineStyle(HITBOX_PX, HITBOX_STROKE, 1);
      box.strokeRect(-w / 2, -h / 2, w, h);
      container.add(box);
    }
    // A wreck keeps its silhouette and its collision box — it is still solid to everyone — and just
    // fades out, so the field still reads as "someone died here" rather than "someone left".
    // Alpha is set per frame by the render loop (`deathFadeAlpha`), never baked in here: a car
    // built while already dead must pick up the right point in its fade, not a fixed value.
    //
    // Depth is set here rather than left to Phaser's default, because weapon instances now draw
    // below the cars and "0" is the layer they are below — see `CAR_DEPTH`.
    container.setDepth(CAR_DEPTH);
    return container;
  }

  /**
   * The manifest sprite for a chassis, or `undefined` when there is no entry or the texture never
   * loaded — both of which fall through to `silhouette`. The decision itself is `resolveCarSprite`,
   * shared with the `?dev=assets` tuning tool so the tool cannot drift from what the arena draws.
   */
  private spriteFor(carId: string, fill: number): Phaser.GameObjects.Image | undefined {
    const resolved = resolveCarSprite(assetManifest(), phaserTextures(this.textures), carId, {
      width: DRIVE_CONFIG.carWidth,
      height: DRIVE_CONFIG.carHeight,
    });
    if (!resolved) return undefined;
    return applyCarSprite(this.add.image(0, 0, resolved.key), resolved, fill);
  }

  /** The procedural chassis. Unchanged from what the game drew before any art existed. */
  private silhouette(
    carId: string,
    fill: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.add.graphics();
    gfx.fillStyle(fill, 1);
    switch (carShapeOf(carId)) {
      case "rect":
        gfx.fillRect(-w / 2, -h / 2, w, h);
        break;
      case "ellipse":
        gfx.fillEllipse(0, 0, w, h);
        break;
      case "hex":
        gfx.fillPoints(hexagonPoints(w, h), true);
        break;
    }
    return gfx;
  }

  /**
   * The arrow over your own car during the countdown, and only then.
   *
   * Two conditions, not one (D14): the phase, and a local player who is actually `IN_MATCH`.
   * Someone who joined mid-countdown watches the same phase from the same room but has no car on the
   * field for the arrow to point at, so the phase alone would hang a triangle over somebody else's.
   *
   * The shape itself is `countdown-arrow.ts`; this only fills it. The bob is read from
   * `performance.now()` rather than driven by a tween, so it is frame-rate independent and there is
   * nothing to cancel when the phase flips — the next frame simply does not reach this line and the
   * arrow is gone, with no fade (D4).
   */
  private drawCountdownArrow(
    gfx: Phaser.GameObjects.Graphics,
    room: Room<ArenaState>,
    pose: SimBody,
  ): void {
    if (room.state.phase !== RoomPhase.COUNTDOWN) return;
    const local = room.state.players.get(room.sessionId);
    if (!local || local.status !== PlayerStatus.IN_MATCH) return;

    gfx.fillStyle(ARROW_COLOR, ARROW_ALPHA);
    gfx.fillPoints(countdownArrowPoints(pose.x, pose.y, arrowBobOffset(performance.now())), true);
  }

  /**
   * The hp bar of one car: laid across its tail, perpendicular to its facing direction, turning
   * with it (`hpBarPoints`). Sized from the car's own maximum, so a full bar means full hp for that
   * chassis rather than a fixed number of points.
   *
   * Both quads are filled every frame — the backing plate at full length, the remaining hp over it
   * — so an empty bar still shows where the hp used to be instead of vanishing.
   *
   * Length is the whole of the health channel; colour says allegiance and nothing else (D1). The
   * allegiance arrives as an argument rather than being worked out here, because it is one answer
   * per frame about the local player and not one answer per bar — see `renderCars`.
   */
  private drawHpBar(
    gfx: Phaser.GameObjects.Graphics,
    player: ArenaPlayer,
    pose: SimBody,
    allegiance: Allegiance,
  ): void {
    const fraction = hpFraction(player.hp, player.carId);

    gfx.fillStyle(HP_BAR_BACK, 0.85);
    gfx.fillPoints(hpBarPoints(pose, 1, HP_BAR_GEOMETRY), true);
    if (fraction <= 0) return;
    gfx.fillStyle(hpBarColor(allegiance), 1);
    gfx.fillPoints(hpBarPoints(pose, fraction, HP_BAR_GEOMETRY), true);
  }

  /**
   * Every live weapon instance, drawn from `state.weapons` and nothing else.
   *
   * The client deliberately does not spawn a local instance on the keypress. A predicted shot that
   * the server never fired — because the cooldown had not actually expired, or the input arrived a
   * tick late — is a phantom that either vanishes or, worse, reads as a hit that never happened.
   * Shots are cheap to draw late and expensive to draw wrongly.
   *
   * Each instance draws as its own hitbox (D19, `instanceDrawShape`) in its WEAPON's colour, so
   * what a player sees is exactly what can hurt them and every fireball shot in the arena looks
   * alike. Shots were owner-coloured once; they are not, because a shot's colour is asked "what is
   * this" far more often than "whose is it", and the car that fired is on screen in player paint
   * either way. A beam holds full opacity for its whole growth and linger and then snaps off across
   * a fixed `BEAM_FADE_OUT_MS` window ending at its death tick (`beamFadeAlpha`), so the drawn zone
   * stops looking safe while it is still dealing damage.
   *
   * A weapon may also carry a LOOK (`instanceGlowBands`): concentric bands filled inside that same
   * hitbox instead of one flat disc. It cannot widen the shot — bands are fractions of the hitbox
   * radius and the flicker only shrinks — so the sentence above survives it. No entry means the
   * flat disc, which is every weapon but `fireball`.
   */
  private renderShots(room: Room<ArenaState>): void {
    const gfx = this.shotGfx;
    if (!gfx) return;
    gfx.clear();

    const nowMs = performance.now();
    const elapsedMs = this.lastPatchMs === 0 ? 0 : nowMs - this.lastPatchMs;
    room.state.weapons.forEach((instance) => {
      if (!instance.alive) return;
      const shape = instanceDrawShape(instance, elapsedMs);
      const alpha = beamFadeAlpha(
        instance.kind,
        instance.weaponId,
        instance.spawnTick,
        room.state.tick,
      );
      // An aura reaches its own `WorldShape` as a circle, like a round projectile does, so it has to
      // be split off BEFORE the circle branch below — otherwise it would draw as a filled 150-unit
      // disc and hide every car it is about to hit. Ring plus wash: still exactly the hitbox.
      if (shape.kind === "circle" && isAuraWeapon(instance.weaponId)) {
        const fill = weaponFillOf(instance.weaponId);
        gfx.fillStyle(fill, alpha * AURA_FILL_ALPHA);
        gfx.fillCircle(shape.x, shape.y, shape.radius);
        gfx.lineStyle(AURA_RING_WIDTH, fill, alpha);
        gfx.strokeCircle(shape.x, shape.y, shape.radius);
        return;
      }
      if (shape.kind !== "circle") {
        if (shape.points.length === 0) return;
        // Nested layers, outermost first, each filled over the last -- the beam counterpart to the
        // bands below. An empty list is a beam with no authored look, which falls back to the one
        // flat fill of its own `color` that this method drew for every beam before styles existed.
        const layers = beamDrawLayers(
          instance.weaponId,
          instance.x,
          instance.y,
          instance.angle,
          instance.extent,
          elapsedMs,
        );
        if (layers.length === 0) {
          gfx.fillStyle(weaponFillOf(instance.weaponId), alpha);
          gfx.fillPoints(shape.points, true);
          return;
        }
        for (const layer of layers) {
          gfx.fillStyle(layer.fill, alpha);
          gfx.fillPoints(layer.points, true);
        }
        return;
      }

      // Bands, outermost first, each filled over the last. An empty list is a weapon with no
      // authored look, which is every weapon but `fireball` today -- it falls back to the one
      // flat fill of its own `color` that this method drew for everything before styles existed.
      const bands = instanceGlowBands(instance.weaponId, shape.radius, instance.spawnTick, nowMs);
      if (bands.length === 0) {
        gfx.fillStyle(weaponFillOf(instance.weaponId), alpha);
        gfx.fillCircle(shape.x, shape.y, shape.radius);
        return;
      }
      for (const band of bands) {
        gfx.fillStyle(band.fill, alpha);
        gfx.fillCircle(shape.x, shape.y, band.radius);
      }
    });

    this.renderChargeOrbs(room, gfx);
  }

  /**
   * The orb a wind-up weapon gathers at its muzzle before firing.
   *
   * A second pass over PLAYERS rather than more work inside the instance loop, because a charging
   * weapon has spawned nothing yet — `state.weapons` is empty for it until the wind-up ends, which
   * is exactly the window this draws. Everything it needs is already networked: `pendingUntilTick`,
   * `lastFiredSlot`, and the pose, so the telegraph costs no schema field.
   *
   * Drawn into the same `shotGfx` as everything else, so it adds fills to an existing batch rather
   * than a draw call of its own — see `docs/asset-pipeline.md`'s note on what shot detail costs.
   */
  private renderChargeOrbs(room: Room<ArenaState>, gfx: Phaser.GameObjects.Graphics): void {
    room.state.players.forEach((player) => {
      if (player.status !== PlayerStatus.IN_MATCH || !player.alive) return;
      if (player.lastFiredSlot < 0) return;
      const slot = player.weapons[player.lastFiredSlot];
      if (!slot) return;

      const orbs = chargeOrbBands(slot.weaponId, player.pendingUntilTick, room.state.tick);
      if (orbs.length === 0) return;

      // The muzzle, not the car centre: the orb is the shot gathering where the shot will leave.
      const muzzle = muzzleOf(player);
      for (const orb of orbs) {
        gfx.fillStyle(orb.fill, 1);
        gfx.fillCircle(muzzle.x, muzzle.y, orb.radius);
      }
    });
  }

  // --- weapon slot HUD ---------------------------------------------------------------------

  /**
   * One Text per possible slot for each of the three pieces of text a slot can show, plus one Image
   * for its manifest icon. The image starts on Phaser's built-in placeholder texture and hidden —
   * `drawHudSlot` gives it a real key with `setTexture` only once a slot actually resolves one.
   */
  private buildHudTextPool(): void {
    // One name per seat, built once: the panel shows and hides these rather than allocating a Text
    // when someone joins. Left-centre, hung off the row's `labelX` and centred on its swatch.
    for (let i = 0; i < MAX_PLAYERS; i++) {
      this.rosterNameTexts.push(this.makeHudText(ROSTER_NAME_FONT_PX).setOrigin(0, 0.5));
    }
    // Left-centre, matching the key labels: a badge's text hangs off its box's left inset.
    for (let i = 0; i < STATUS_CONFIG.maxActive; i++) {
      this.hudStatusTexts.push(
        this.makeHudText(STATUS_LABEL_FONT_PX).setOrigin(0, 0.5).setColor(HUD_STATUS_TEXT),
      );
    }
    for (let i = 0; i < WEAPON_SLOT_CONFIG.maxWeaponSlots; i++) {
      // Left-centre origin: the key sits `SLOT_KEY_GAP_PX` to the RIGHT of the slot and centred on
      // it, so `keyX` is the label's left edge and `cy` its middle. A centred origin would pull the
      // label back over the frame, and D18 wants the key outside it.
      //
      // White, and the weapon name copper: both are set ONCE here rather than per frame in
      // `drawHudSlot`. Phaser re-renders a `Text` object's canvas whenever its style is touched, so
      // re-asserting a colour that never changes would repaint every label every frame. Only alpha
      // varies with slot state, and that is a cheap tint rather than a re-render.
      this.hudKeyTexts.push(this.makeHudText(HUD_KEY_FONT_PX).setOrigin(0, 0.5).setColor(HUD_KEY_PILL_TEXT));
      // Top-centre: `nameY` is the top of the name's band under the slot.
      this.hudNameTexts.push(
        this.makeHudText(HUD_NAME_FONT_PX)
          .setOrigin(0.5, 0)
          .setColor(HUD_RING_CSS)
          .setFontStyle(HUD_NAME_FONT_STYLE),
      );
      // Left-centre, matching the key above it: the countdown shares the key's column, so both
      // hang off the same `keyX` edge rather than one being centred and the other not.
      this.hudCountdownTexts.push(this.makeHudText(HUD_COUNTDOWN_FONT_PX).setOrigin(0, 0.5));
      this.hudStockTexts.push(this.makeHudText(HUD_STOCK_FONT_PX));
      this.hudIconImages.push(
        this.add
          .image(0, 0, "__DEFAULT")
          .setScrollFactor(0)
          .setDepth(HUD_ICON_DEPTH)
          .setVisible(false),
      );
    }
  }

  private makeHudText(fontSizePx: number): Phaser.GameObjects.Text {
    return this.add
      .text(0, 0, "", { fontSize: `${fontSizePx}px`, color: HUD_TEXT })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_TEXT_DEPTH)
      .setVisible(false);
  }

  /**
   * The car whose slots the bar shows: your own while playing, the watched car while spectating,
   * or nobody in free roam — the bar is read-only and has nothing to say about a free-floating
   * camera that is not attached to any car.
   */
  private hudTargetPlayer(room: Room<ArenaState>): PlayerState | undefined {
    if (this.isSpectating(room)) {
      if (this.freeRoam || this.spectateTarget === "") return undefined;
      return room.state.players.get(this.spectateTarget);
    }
    return room.state.players.get(room.sessionId);
  }

  /**
   * The roster panel at the top of the gutter: a colour swatch and a name per player in the match,
   * alive or dead. Returns the panel's height, which is the slot bar's `topInset` — see the call in
   * `update()` for why exactly one place derives it.
   *
   * Every rule about who is listed and in what order is in `roster-panel.ts`; this is the Phaser
   * half. An empty roster hides every pooled name, draws nothing, and returns 0, so a pre-reveal or
   * free-roam frame leaves the gutter laid out exactly as it was before the panel existed.
   */
  private renderRosterPanel(room: Room<ArenaState>): number {
    const gfx = this.rosterGfx;
    if (!gfx) return 0;
    gfx.clear();

    const rows = rosterRows([...room.state.players.values()]);
    const panel = rosterPanelLayout(rows.length, VIEW_WIDTH, HUD_GUTTER_WIDTH);

    for (let i = 0; i < this.rosterNameTexts.length; i++) {
      const row = rows[i];
      const box = panel.rows[i];
      const label = this.rosterNameTexts[i]!;
      if (!row || !box) {
        label.setVisible(false);
        continue;
      }

      // The swatch carries the player's own car colour — `carFillOf`, the same function that paints
      // the car, so the panel can never disagree with the field about who is who.
      gfx.fillStyle(carFillOf(row.colorId), row.alive ? 1 : ROSTER_DEAD_SWATCH_ALPHA);
      gfx.fillRect(box.x, box.y, box.size, box.size);

      // Guarded rather than asserted every frame: Phaser re-renders a Text object's canvas whenever
      // its style is touched, and a row's aliveness flips once a match, not once a frame. Same
      // reasoning as the slot labels, which set their colour once at pool build time — this one
      // cannot, because it is the colour that carries the state.
      const color = row.alive ? ROSTER_LIVE_TEXT : ROSTER_DEAD_TEXT;
      if (label.style.color !== color) label.setColor(color);
      label
        .setPosition(box.labelX, box.centerY)
        .setText(truncateName(row.name, panel.nameMaxChars))
        .setVisible(true);
    }

    return panel.height;
  }

  /**
   * The slot bar: camera-fixed, drawing `min(weapons.length, maxWeaponSlots)` boxes for whichever
   * car `hudTargetPlayer` names. Slots beyond the current target (or with no target at all) just
   * hide their pooled text objects rather than destroying anything, so switching who is watched
   * costs no allocation.
   *
   * `topInset` is the roster panel's height, passed in rather than derived here: the panel lists
   * every player in the match while this lays out for one car, so the two count different things
   * and only the caller can hold the single answer (D12).
   */
  private renderWeaponHud(room: Room<ArenaState>, topInset: number): void {
    const gfx = this.hudGfx;
    const sweepGfx = this.hudSweepGfx;
    if (!gfx || !sweepGfx) return;
    gfx.clear();
    sweepGfx.clear();

    const player = this.hudTargetPlayer(room);
    const boxes = player
      ? slotBarLayout(player.weapons.length, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, topInset)
      : [];

    for (let i = 0; i < this.hudKeyTexts.length; i++) {
      const box = boxes[i];
      const slot = player && box ? player.weapons.at(i) : undefined;
      if (!player || !box || !slot) {
        this.hudKeyTexts[i]!.setVisible(false);
        this.hudNameTexts[i]!.setVisible(false);
        this.hudCountdownTexts[i]!.setVisible(false);
        this.hudStockTexts[i]!.setVisible(false);
        this.hudIconImages[i]!.setVisible(false);
        continue;
      }
      this.drawHudSlot(gfx, sweepGfx, i, box, slot, player, room.state.tick);
    }

    // Same `gfx`, same clear, same target car: the badges belong to the slot bar's column and share
    // its lifetime, so they are drawn here rather than from their own pass with their own Graphics.
    this.drawStatusStrip(gfx, player, boxes[0]?.y ?? VIEW_HEIGHT / 2, room.state.tick);
  }

  /**
   * The status badges above the slot bar, for whichever car `hudTargetPlayer` named.
   *
   * Every rule about what is shown and in what order is in `status-hud.ts`; this is the Phaser half
   * and nothing else. A car in no status draws no badges and hides every pooled label — the common
   * case, and it costs one empty array.
   */
  private drawStatusStrip(
    gfx: Phaser.GameObjects.Graphics,
    player: PlayerState | undefined,
    slotBarTop: number,
    tick: number,
  ): void {
    const badges = player ? statusBadges(player.statuses, tick) : [];
    const boxes = statusStripLayout(
      badges.length,
      VIEW_WIDTH,
      VIEW_HEIGHT,
      HUD_GUTTER_WIDTH,
      slotBarTop,
    );

    for (let i = 0; i < this.hudStatusTexts.length; i++) {
      const badge = badges[i];
      const box = boxes[i];
      const label = this.hudStatusTexts[i]!;
      if (!badge || !box) {
        label.setVisible(false);
        continue;
      }

      // The pill: a wash of the effect's own colour, so a debuff is told apart from a buff by
      // colour before the label is read at all.
      gfx.fillStyle(badge.fill, HUD_STATUS_WASH_ALPHA);
      gfx.fillRect(box.x, box.y, box.width, box.height);
      // The drain bar down the left edge, at full alpha and shrinking from the bottom. Height, not
      // width: a strip of vertical bars all draining at once is legible at a glance in a way a row
      // of shrinking pills is not, and it leaves the label's own width alone.
      const barHeight = box.height * badge.fraction;
      gfx.fillStyle(badge.fill, 1);
      gfx.fillRect(
        box.x,
        box.y + box.height - barHeight,
        STATUS_BAR_WIDTH_PX,
        barHeight,
      );

      label
        .setPosition(
          box.x + STATUS_BAR_WIDTH_PX + HUD_STATUS_LABEL_PAD_X,
          box.y + STATUS_BADGE_HEIGHT_PX / 2,
        )
        .setText(`${badge.name}  ${badge.secondsLeft}s`)
        .setVisible(true);
    }
  }

  /**
   * One slot's box, glyph, sweep and labels.
   *
   * Both halves of D18's car-wide lockout come off the wire. `FireState`'s `pending` machine itself
   * stays server-only — the same rule that keeps `damageClock`/`pierceLeft` off it — but the two
   * facts the HUD cannot derive from slot rows do not: `PlayerState.pendingUntilTick` (the tick a
   * committed press next fires, so `tick < pendingUntilTick` is "mid wind-up or mid volley", and
   * stays right between two patches at 20 Hz) and `PlayerState.lastFiredSlot` (which slot owns the
   * recovery every OTHER slot is dimmed by).
   *
   * Every one of these paths is now exercised by a carried weapon: `skewer` and `lance` (Bullseye's
   * slots 2 and 3) carry `startUpMs > 0`, `pepperbox` (Mirage's slot 2) carries
   * `volley.volleys: 3`, and `recoveryMs > 0` is the common case — every weapon but `fireball`,
   * `needler` and `thumper` carries one. That also covers the mid-volley case: `beginFire` zeroes a
   * slot's `stocks` at press time and does not set `rechargeEndsTick` until the volley's LAST shot,
   * and `slotVisualState` answers "car-locked"
   * for that whole window because a real `pending` reaches it — rather than falling through to
   * full-brightness "ready" with nothing left to fire.
   */
  private drawHudSlot(
    gfx: Phaser.GameObjects.Graphics,
    sweepGfx: Phaser.GameObjects.Graphics,
    index: number,
    box: SlotBox,
    slot: WeaponSlotState,
    player: PlayerState,
    tick: number,
  ): void {
    const def = isWeaponId(slot.weaponId) ? weaponDefOf(slot.weaponId) : undefined;
    const state = slotVisualState(
      { stocks: slot.stocks, rechargeEndsTick: slot.rechargeEndsTick },
      { unlocksAt: def?.unlocksAt ?? 1 },
      player.level,
      player.switchLockUntilTick,
      tick < player.pendingUntilTick ? { slot: player.lastFiredSlot } : null,
      tick,
      index === player.lastFiredSlot,
    );
    const dim = this.hudDimFor(state);
    const cx = box.x + box.size / 2;
    const cy = box.y + box.size / 2;

    // Ready-but-recharging happens only for a `stock` weapon banking another charge while one is
    // still in hand: `slotVisualState` correctly keeps the icon at full brightness (you can still
    // fire), but the timer running underneath is exactly the "in-progress recharge" D18 asks a
    // stock weapon's sweep to show. `locked` and `car-locked` never show it — the heavier/static
    // locked dim and the car-wide lockout must each stay visually unambiguous.
    //
    // Resolved before anything is drawn, because the ring IS the cooldown now: a draining slot's
    // ring is a dim track waiting for its arc, not the solid frame every other state wears.
    const recharging = slot.rechargeEndsTick !== 0 && (state === "recharging" || state === "ready");
    const fraction =
      recharging && def
        ? sweepFraction(slot.rechargeEndsTick, weaponTicksOf(def.id).cooldown, tick)
        : 0;

    this.drawSlotRing(gfx, cx, cy, box.size, dim, fraction > 0);

    // A slot with a manifest icon draws the sprite; a slot without one keeps the procedural glyph.
    // That fallback is permanent, not a placeholder for art that has not shipped yet — a missing or
    // unloaded icon PNG must never be a bug, only a slot that still looks like it always has.
    const icon = def
      ? resolveWeaponIcon(
          assetManifest(),
          phaserTextures(this.textures),
          def.id,
          box.size * HUD_ICON_FIT_SCALE,
        )
      : undefined;
    if (icon) {
      this.applyWeaponIcon(this.hudIconImages[index]!, icon, cx, cy, dim);
    } else {
      this.hudIconImages[index]!.setVisible(false);
      this.drawWeaponGlyph(gfx, def, cx, cy, box.size, dim);
    }

    // Own Graphics object at `HUD_SWEEP_DEPTH`, deliberately not `gfx` (the ring/glyph layer at
    // `HUD_BOX_DEPTH`): the arc must render above the icon pool (`HUD_ICON_DEPTH`) sitting between
    // them, or a resolved icon overlapping the ring would cut it. See the depth block's comment
    // near `HUD_BOX_DEPTH` for the full layering rationale.
    if (fraction > 0) this.drawSweepArc(sweepGfx, cx, cy, box.size, fraction, dim);

    const countdownText = this.hudCountdownTexts[index]!;
    const seconds = recharging ? countdownSeconds(slot.rechargeEndsTick, tick) : null;
    if (seconds !== null) {
      countdownText
        .setText(String(Math.ceil(seconds)))
        .setPosition(box.keyX, cy + HUD_COUNTDOWN_KEY_OFFSET_PX)
        .setVisible(true);
    } else {
      countdownText.setVisible(false);
    }

    // Beside the slot, outside the frame — never over the icon — and dimmed with it, so a locked
    // slot's key reads as unavailable too. The band under the slot belongs to the name now.
    const keyText = this.hudKeyTexts[index]!;
    keyText
      .setText(SLOT_KEYS[index]?.glyph ?? "")
      .setPosition(box.keyX + HUD_KEY_PILL_PAD_X, cy)
      .setAlpha(dim)
      .setVisible(true);
    // The pill behind it, sized from the label's MEASURED width — `SLOT_KEY_COLUMN_PX` is only the
    // layout's reservation, and a pill drawn to that budget would be too wide for every key but
    // "space". Drawn into `gfx` (the ring layer) so it lands under `HUD_TEXT_DEPTH`, never over the
    // glyph it borders, and dimmed with the slot like the label it wraps.
    const pillHeight = keyText.height + HUD_KEY_PILL_PAD_Y * 2;
    gfx.fillStyle(HUD_RING_COLOR, dim);
    gfx.fillRoundedRect(
      box.keyX,
      cy - pillHeight / 2,
      keyText.width + HUD_KEY_PILL_PAD_X * 2,
      pillHeight,
      pillHeight / 2,
    );

    // Centred under the slot. A slot whose weapon id is unknown has no name to print, which is the
    // same fall-through `def` already drives for the icon and the sweep.
    const nameText = this.hudNameTexts[index]!;
    if (def) {
      nameText.setText(def.name).setPosition(cx, box.nameY).setAlpha(dim).setVisible(true);
    } else {
      nameText.setVisible(false);
    }

    const stockText = this.hudStockTexts[index]!;
    if (def?.stock) {
      // Pulled in along the diagonal to sit inside the circle: the old bottom-right corner of the
      // bounding box is outside a round slot entirely.
      const inset = (box.size / 2) * HUD_STOCK_RADIUS_SCALE;
      stockText
        .setText(String(slot.stocks))
        .setPosition(cx + inset, cy + inset)
        .setVisible(true);
    } else {
      stockText.setVisible(false);
    }
  }

  /** `SlotVisual` to `HUD_DIM`; only the "car-locked" name differs from its dim key. */
  private hudDimFor(state: SlotVisual): number {
    return state === "car-locked" ? HUD_DIM.carLocked : HUD_DIM[state];
  }

  /**
   * Apply a resolved icon to its slot's pooled Image. Position, not just fit, because unlike a car
   * sprite (positioned by its container) this Image has no other parent to place it — `cx`/`cy` are
   * the box's own centre in camera-fixed HUD space.
   *
   * `clearTint` guards a rule, not a bug: weapon icons keep their colour and are never player-tinted
   * (`colorMode: "none"`, written by `scripts/import-weapon-icon.mjs`) — the car importer desaturates
   * *because* cars are tinted, and doing the same to an icon would leave every weapon a grey blob.
   * Dimming for `locked`/`recharging`/`car-locked` therefore rides on alpha alone, the same channel
   * the procedural glyph dims through.
   */
  private applyWeaponIcon(
    image: Phaser.GameObjects.Image,
    resolved: ResolvedWeaponIcon,
    cx: number,
    cy: number,
    dim: number,
  ): void {
    image
      .setTexture(resolved.key)
      .setPosition(cx, cy)
      .setOrigin(resolved.fit.originX, resolved.fit.originY)
      .setScale(resolved.fit.scale)
      .setRotation(resolved.fit.rotation)
      .setAlpha(dim)
      .clearTint()
      .setVisible(true);
  }

  /**
   * The procedural glyph: a filled circle for a projectile, a bar for a beam. Draw-only shorthand
   * for "what kind of weapon is this", not the weapon's actual hitbox (that is `instanceDrawShape`,
   * drawn for live instances only). Drawn only when `drawHudSlot` found no manifest icon for this
   * slot's weapon — see `resolveWeaponIcon` in `weapon-hud.ts` for that fallback contract.
   */
  private drawWeaponGlyph(
    gfx: Phaser.GameObjects.Graphics,
    def: { kind: string } | undefined,
    cx: number,
    cy: number,
    boxSize: number,
    dim: number,
  ): void {
    const radius = (boxSize / 2) * HUD_GLYPH_SCALE;
    if (def?.kind === "beam") {
      const width = radius * 2 * HUD_BEAM_WIDTH_SCALE;
      gfx.fillStyle(HUD_GLYPH_COLOR, dim);
      gfx.fillRect(cx - width / 2, cy - radius, width, radius * 2);
      gfx.lineStyle(HUD_GLYPH_OUTLINE_PX, HUD_GLYPH_OUTLINE_COLOR, dim);
      gfx.strokeRect(cx - width / 2, cy - radius, width, radius * 2);
      return;
    }
    const flame = this.flamePoints(cx, cy, radius);
    gfx.fillStyle(HUD_GLYPH_COLOR, dim);
    gfx.fillPoints(flame, true);
    gfx.lineStyle(HUD_GLYPH_OUTLINE_PX, HUD_GLYPH_OUTLINE_COLOR, dim);
    gfx.strokePoints(flame, true);
    // The core is the same outline nested and nudged down, so the flame's tip stays one tone. No
    // stroke on it: a second dark edge this small closes up into a blob at 64px. This overwrites
    // `flame` — see `flameScratch` — which is safe only because both calls above have returned.
    const core = this.flamePoints(
      cx,
      cy + radius * HUD_GLYPH_CORE_OFFSET_SCALE,
      radius * HUD_GLYPH_CORE_SCALE,
    );
    gfx.fillStyle(HUD_GLYPH_CORE_COLOR, dim);
    gfx.fillPoints(core, true);
  }

  /**
   * `FLAME_UNIT_POINTS` placed at `cx`/`cy` and scaled to radius `r`, ready to fill or stroke as a
   * closed polygon. Returns the shared `flameScratch` rather than a fresh array — read the result
   * before calling again.
   */
  private flamePoints(cx: number, cy: number, r: number): Phaser.Geom.Point[] {
    for (let i = 0; i < FLAME_UNIT_POINTS.length; i++) {
      const unit = FLAME_UNIT_POINTS[i]!;
      flameScratch[i]!.setTo(cx + unit.x * r, cy + unit.y * r);
    }
    return flameScratch;
  }

  /**
   * The slot's wash and its ring.
   *
   * While a cooldown runs the ring is drawn here as a dim TRACK and the bright remaining arc goes
   * on top in `drawSweepArc` — same centre, same radius, same width, so the two read as one stroke
   * partly spent rather than two concentric rings.
   *
   * The wash always dims with the slot. The ring only dims when it is not a cooldown track:
   * `HUD_SWEEP_HOLDS_FULL` is what keeps a recharging slot's timer readable at `HUD_DIM.recharging`.
   */
  private drawSlotRing(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    boxSize: number,
    dim: number,
    draining: boolean,
  ): void {
    const radius = this.slotRingRadius(boxSize);
    if (HUD_RING_WASH_ALPHA > 0) {
      gfx.fillStyle(HUD_RING_COLOR, HUD_RING_WASH_ALPHA * dim);
      gfx.fillCircle(cx, cy, radius);
    }
    const ringDim = draining && HUD_SWEEP_HOLDS_FULL ? 1 : dim;
    gfx.lineStyle(HUD_RING_WIDTH_PX, HUD_RING_COLOR, draining ? HUD_RING_TRACK_ALPHA * ringDim : ringDim);
    gfx.strokeCircle(cx, cy, radius);
  }

  /**
   * The cooldown, as the ring itself draining: a full circle at `fraction` 1 (recharge just
   * started), shrinking clockwise from 12 o'clock to nothing as `fraction` reaches 0, so it reads
   * the same way a MOBA ability cooldown does. This replaced a dark wedge over the icon, which had
   * nothing to darken once the slot's black fill became a transparent ring.
   */
  private drawSweepArc(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    boxSize: number,
    fraction: number,
    dim: number,
  ): void {
    const endAngle = HUD_SWEEP_START_ANGLE + fraction * Phaser.Math.PI2;
    gfx.lineStyle(HUD_RING_WIDTH_PX, HUD_RING_COLOR, HUD_SWEEP_HOLDS_FULL ? 1 : dim);
    gfx.beginPath();
    gfx.arc(cx, cy, this.slotRingRadius(boxSize), HUD_SWEEP_START_ANGLE, endAngle, false);
    gfx.strokePath();
  }

  /**
   * The ring's centreline radius. Inset by half the stroke so the ring's OUTER edge lands on the
   * box `slotBarLayout` reserved — a stroke straddles its path, and without this a 3px ring would
   * spill 1.5px past the layout on every side.
   */
  private slotRingRadius(boxSize: number): number {
    return boxSize / 2 - HUD_RING_WIDTH_PX / 2;
  }

  // --- spectating --------------------------------------------------------------------------

  /** Are you watching rather than playing? The rule itself lives in `spectate.ts`. */
  private isSpectating(room: Room<ArenaState>): boolean {
    const local = room.state.players.get(room.sessionId);
    if (!local) return false;
    return isSpectating(room.state.phase, local.status, local.alive);
  }

  /**
   * Whose car the camera follows: your own until you are wrecked, then the spectate target.
   * Returning a session id rather than a pose keeps the decision in one place — `renderCars`
   * already has every pose in hand, including the predicted one for the local car.
   */
  private cameraTarget(room: Room<ArenaState>): string {
    return this.isSpectating(room) ? this.spectateTarget : room.sessionId;
  }

  /**
   * Spectator controls, once you are a wreck: cycle who you are watching, or pan freely.
   *
   * Nothing here sends anything. A dead player is a viewer, and giving the camera its own local
   * state is what keeps that true — the server has no notion of who anyone is watching.
   */
  private updateSpectate(room: Room<ArenaState>, delta: number): void {
    if (!this.isSpectating(room)) {
      // Still alive, or not in a live match. Clearing the state means the next death starts a fresh
      // cycle rather than resuming one from a previous match.
      this.spectateTarget = "";
      this.freeRoam = false;
      return;
    }

    const keys = this.keys;
    const ids = spectatableIds(this.spectateCandidates(room));
    this.spectateTarget = resolveSpectateTarget(ids, this.spectateTarget);
    if (!keys) return;

    // Free roam pans a camera that cannot scroll when the whole arena already fits, so the key is
    // inert there rather than toggling a mode with no visible effect.
    if (!this.staticCamera && Phaser.Input.Keyboard.JustDown(keys.freeRoam)) {
      this.freeRoam = !this.freeRoam;
      // Free roam starts wherever the camera already is, so toggling it does not teleport the view.
      if (!this.freeRoam) this.camFocus = undefined;
    }

    const back = Phaser.Input.Keyboard.JustDown(keys.prev);
    const forward = Phaser.Input.Keyboard.JustDown(keys.next);
    // Arrows cycle only while following. In free roam they pan, so the bracket keys carry cycling.
    const arrowBack = !this.freeRoam && this.justDown(this.cursors?.left);
    const arrowForward = !this.freeRoam && this.justDown(this.cursors?.right);

    if (back || arrowBack) this.spectateTarget = cycleSpectate(ids, this.spectateTarget, -1);
    else if (forward || arrowForward) this.spectateTarget = cycleSpectate(ids, this.spectateTarget, 1);

    if (this.freeRoam) this.panCamera(keys, delta);
  }

  /** WASD or the arrows, panning the free-look camera. */
  private panCamera(keys: SpectateKeys, delta: number): void {
    const axisX = axisOf(
      keys.panLeft.isDown || (this.cursors?.left.isDown ?? false),
      keys.panRight.isDown || (this.cursors?.right.isDown ?? false),
    );
    const axisY = axisOf(
      keys.panUp.isDown || (this.cursors?.up.isDown ?? false),
      keys.panDown.isDown || (this.cursors?.down.isDown ?? false),
    );

    const from = this.camFocus ?? { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y };
    this.camFocus = panFreeCam(from, axisX, axisY, delta, CAMERA_CONFIG.freeRoamSpeed);
    this.cameras.main.centerOn(this.camFocus.x, this.camFocus.y);
  }

  private spectateCandidates(room: Room<ArenaState>): SpectateCandidate[] {
    const candidates: SpectateCandidate[] = [];
    room.state.players.forEach((player, sessionId) => {
      candidates.push({ sessionId, status: player.status, alive: player.alive });
    });
    return candidates;
  }

  private justDown(key: Phaser.Input.Keyboard.Key | undefined): boolean {
    return key ? Phaser.Input.Keyboard.JustDown(key) : false;
  }

  /**
   * Soft follow. `centerOn` each frame with the focus eased by `CAMERA_CONFIG.camLerp` keeps a
   * reconciliation snap from throwing the whole view; the first frame seeds the focus outright so
   * the match does not open with the camera flying in from the arena origin.
   *
   * `smoothFollow` rather than `Phaser.Math.Linear` so the easing is per elapsed millisecond rather
   * than per frame — see its docstring for why a flat per-frame fraction frames the same car
   * differently on a 60 Hz and a 144 Hz display.
   */
  private followCamera(pose: SimBody, delta: number): void {
    if (this.staticCamera) return;
    if (!this.camFocus) {
      this.camFocus = { x: pose.x, y: pose.y };
    } else {
      this.camFocus = smoothFollow(this.camFocus, pose, CAMERA_CONFIG.camLerp, delta);
    }
    this.cameras.main.centerOn(this.camFocus.x, this.camFocus.y);
  }

  private syncMatchHud(): void {
    const room = this.room;
    if (!room) return;

    const counting = room.state.phase === RoomPhase.COUNTDOWN;
    if (this.countdownText) {
      if (counting) {
        const seconds = Math.max(
          0,
          Math.ceil((room.state.countdownEndsTick - room.state.tick) / TICK_RATE_HZ),
        );
        this.countdownText.setText(String(seconds)).setVisible(true);
      } else {
        this.countdownText.setVisible(false);
      }
    }

    this.syncSpectateHud(room);
  }

  /**
   * The spectator banner. Shown only to a wreck during a live match — while you are driving there
   * is nothing to say, and once the match ends the results view takes over.
   */
  private syncSpectateHud(room: Room<ArenaState>): void {
    const text = this.spectateText;
    if (!text) return;

    if (!this.isSpectating(room)) {
      text.setVisible(false);
      return;
    }

    if (this.freeRoam) {
      text.setText("Free roam — WASD/arrows to pan, V to follow, [ ] to switch car");
    } else {
      const name = room.state.players.get(this.spectateTarget)?.name ?? "";
      text.setText(
        name === ""
          ? "Wrecked — no one left to watch"
          : `Spectating ${name} — [ ] or Left/Right to switch, V for free roam`,
      );
    }
    text.setVisible(true);
  }
}
