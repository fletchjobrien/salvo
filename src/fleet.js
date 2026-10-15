// Fleet design: hulls, fittable modules, points budget and the function
// that turns a design into the stats the simulation uses.
import { CLASSES, MISSILE_TYPES, GUN_TYPES, RADAR_TYPES, JAMMER_TYPES, SONAR_TYPES } from './config.js';

export const BUDGET = 2000;
export const MAX_SHIPS = 6;
export const MAX_SQUADRONS = 4;

export const HULLS = {
  fac: { name: 'Corvette', cost: 70, slots: 2, blurb: 'Fast and cheap' },
  ffg: { name: 'Frigate', cost: 140, slots: 4, blurb: 'Balanced escort' },
  ddg: { name: 'Destroyer', cost: 220, slots: 6, blurb: 'Tough flagship' },
  ssk: { name: 'Submarine', cost: 170, slots: 3, blurb: 'Hidden under water' },
};

// Every module fills one slot. `short` is the tile label, `desc` one line.
export const MODULES = {
  skimmer: { name: 'Sea-Skimmer', short: 'SKIMMER', qty: 4, cat: 'missiles', cost: 55, desc: 'Low and weaving · 4.2 km' },
  supersonic: { name: 'Supersonic', short: 'SUPERSONIC', qty: 2, cat: 'missiles', cost: 65, desc: 'Very fast, hard to stop · 3.3 km' },
  cruise: { name: 'Cruise Missile', short: 'CRUISE', qty: 2, cat: 'missiles', cost: 60, desc: 'Long reach, easier to stop · 7.5 km' },
  torpedo: { name: 'Heavy Torpedo', short: 'TORPEDO', qty: 4, cat: 'missiles', cost: 50, desc: 'Silent, can\'t be shot down · 3.6 km', hulls: ['ssk'] },
  asw: { name: 'ASW Torpedo', short: 'ASW TORP', qty: 4, cat: 'missiles', cost: 35, desc: 'Hunts submarines · 2.8 km', hulls: ['fac', 'ffg', 'ddg'] },
  autocannon: { name: '57mm Autocannon', short: '57MM', cat: 'guns', cost: 25, desc: 'Rapid fire, also hits missiles · 1.2 km' },
  naval: { name: '127mm Gun', short: '127MM', cat: 'guns', cost: 35, desc: 'Steady medium gun · 1.7 km' },
  railgun: { name: 'Railgun', short: 'RAILGUN', cat: 'guns', cost: 60, desc: 'Slow, flat, devastating · 3.2 km' },
  sam: { name: 'SAM Battery', short: 'SAM', qty: 8, cat: 'defense', cost: 50, desc: 'Area air defence · needs radar' },
  ciws: { name: 'CIWS', short: 'CIWS', cat: 'defense', cost: 30, desc: 'Last-ditch gatling · works jammed' },
  laser: { name: 'Laser', short: 'LASER', cat: 'defense', cost: 50, desc: 'Burns missiles inside 700 m' },
  decoy: { name: 'Decoys', short: 'DECOYS', qty: 4, cat: 'defense', cost: 15, desc: 'Chaff pulls missiles away' },
  search: { name: 'Search Radar', short: 'SEARCH', cat: 'sensors', cost: 40, desc: '5.2 km · balanced', unique: true },
  early: { name: 'Early-Warning Radar', short: 'EARLY WARN', cat: 'sensors', cost: 55, desc: '8 km · slow, loud, rarely identifies', unique: true },
  fire: { name: 'Fire-Control Radar', short: 'FIRE CTRL', cat: 'sensors', cost: 35, desc: '3.6 km · fast, identifies all', unique: true },
  sonar: { name: 'Sonar Array', short: 'SONAR', cat: 'sensors', cost: 35, desc: 'Hears subs · P to ping', unique: true, hulls: ['fac', 'ffg', 'ddg'] },
  noise: { name: 'Noise Jammer', short: 'NOISE JAM', cat: 'ew', cost: 45, desc: 'Narrow 7 km cone · 10 s', unique: true },
  barrage: { name: 'Barrage Jammer', short: 'BARRAGE', cat: 'ew', cost: 45, desc: 'Wide 4 km cone · 8 s', unique: true },
  helo: { name: 'Helicopter Hangar', short: 'HELO', cat: 'air', cost: 50, desc: 'Carries your helicopter design', hulls: ['ffg', 'ddg'] },
  drone: { name: 'Drone Hangar', short: 'DRONE', cat: 'air', cost: 40, desc: 'Carries your drone design', hulls: ['ffg', 'ddg'] },
};

// Aircraft. Deck types fly from a ship's hangar (the hangar module pays for
// the airframe); squadrons are called in from off the map with I/O/K/L.
export const AIRFRAMES = {
  helo: { name: 'Helicopter', deck: true, cost: 0, slots: 2, blurb: 'Hovers, dips sonar' },
  drone: { name: 'Drone', deck: true, cost: 0, slots: 2, blurb: 'Fast, expendable' },
  fighter: { name: 'Fighters', cost: 80, slots: 3, count: 2, duration: 90, cooldown: 110, orbit: 1100, blurb: 'Pair · fast, agile' },
  jet: { name: 'Attack Jets', cost: 100, slots: 3, count: 2, duration: 75, cooldown: 140, orbit: 900, blurb: 'Pair · heavy loads' },
  mpa: { name: 'Patrol Plane', cost: 90, slots: 4, count: 1, duration: 110, cooldown: 140, orbit: 900, blurb: 'Single · long endurance' },
};

export const AIR_MODULES = {
  aam: { name: 'Air-to-Air Missiles', short: 'AAM', qty: 2, cat: 'missiles', cost: 25, desc: 'Shoots down aircraft · 4.2 km', frames: ['fighter', 'jet', 'drone'] },
  asm: { name: 'Anti-Ship Missiles', short: 'ASM', qty: 2, cat: 'missiles', cost: 35, desc: 'Sea-skimmers · 4.2 km', frames: ['jet', 'drone', 'mpa', 'helo'] },
  atorp: { name: 'Light Torpedoes', short: 'TORP', qty: 2, cat: 'missiles', cost: 25, desc: 'Dropped on subs it finds', frames: ['helo', 'mpa'] },
  dip: { name: 'Sonar', short: 'SONAR', cat: 'sensors', cost: 25, desc: 'Helo: dips and pings · plane: sonobuoys', frames: ['helo', 'mpa'], unique: true },
  aradar: { name: 'Radar', short: 'RADAR', cat: 'sensors', cost: 20, desc: 'Search radar for the whole fleet', unique: true },
  aew: { name: 'AEW Radar', short: 'AEW', cat: 'sensors', cost: 60, desc: '11 km flying radar', frames: ['mpa'], unique: true },
  pod: { name: 'Jammer Pod', short: 'JAM POD', cat: 'ew', cost: 35, desc: 'Jams ahead of its attack', frames: ['jet', 'drone', 'fighter'], unique: true },
  flares: { name: 'Flares', short: 'FLARES', cat: 'defense', cost: 15, desc: 'Halves hits from air defence', unique: true },
  fuel: { name: 'Drop Tanks', short: 'FUEL', cat: 'defense', cost: 15, desc: '+50% time on station', frames: ['fighter', 'jet', 'mpa'], unique: true },
};

// Radar fitted to each airframe by the RADAR module.
const AIR_RADAR = { helo: 2600, drone: 4800, fighter: 4200, jet: 3600, mpa: 6500 };

export function airModuleFits(cls, key) {
  const m = AIR_MODULES[key];
  return !!m && (!m.frames || m.frames.includes(cls));
}

export function airCost(d) {
  return (AIRFRAMES[d.cls]?.cost || 0) + d.modules.reduce((a, m) => a + (AIR_MODULES[m]?.cost || 0), 0);
}

// Submarines can only carry these; everything else is for surface ships.
const SUB_MODULES = ['torpedo', 'skimmer', 'supersonic', 'cruise', 'decoy'];
export function moduleFits(cls, key) {
  const m = MODULES[key];
  if (!m) return false;
  if (m.hulls) return m.hulls.includes(cls);
  return cls === 'ssk' ? SUB_MODULES.includes(key) : true;
}

export const CATEGORIES = [
  ['missiles', 'Missile Batteries'],
  ['guns', 'Guns'],
  ['defense', 'Defence'],
  ['sensors', 'Radar Arrays'],
  ['ew', 'Jammer Arrays'],
  ['air', 'Hangars'],
];

const NAMES = {
  blue: {
    ddg: ['Valiant', 'Resolute', 'Dauntless', 'Intrepid', 'Vigilant', 'Sovereign'],
    ffg: ['Kestrel', 'Osprey', 'Merlin', 'Harrier', 'Peregrine', 'Goshawk'],
    fac: ['Stiletto', 'Rapier', 'Dirk', 'Cutlass', 'Sabre', 'Lancet'],
    ssk: ['Nautilus', 'Trident', 'Barracuda', 'Thresher', 'Seawolf', 'Triton'],
  },
  red: {
    ddg: ['Dominion', 'Tempest', 'Colossus', 'Imperator', 'Bastion', 'Leviathan'],
    ffg: ['Ardent', 'Fury', 'Vigil', 'Zealot', 'Wrath', 'Rampart'],
    fac: ['Viper', 'Adder', 'Krait', 'Mamba', 'Asp', 'Cobra'],
    ssk: ['Akula', 'Volna', 'Kalmar', 'Shchuka', 'Delfin', 'Murena'],
  },
};

export function shipName(side, cls, used) {
  const pool = NAMES[side][cls];
  return pool.find((n) => !used.includes(n)) || `${pool[0]} ${used.length + 1}`;
}

export const PRESETS = {
  standard: {
    name: 'Standard Task Group',
    ships: [
      { cls: 'ddg', modules: ['skimmer', 'skimmer', 'sam', 'ciws', 'search', 'naval'] },
      { cls: 'ffg', modules: ['skimmer', 'sam', 'ciws', 'noise'] },
      { cls: 'ffg', modules: ['skimmer', 'sam', 'ciws', 'noise'] },
      { cls: 'fac', modules: ['skimmer', 'autocannon'] },
    ],
    air: [
      { cls: 'fighter', modules: ['aam', 'aam', 'aradar'] },
      { cls: 'jet', modules: ['asm', 'asm', 'aradar'] },
    ],
  },
  wolfpack: {
    name: 'Wolfpack',
    ships: [
      { cls: 'ffg', modules: ['early', 'sam', 'barrage', 'laser'] },
      { cls: 'fac', modules: ['supersonic', 'autocannon'] },
      { cls: 'fac', modules: ['supersonic', 'autocannon'] },
      { cls: 'fac', modules: ['supersonic', 'autocannon'] },
      { cls: 'fac', modules: ['supersonic', 'autocannon'] },
      { cls: 'fac', modules: ['supersonic', 'decoy'] },
    ],
    air: [{ cls: 'mpa', modules: ['aew', 'flares', 'fuel'] }],
  },
  shield: {
    name: 'Air Defence Group',
    ships: [
      { cls: 'ddg', modules: ['sam', 'sam', 'laser', 'ciws', 'fire', 'search'] },
      { cls: 'ddg', modules: ['cruise', 'cruise', 'skimmer', 'naval', 'ciws', 'noise'] },
      { cls: 'ffg', modules: ['skimmer', 'sam', 'ciws', 'naval'] },
    ],
    air: [
      { cls: 'fighter', modules: ['aam', 'aam', 'aradar'] },
      { cls: 'fighter', modules: ['aam', 'aam', 'flares'] },
      { cls: 'mpa', modules: ['aew', 'fuel'] },
    ],
  },
  silent: {
    name: 'Silent Service',
    ships: [
      { cls: 'ssk', modules: ['torpedo', 'skimmer'] },
      { cls: 'ssk', modules: ['torpedo', 'supersonic'] },
      { cls: 'ffg', modules: ['sonar', 'helo', 'sam', 'asw'] },
      { cls: 'ddg', modules: ['skimmer', 'sam', 'ciws', 'search', 'drone', 'naval'] },
    ],
    air: [{ cls: 'mpa', modules: ['aradar', 'dip', 'atorp', 'atorp'] }],
  },
  carrier: {
    name: 'Drone Carrier Group',
    ships: [
      { cls: 'ddg', modules: ['helo', 'drone', 'drone', 'sam', 'ciws', 'search'] },
      { cls: 'ffg', modules: ['drone', 'sam', 'ciws', 'sonar'] },
      { cls: 'ffg', modules: ['helo', 'asw', 'sam', 'noise'] },
      { cls: 'fac', modules: ['skimmer', 'autocannon'] },
    ],
    deck: { helo: ['dip', 'atorp'], drone: ['aradar', 'asm'] },
    air: [{ cls: 'jet', modules: ['asm', 'asm', 'pod'] }],
  },
  strike: {
    name: 'Long-Range Strike',
    ships: [
      { cls: 'ddg', modules: ['cruise', 'cruise', 'cruise', 'early', 'sam', 'ciws'] },
      { cls: 'ffg', modules: ['railgun', 'search', 'sam', 'ciws'] },
      { cls: 'ffg', modules: ['railgun', 'noise', 'sam', 'ciws'] },
      { cls: 'fac', modules: ['cruise', 'decoy'] },
    ],
    air: [
      { cls: 'jet', modules: ['asm', 'asm', 'pod'] },
      { cls: 'jet', modules: ['asm', 'asm', 'flares'] },
    ],
  },
};

// Default loadouts for deck aircraft.
export const DECK_DEFAULT = { helo: ['dip', 'atorp'], drone: ['aradar', 'asm'] };

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function shipCost(d) {
  return (HULLS[d.cls]?.cost || 0) + d.modules.reduce((a, m) => a + (MODULES[m]?.cost || 0), 0);
}

// How many of each deck aircraft the ships carry.
export function deckCount(f) {
  const n = { helo: 0, drone: 0 };
  for (const d of f.ships) for (const m of d.modules) if (m in n) n[m]++;
  return n;
}

// A deck design's loadout is paid for once per aircraft carried.
export function deckCost(f) {
  const n = deckCount(f);
  return Object.keys(n).reduce((a, k) => a + n[k] * airCost({ cls: k, modules: (f.deck && f.deck[k]) || [] }), 0);
}

export function fleetCost(f) {
  return f.ships.reduce((a, d) => a + shipCost(d), 0) + (f.air || []).reduce((a, d) => a + airCost(d), 0) + deckCost(f);
}

function cleanMods(list, max, fits, defs) {
  const mods = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!defs[m] || !fits(m)) continue;
    if (defs[m].unique && mods.includes(m)) continue;
    if (mods.length >= max) break;
    mods.push(m);
  }
  return mods;
}

const cleanName = (n) => (typeof n === 'string' ? n.replace(/[^\w\s-]/g, '').slice(0, 16) : '');

// Clean up anything malformed (also used on designs received over the network).
export function validateFleet(f, side = 'blue') {
  if (!f || !Array.isArray(f.ships)) return null;
  const ships = [];
  for (const d of f.ships.slice(0, MAX_SHIPS)) {
    if (!d || !HULLS[d.cls]) continue;
    ships.push({ cls: d.cls, modules: cleanMods(d.modules, HULLS[d.cls].slots, (m) => moduleFits(d.cls, m), MODULES), name: cleanName(d.name) });
  }
  if (!ships.length) return null;
  const air = [];
  for (const d of (Array.isArray(f.air) ? f.air : []).slice(0, MAX_SQUADRONS)) {
    if (!d || !AIRFRAMES[d.cls] || AIRFRAMES[d.cls].deck) continue;
    air.push({ cls: d.cls, modules: cleanMods(d.modules, AIRFRAMES[d.cls].slots, (m) => airModuleFits(d.cls, m), AIR_MODULES), name: cleanName(d.name) || AIRFRAMES[d.cls].name });
  }
  // number repeated squadron names: Fighters, Fighters 2
  air.forEach((d, i) => {
    const same = air.slice(0, i).filter((q) => q.name === d.name).length;
    if (same) d.name = `${d.name.slice(0, 13)} ${same + 1}`;
  });
  const deck = {};
  for (const k of ['helo', 'drone']) {
    const want = f.deck && Array.isArray(f.deck[k]) ? f.deck[k] : DECK_DEFAULT[k];
    deck[k] = cleanMods(want, AIRFRAMES[k].slots, (m) => airModuleFits(k, m), AIR_MODULES);
  }
  const out = { ships, air, deck };
  if (fleetCost(out) > BUDGET) return null;
  const used = [];
  for (const d of ships) {
    if (!d.name) d.name = shipName(side, d.cls, used);
    used.push(d.name);
  }
  return out;
}

export function presetFleet(key, side = 'blue') {
  return validateFleet(clone(PRESETS[key] || PRESETS.standard), side);
}

// A sensible random design that fits the budget (for the AI).
export function randomFleet(side = 'red') {
  const plans = [
    ['ddg', 'ffg', 'ffg', 'fac'],
    ['ddg', 'ddg', 'ffg'],
    ['ffg', 'ffg', 'ffg', 'fac', 'fac'],
    ['ffg', 'fac', 'fac', 'fac', 'fac'],
    ['ddg', 'fac', 'fac', 'fac'],
    ['ddg', 'ffg', 'ssk'],
    ['ffg', 'ffg', 'ssk', 'fac'],
  ];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const hulls = pick(plans);
  const ships = hulls.map((cls) => ({ cls, modules: [] }));
  // one or two squadrons first, so the ships don't eat the whole budget
  const wings = [
    { cls: 'fighter', modules: ['aam', 'aam', 'aradar'] },
    { cls: 'jet', modules: ['asm', 'asm', pick(['aradar', 'pod', 'flares'])] },
    { cls: 'mpa', modules: [pick(['aew', 'aradar']), 'dip', 'atorp', 'fuel'] },
    { cls: 'jet', modules: ['asm', 'aam', 'flares'] },
  ];
  const air = [];
  for (let i = 0, n = 1 + Math.floor(Math.random() * 2); i < n; i++) air.push(clone(pick(wings)));
  let budget = BUDGET - ships.reduce((a, d) => a + HULLS[d.cls].cost, 0) - air.reduce((a, d) => a + airCost(d), 0);
  const fit = (d, m) => {
    const extra = DECK_DEFAULT[m] ? airCost({ cls: m, modules: DECK_DEFAULT[m] }) : 0;
    if (d.modules.length >= HULLS[d.cls].slots || MODULES[m].cost + extra > budget) return;
    if (MODULES[m].unique && d.modules.includes(m)) return;
    if (!moduleFits(d.cls, m)) return;
    d.modules.push(m);
    budget -= MODULES[m].cost + extra;
  };
  // every ship gets a missile battery; then a role-flavoured second pass
  for (const d of ships) fit(d, d.cls === 'ssk' ? 'torpedo' : pick(['skimmer', 'skimmer', 'supersonic', 'cruise']));
  for (const d of ships) {
    const wants =
      d.cls === 'ssk'
        ? [pick(['torpedo', 'skimmer', 'supersonic']), pick(['decoy', 'cruise'])]
        : d.cls === 'fac'
        ? [pick(['autocannon', 'decoy', 'skimmer', 'supersonic'])]
        : [pick(['sam', 'sam', 'laser']), pick(['ciws', 'autocannon']), pick(['search', 'fire', 'early', 'noise', 'barrage', 'sonar']), pick(['naval', 'railgun', 'skimmer', 'noise', 'helo', 'drone']), pick(['sam', 'asw', 'sonar']), pick(['search', 'cruise', 'decoy'])];
    for (const m of wants) fit(d, m);
  }
  return validateFleet({ ships, air, deck: DECK_DEFAULT }, side);
}

// Stats for one design: the hull's (or airframe's) values plus its modules.
export function buildSpec(cls, modules = []) {
  const base = CLASSES[cls];
  const n = (m) => modules.filter((x) => x === m).length;
  if (AIRFRAMES[cls] || base.air) return airSpec(cls, modules, base, n);
  const radars = [RADAR_TYPES.nav, ...['search', 'early', 'fire'].filter((r) => n(r)).map((r) => RADAR_TYPES[r])];
  const jammers = ['noise', 'barrage'].filter((j) => n(j)).map((j) => ({ key: j, ...JAMMER_TYPES[j] }));
  const ammo = {
    skimmer: 4 * n('skimmer'),
    supersonic: 2 * n('supersonic'),
    cruise: 2 * n('cruise'),
    heavy: 4 * n('torpedo'),
    light: 4 * n('asw'),
    aam: 0,
  };
  return {
    ...base,
    ammo,
    sam: 8 * n('sam'),
    ciws: n('ciws'),
    ciwsPk: 0.45 * n('ciws'),
    laser: n('laser'),
    chaff: base.chaff + 4 * n('decoy'),
    guns: modules.filter((m) => GUN_TYPES[m]).map((m) => ({ key: m, ...GUN_TYPES[m] })),
    radars,
    radarRange: Math.max(...radars.map((r) => r.range)),
    jammers,
    canJam: jammers.length > 0,
    sonar: cls === 'ssk' ? SONAR_TYPES.hull : n('sonar') ? SONAR_TYPES.array : null,
    aircraft: modules.filter((m) => m === 'helo' || m === 'drone'),
    maxRange: Math.max(0, ...Object.keys(MISSILE_TYPES).filter((k) => ammo[k] > 0).map((k) => MISSILE_TYPES[k].range)),
    modules: modules.slice(),
  };
}

function airSpec(cls, modules, base, n) {
  const radars = [];
  if (n('aradar')) radars.push({ name: 'Radar', range: AIR_RADAR[cls] || 3000, period: 2, ident: 0.5 });
  if (n('aew')) radars.push({ name: 'AEW Radar', range: 11000, period: 4, ident: 0.25 });
  // with no radar fitted, a small set sees only what is close
  if (!radars.length) radars.push({ name: 'Eyes', range: 900, period: 2, ident: 1 });
  const ammo = { skimmer: 2 * n('asm'), supersonic: 0, cruise: 0, heavy: 0, light: 2 * n('atorp'), aam: 2 * n('aam') };
  const jammers = n('pod') ? [{ key: 'pod', ...JAMMER_TYPES.noise, range: 4500 }] : [];
  return {
    ...base,
    ammo,
    sam: 0,
    ciws: 0,
    ciwsPk: 0,
    laser: 0,
    chaff: 0,
    guns: [],
    radars,
    radarRange: Math.max(...radars.map((r) => r.range)),
    jammers,
    canJam: jammers.length > 0,
    sonar: n('dip') ? (cls === 'helo' ? SONAR_TYPES.dipping : { name: 'Sonobuoys', passive: 2600, active: 0, ident: 0.5, cooldown: 99 }) : null,
    flares: n('flares') > 0,
    endurance: n('fuel') ? 1.5 : 1,
    aircraft: [],
    maxRange: ammo.skimmer ? MISSILE_TYPES.skimmer.range : 0,
    modules: modules.slice(),
  };
}
