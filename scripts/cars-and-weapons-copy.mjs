/**
 * The editorial half of the manual: everything a player needs that is NOT in
 * `WEAPON_TABLE`. Numbers never live here — `build-cars-and-weapons.mjs` reads every stat from
 * built shared, so a balance edit reprints the manual correctly without touching this file.
 *
 * Prose is sourced from `docs/superpowers/specs/2026-08-29-weapon-roster-design.md` and rewritten
 * for players rather than for reviewers.
 */

export const MANUAL_META = {
  title: "Motor Combat",
  // Not "Weapon Dossier" any more: the book covers the three chassis as well, and each chassis
  // page introduces the kit that follows it.
  subtitle: "Cars & Weapons",
  blurb:
    "Nine weapons. Three chassis. No sharing. Pick a car and you have picked all three of your " +
    "guns — this is what each one of them does, and what it is for.",
};

export const CHASSIS_COPY = {
  mirage: {
    codename: "The Runner",
    theme: "Your driving is your aim.",
    body:
      // NOT "hits hardest per press": Bastion's Bulwark (the old titleholder) is retired, and
      // Afterburner — Mirage's OWN weapon — is now the roster's largest full-connect number (286,
      // top of the ranking page) once it lands. The claim stays conditional rather than flat,
      // because that number needs the whole 2.2s burn held on one target; Mirage's damage is real
      // but conditional either way.
      "The fastest thing on the map, and the one that turns a few seconds of contact into most of " +
      "a car's HP — but only for as " +
      "long as it is beside you. Two of its three weapons hug the chassis, so Mirage has to pick a " +
      "moment, arrive, and finish. It has the hull of a car that never planned to stay.",
    beats: "Closes on Bullseye before its wind-ups can resolve.",
    losesTo: "Bastion. Mirage must come close to use its kit, and close is where Bastion lives.",
  },
  bullseye: {
    codename: "The Gunner",
    theme: "Reach and precision, punished hard when caught.",
    body:
      "A glass cannon that wants never to be touched. It carries the longest straight-line reach " +
      "in the game and two mid-range answers underneath it, though only its opener takes the lock " +
      "— the other two ask you to aim yourself. It has the thinnest hull on the grid to pay for it.",
    beats: "Kites Bastion forever; it can never close the speed gap.",
    losesTo: "Mirage, which arrives before you have finished winding up.",
  },
  bastion: {
    // NOT "The Bastion". The codename is printed right after the chassis name — "Bastion — The
    // Bastion" on the chassis page and again under the cover triangle — so it has to be a different
    // word from the name it sits beside. An anvil is the thing you bring the work to rather than
    // the thing that chases it, which is this chassis's whole argument. Checked against the other
    // two: "The Runner" and "The Gunner" collide with neither Mirage nor Bullseye.
    codename: "The Anvil",
    theme: "It cannot chase — so it makes you come to it.",
    body:
      // NOT "the longest crowd control": `fortified` (10000ms, wildcharge's own self-buff) and
      // `spiked` (3000ms, thumper's own rider) both outlast roadblock's 1000ms stun — the only stun
      // left in Bastion's kit, since T18/O16 moved hard CC off thumper onto roadblock. What
      // roadblock alone carries is a full lockout — the only status in the table that takes the car
      // away instead of degrading it — so the claim here is about kind, not duration.
      "The slowest chassis, the biggest hull, and the only hard crowd control in the game. Bastion " +
      "does not catch anybody: it stops them, slams them, and denies the ground they wanted. " +
      "That is the only currency a car that cannot reposition has.",
    beats: "Mirage, the moment it commits to contact range.",
    losesTo: "Bullseye, which simply refuses to come within reach.",
  },
};

export const SLOT_ROLES = [
  { name: "Go-to", line: "Fills every gap. Never gates anything else you carry." },
  { name: "Mid", line: "A real burst, with a real aiming or positioning condition." },
  { name: "Ultimate", line: "A commitment. Used properly, it wins the fight." },
];

// Prose for the 2026-09-01 weapon-status overhaul roster: `fireball`, `needler`, `skewer` and
// `bulwark` are retired outright (their copy history lives in git); `shockwave` is redefined from
// the retired Mirage aura into Bullseye's fast opener; `predator`, `thunderclap`, `roadblock` and
// `wildcharge` are new. `afterburner`, `pepperbox`, `lance` and `thumper` keep their old ids but
// pick up new behaviour (two-cone afterburner, four-muzzle pepperbox, held-and-steered lance, a
// bouncing spiking thumper) and are rewritten below to match.
export const WEAPON_COPY = {
  predator: {
    tagline: "A rocket that remembers who it was fired at.",
    shape: "Homing rocket · locks on",
    what:
      "Fired with a lock, it chases the frozen target for 1.2 seconds at 120 degrees per second — a " +
      "turning circle Mirage and Bullseye can corner inside and Bastion mostly cannot. Fired bare, " +
      "with no lock, it is just a slow straight shot. Either way, a hit leaves the target corroded " +
      "for two seconds.",
    how:
      "600 units a second is the second-slowest aimed shot in the game — reactable at range, which " +
      "is the trade for guidance nobody can outrun in a straight line. Corroded stacks with whatever " +
      "the rest of the kit does next: a target that eats a Predator takes a third more from " +
      "everything that follows it.",
    tip:
      "Lead with it before you commit. The corrode window is short, so whatever finishes the fight " +
      "— Thunderclap, Afterburner, a teammate's shot — needs to land while it is still ticking, not " +
      "after.",
  },
  thunderclap: {
    tagline: "A lunge that ends the fight where it lands.",
    shape: "Dash · hits the first car it touches · locks on",
    what:
      "A 400-unit lunge toward the lock, covering the distance in well under a second. The first " +
      "enemy hull it touches takes the hit and stops dead — stunned for a full second — and the " +
      "dash ends right there, on top of them. A wall ends it just as hard, with nothing to show for " +
      "it.",
    how:
      "Only the first car it touches matters: a dash that clips two cars in the same tick still " +
      "only hits one. That is the whole trade of a maneuver weapon — no instance to dodge, no " +
      "travel time to react to, just whether you are still there when it lands.",
    tip:
      "Use it to close, not to open from range — it is not a ranged threat, it is the last few " +
      "metres. Landing it stuns them right as you arrive, which is exactly when Afterburner wants " +
      "them held still.",
  },
  afterburner: {
    tagline: "The same flame, now pouring from both ends.",
    shape: "Flame cone · welded to your nose and tail · ticks",
    what:
      "Two mirrored cones, one off the nose and one off the tail, burning everything inside either " +
      "of them five times a second for a little over two seconds. It sweeps as you steer, and both " +
      "cones die the instant you do.",
    how:
      "The per-cone numbers are unchanged from a single flame; the ceiling only doubles against a " +
      "target somehow held in both cones at once, which in practice means someone chasing you " +
      "through your own exhaust. Recovery is tiny on purpose — the beam lives on its own once " +
      "spawned, so you stay free to keep firing Predator into a target that is already burning.",
    tip:
      "Press it when you are on somebody's bumper, or when somebody is on yours. No other chassis " +
      "can catch a fleeing car, and now nothing catches Mirage either — the tail cone overheats " +
      "whoever tries.",
  },
  shockwave: {
    tagline: "Bullseye's bread and butter.",
    shape: "Straight bolt · locks on",
    what:
      "A fast, straight bolt and Bullseye's bread and butter. Nothing fancy — it arrives quickly, " +
      "often, and exactly where the assist points it. Not quite twice a second, out to seven " +
      "tenths of the arena, with a 24-unit disc for a hitbox — three quarters of a car's width.",
    how:
      "This is the yardstick every other weapon on this chassis is read against: at that rate, " +
      "sustained fire from close range adds up fast, and the aim assist means you rarely have to " +
      "think about it. It is the reason Bullseye can afford to spend its other two slots on " +
      "weapons that ask more of you.",
    tip:
      "Never stop pressing it. Shockwave has no recovery, so it gates nothing — you can keep it " +
      "running between presses of Pepperbox or while Lance winds up.",
  },
  pepperbox: {
    tagline: "Twelve darts, one press.",
    shape: "Four-way spray · no lock",
    what:
      "One press, twelve darts: a three-dart, 12° fan fires from the nose, the tail, and both " +
      "flanks at once. The panic button that punishes anyone who closes in — or the drive-by that " +
      "clips everyone around you as you pass.",
    how:
      "Per-target reality is one fan: the four muzzles are 90 degrees apart, so at most one lines " +
      "up with any single car, and that fan is still 135 damage if all three darts land. No lock " +
      "steers a spray firing in four directions at once — where your nose points at the press is " +
      "where all four fans go.",
    tip:
      "Fire it when someone is already on top of you, or when you are threading a pass through a " +
      "crowd. It punishes proximity from any direction, which is exactly what a lock-on weapon " +
      "cannot do.",
  },
  lance: {
    tagline: "Stand still, then sweep the line.",
    shape: "Held beam · steer while it fires · no lock",
    what:
      "Seven hundred milliseconds standing still and visible, then a beam that grows to full " +
      "extent almost instantly and lingers a second and a half — all of it steerable, because the " +
      "car is held rather than stopped. The wheel still works; the beam sweeps wherever you turn " +
      "it.",
    how:
      "The old aim-assist argument no longer applies: a lock could once steer a stamped beam, but " +
      "this one sweeps live under your own hands while the car is held, which is a strictly " +
      "stronger form of aim. Windup plus growth plus linger is about 2.4 seconds committed end to " +
      "end, before the second of recovery after — the roster's biggest single-press risk, paid up " +
      "front, during, and after all at once.",
    tip:
      "Fire it at somebody who cannot spend the next two and a half seconds finding cover — " +
      "cornered, mid-commitment, or lined up with a second car so the sweep catches both. A whiff " +
      "on this hull is close to a death sentence.",
  },
  thumper: {
    tagline: "It doesn't stop at the wall any more.",
    shape: "Bouncing slug · biggest projectile in the game · locks on",
    what:
      "The largest projectile hitbox in the game, and it no longer dies against level geometry — " +
      "it bounces off walls until it finds someone or its nearly-three-second flight clock runs " +
      "out. Whatever it finds, it spikes: 40% slower for three seconds, with no bleed.",
    how:
      "Hard CC has moved on to Roadblock; this is the bouncing pressure shot instead. Bastion is " +
      "slower than everything else on the map, and a target it spikes cannot simply drive away " +
      "from that fact — the slow keeps them inside the fight rather than taking it away from them " +
      "outright.",
    tip:
      "Bounce it down a corridor or off an angled wall to reach someone hiding from a straight " +
      "line. It buys time to close, not a kill on its own — spend the window it opens.",
  },
  roadblock: {
    tagline: "A wall on the move.",
    shape: "Piercing bar · 120 units wide · no lock",
    what:
      "A 120-unit-wide bar that travels along its short axis and pierces everything in its path " +
      "— up to five cars, every other player in the match. Everything it touches takes the hit " +
      "and stops dead for a full second.",
    how:
      "Aim assist would be wasted here: a 120-unit face aims itself, wide enough to answer the " +
      "same 'help the slowest chassis hit something' problem a lock used to solve, just by " +
      "covering more ground. Line up two or three opponents and the whole line stops together — " +
      "the roster's only hard CC that hits more than one car at once.",
    tip:
      "Fire it across a chokepoint or a doorway rather than at a single target — its width is the " +
      "point. A crowd caught in it stops as one, which is exactly the moment Bastion's own slow " +
      "chassis stops mattering.",
  },
  wildcharge: {
    tagline: "Ten seconds of armor — 30% less damage taken — and intent.",
    shape: "Charge · one hit ends it · no lock",
    what:
      "One press opens a ten-second window: you take 30% less damage for its length, and the car " +
      "wears the charge outline the whole time. The first enemy hull you touch is hard-slammed for " +
      "a fixed impulse plus 250 damage, and the window closes right there — one hit, then it is " +
      "over.",
    how:
      "It is the roster's only exemption from the stun interrupt: a stun still stops the car dead, " +
      "but the armor and the charge state hold through it, because a state that cannot chain into " +
      "anything else is safe to protect. Armor cuts what gets through, it does not stop it — this " +
      "buys you a fight, not a free pass through one. Speed and range are both zero — a charge " +
      "dashes nowhere, it only waits for the first car foolish enough to get close.",
    tip:
      "Press it before a fight, not during one — the ten seconds have to still be running when you " +
      "make contact. Whoever you catch takes the hit, the slam, and loses the exchange before it " +
      "starts; everyone else just watches you stand there, armored, until you find someone.",
  },
};
