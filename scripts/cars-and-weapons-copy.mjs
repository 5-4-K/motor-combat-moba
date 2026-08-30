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
      // NOT "hits hardest per press": that title belongs to Bastion's Bulwark, which the ranking
      // page and Bulwark's own card both say outright. Mirage's damage is real but conditional.
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
      "A glass cannon that wants never to be touched. It carries the longest weapon in the game " +
      "and two mid-range answers underneath it, all three of which take the lock — the reach is " +
      "the skill, not the aiming. It has the thinnest hull on the grid to pay for it.",
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
      "The slowest chassis, the biggest hull, and the longest crowd control in the game. Bastion " +
      "does not catch anybody: it stuns them, lunges at them, and denies the ground they wanted. " +
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

export const WEAPON_COPY = {
  fireball: {
    tagline: "The shot everyone knows.",
    shape: "Ember bolt · locks on",
    what:
      "Not quite twice a second, out to seven tenths of the arena, with a 24-unit disc for a " +
      "hitbox — three quarters of a car's width. It finds its own target inside 400 units, so the " +
      "only thing you have to do is keep the trigger warm.",
    how:
      "This is the yardstick every other weapon in the game is read against: five and a half " +
      "unbroken seconds of Fireball kills an average car, and 50 a shot is where that comes from.",
    tip:
      "Never stop pressing it. Fireball has zero recovery, so it gates nothing — you can keep " +
      "throwing bolts into a target while your Afterburner is already cooking them.",
  },
  pepperbox: {
    tagline: "A drive-by, in three pieces.",
    shape: "One fan of three · 12° spread · locks on",
    what:
      "Three pellets on a single trigger pull, thrown across a narrow fan out to just under half " +
      "the arena. The whole spread is decided on the tick you press — where your nose points at " +
      "that instant is where the fan goes, and nothing you do afterwards moves it.",
    how:
      "All three connecting is a bit over a quarter of an average car, on a rhythm that sustains " +
      "almost exactly what Needler does. They are a pair, not a favourite and a spare: one dart " +
      "far out, one cone up close.",
    tip:
      "Fire it on the pass. The fan is fixed at the press, so the closer you are the more of it " +
      "lands — which makes it a closing tool rather than a poke, whatever the lock does for you.",
  },
  afterburner: {
    tagline: "Catch them. Then cook them.",
    shape: "Flame cone · welded to your nose · ticks",
    what:
      "A wide cone bolted to the front of the car for a little over two seconds, burning everything " +
      "inside it five times a second. It sweeps as you steer, and it dies the instant you do.",
    how:
      "Held on a target for the full duration it is over half an average car's health. A four or " +
      "five tick sweep on a drive-by is still the biggest press in the kit.",
    tip:
      "Press it when you are already on somebody's bumper. No other chassis can catch a fleeing " +
      "car — this is what turns the catch into a kill. Recovery is tiny on purpose: keep firing " +
      "Fireball the whole time it burns.",
  },
  needler: {
    tagline: "Three darts. Spend them well.",
    shape: "Banked darts · thin and fast · locks on",
    what:
      "Up to three shots held in reserve, released as fast as an eighth of a second apart and " +
      "restored one at a time on a rolling recharge. Thin, quick, long-ranged, and it finds its " +
      "own target.",
    how:
      "Tap one dart per recharge and you sustain output forever — four fifths of what Fireball " +
      "manages, from further away. Dump all three and the same eighth of a car arrives in a " +
      "quarter of a second instead. The magazine refills while you are firing it, so you pause " +
      "for a beat and then carry on at the same rate you were already on.",
    tip:
      "Dumping moves your damage earlier; it does not buy you any more of it. Bank the darts when " +
      "nothing is in range, and spend them when a target is briefly worth killing — a dive you " +
      "want to punish now, or someone about to break line of sight.",
  },
  skewer: {
    tagline: "Line them up.",
    shape: "Piercing bolt · passes through two cars · locks on",
    what:
      "A long, thin bolt that reaches about half the arena and does not stop at the first car it " +
      "hits. Short wind-up before it leaves, and two thirds of a second in the air over its full " +
      "reach — long enough to be dodged if they see it coming.",
    how:
      "Pierce counts cars AFTER the first, so this is two cars, not one. Catching a second body on " +
      "the same line very nearly doubles the press, and it is still the biggest non-ultimate press " +
      "in the game.",
    tip:
      "It is a lunge, not a poke. You have to be inside half the arena on the slowest chassis " +
      "there is, and you cannot reposition to fix a miss — so the lock helps you inside 400 units " +
      "and nothing helps you past that. Finding the line is still your job.",
  },
  lance: {
    tagline: "Seven tenths of a second of nerve.",
    shape: "Stamped beam · one hit per car · locks on up close",
    what:
      "A long wind-up during which you are a stationary, visible, extremely soft target. Then a " +
      "narrow beam stamped clean across the arena, effectively instantly. It hits each car once and " +
      "is gone.",
    how:
      "The wind-up is only half the cost. A full second of recovery afterwards means a miss buys " +
      "your opponent a free second as well. The lock only reaches 400 units of the beam's 1200, so " +
      "for most of its length this is a shot you aim yourself.",
    tip:
      "Fire it at somebody who cannot spend the next three quarters of a second dodging: cornered, " +
      "mid-commitment, or standing behind a second car so the beam catches both. On this hull, a " +
      "whiff is close to a death sentence.",
  },
  thumper: {
    tagline: "Slow, fat, and hard to argue with.",
    shape: "Heavy slug · biggest projectile in the game · locks on",
    what:
      "A lumbering shell with the largest projectile hitbox in the game. It takes well over a " +
      "second to cross its own range, so at distance it is genuinely dodgeable — and in a brawl it " +
      "is near-unmissable. Everything it hits is stunned: no engine, no steering, no trigger.",
    how:
      "Bastion is slower than everything else on the map, and this is the button that fixes that. " +
      "The stun is the longest crowd control any chassis carries, and it comes off a one-second " +
      "cooldown — too fast to bait out, so it has to be dodged.",
    tip:
      "It buys a window, not a kill. Land it, then spend the stun closing the gap you could never " +
      "close by driving. Everything else Bastion owns happens inside that window.",
  },
  shockwave: {
    tagline: "Three times, or not at all.",
    shape: "Three rings around the car · half a second apart · one hit per car per ring",
    what:
      "One press, three separate rings. Each expands out of the car for a quarter of a second and " +
      "hits every enemy it reaches exactly once — behind you as readily as in front — and the next " +
      "one arrives half a second later. The whole press takes a second and a quarter to finish.",
    how:
      "It is not aimed at all. It is triggered, and it moves with you, so the question is never " +
      "where you are pointing — it is whether they are still beside you when ring three goes off. " +
      "Only that last ring corrodes, and corroded cars take a third more from everything.",
    tip:
      "Press it as you arrive, not as you leave. Driving straight through somebody keeps them " +
      "inside all three rings; peeling off after the first throws two thirds of the press away, " +
      "and the debuff that sets up your Afterburner with it.",
  },
  bulwark: {
    tagline: "You may not come in.",
    shape: "Stamped zone · ticks · lingers",
    what:
      "A wide cone dropped into the world and left there for nearly four seconds, re-arming " +
      "against anything still inside it every four tenths of a second. It grows out over a full " +
      "second, so it is visible before it is dangerous. Anything it catches is spiked: slowed, and " +
      "bleeding for as long as the spikes hold.",
    how:
      "It cannot hurt you, and there is no friendly fire. You can park inside your own Bulwark. " +
      "That asymmetry is most of the weapon: it is not a hazard, it is an exclusion zone. Ten " +
      "ticks on a car that never leaves makes it the hardest single press in the game.",
    tip:
      "Drop it on yourself to become unapproachable for four seconds, or lay it across the only " +
      "path between an enemy and their escape. Damage is the secondary output — the ground is the " +
      "point. But never treat it as a wall you can drive through.",
  },
};
