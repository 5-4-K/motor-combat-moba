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
  rectangle: {
    codename: "The Runner",
    theme: "Your driving is your aim.",
    body:
      "The fastest thing on the map and the one that hits softest. Rectangle cannot win a damage " +
      "race and cannot win a brawl — every weapon in the kit is short-to-medium range and rewards " +
      "being in motion, so it is your speed doing the work, not your gun.",
    beats: "Closes on Oval before its wind-ups can resolve.",
    losesTo: "Hexagon. Rectangle must come close to use its kit, and close is where Hexagon lives.",
  },
  oval: {
    codename: "The Gunner",
    theme: "Reach and precision, punished hard when caught.",
    body:
      "A glass cannon that wants never to be touched. Every weapon reaches, and two of the three " +
      "carry a real aiming or timing condition. The hardest kit in the game to land — which is " +
      "exactly what the damage lead is paid for.",
    beats: "Kites Hexagon forever; it can never close the speed gap.",
    losesTo: "Rectangle, which arrives before you have finished winding up.",
  },
  hexagon: {
    codename: "The Bastion",
    theme: "It cannot chase — so it makes you come to it.",
    body:
      "Two of three weapons are contact-range and the third denies ground outright. Hexagon " +
      "converts the biggest hull in the game into the right to BE somewhere, which is the only " +
      "currency a chassis that cannot reposition has.",
    beats: "Rectangle, the moment it commits to contact range.",
    losesTo: "Oval, which simply refuses to come within reach.",
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
      "Two a second, out to seven tenths of the arena, with a 24-unit disc for a hitbox — three " +
      "quarters of a car's width. It finds its own target inside 400 units, so the only thing you " +
      "have to do is keep the trigger warm.",
    how:
      "This is the yardstick every other weapon in the game was balanced against: five unbroken " +
      "seconds of Fireball kills an average car, and that is where the number 50 came from.",
    tip:
      "Never stop pressing it. Fireball has zero recovery, so it gates nothing — you can keep " +
      "throwing bolts into a target while your Afterburner is already cooking them.",
  },
  pepperbox: {
    tagline: "A drive-by, in six pieces.",
    shape: "Three volleys of two · 10° fan · no lock",
    what:
      "Three bursts of two pellets, a tenth of a second apart, spread across a narrow fan. Each " +
      "burst leaves from wherever your nose is pointing on its own tick — so driving straight " +
      "clusters all six into one fist, and turning through the press sprays them across an arc.",
    how:
      "No aim assist. This is your gun, not the game's. The full burst is roughly a third of an " +
      "average car delivered inside 200 milliseconds; Fireball needs 1.7 seconds to match it.",
    tip:
      "Fire it on the pass, at contact range. Realistically three or four pellets land, so its " +
      "payoff decays with distance — which is what makes it a closing tool rather than a poke.",
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
  splinter: {
    tagline: "Three darts. Spend them well.",
    shape: "Banked darts · thin and fast · locks on",
    what:
      "Up to three shots held in reserve, released as fast as an eighth of a second apart, each one " +
      "recharging on its own timer. Thin, quick, long-ranged, and it finds its own target.",
    how:
      "Tap one dart per recharge and you sustain output forever. Dump all three and you put a fifth " +
      "of a car out in a quarter second — then stand silent for well over a second.",
    tip:
      "Tapping wins the long fight; dumping wins the moment. Choosing between them every few " +
      "seconds is the entire weapon. Do not dump on reflex.",
  },
  skewer: {
    tagline: "Line them up.",
    shape: "Piercing lance · passes through two cars · no lock",
    what:
      "A long, thin, very fast bolt that crosses almost the whole arena and does not stop at the " +
      "first car it hits. Short wind-up before it leaves.",
    how:
      "Pierce counts cars AFTER the first, so this is two cars, not one. Catching a second body on " +
      "the same line very nearly doubles the press.",
    tip:
      "Aim assist is switched off deliberately — this could take it and does not. Lining two " +
      "enemies up is meant to be the highest-value press in the game, and handing that to the lock " +
      "would be giving it away.",
  },
  lance: {
    tagline: "Seven tenths of a second of nerve.",
    shape: "Stamped beam · one hit per car · no lock",
    what:
      "A long wind-up during which you are a stationary, visible, extremely soft target. Then a " +
      "narrow beam stamped clean across the arena, effectively instantly. It hits each car once and " +
      "is gone.",
    how:
      "The wind-up is only half the cost. A full second of recovery afterwards means a miss buys " +
      "your opponent a free second as well.",
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
      "is near-unmissable.",
    how:
      "Hexagon is slower than everything else on the map. Without one weapon that reaches at all, " +
      "the slowest chassis has no answer to a patient opponent. Thumper is that weapon.",
    tip:
      "It buys pressure, not a ranged win. Use it to make kiting cost something while you close, " +
      "and lean on it hard the moment anyone is inside a car length or two.",
  },
  shockwave: {
    tagline: "Get off me.",
    shape: "Ring around the car · hugs the chassis · one hit per car",
    what:
      "The widest hitbox in the game and the shortest-lived: a ring that expands out of the car for " +
      "a quarter of a second and hits every enemy it reaches exactly once, hard — behind you as " +
      "readily as in front. Everything it catches is stunned: no engine, no steering, no trigger.",
    how:
      "It is not aimed at all. It is triggered — it only needs people to be near you, which on this " +
      "chassis is most of the match. There is no wrong way to be facing.",
    tip:
      "Anti-ram, anti-dive, anti-Rectangle. The moment somebody commits to contact range, this is " +
      "the button that makes them regret arriving.",
  },
  bulwark: {
    tagline: "You may not come in.",
    shape: "Stamped zone · ticks · lingers",
    what:
      "A wide cone dropped into the world and left there for three and a half seconds, re-arming " +
      "against anything still inside it several times a second. It grows out over a full second, so " +
      "it is visible before it is dangerous.",
    how:
      "It cannot hurt you, and there is no friendly fire. You can park inside your own Bulwark. " +
      "That asymmetry is most of the weapon: it is not a hazard, it is an exclusion zone.",
    tip:
      "Drop it on yourself to become unapproachable for three seconds, or lay it across the only " +
      "path between an enemy and their escape. Damage is the secondary output — the ground is the " +
      "point. But never treat it as a wall you can drive through.",
  },
};
