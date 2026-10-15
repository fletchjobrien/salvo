// Fleet design: hulls, fittable modules, points budget and the function
// that turns a design into the stats the simulation uses.
import { CLASSES, MISSILE_TYPES, GUN_TYPES, RADAR_TYPES, JAMMER_TYPES, SONAR_TYPES } from './config.js';

export const BUDGET = 1400;
export const MAX_SHIPS = 6;

export const HULLS = {
  fac: { name: 'Corvette', size: 'Small', cost: 70, slots: 2, blurb: 'Fast, cheap and fragile. Two slots: pick a job.' },
  ffg: { name: 'Frigate', size: 'Medium', cost: 140, slots: 4, blurb: 'Balanced escort with room for a real loadout.' },
  ddg: { name: 'Destroyer', size: 'Large', cost: 220, slots: 6, blurb: 'Big, tough flagship hull. Slow to turn, carries the most.' },
  ssk: { name: 'Submarine', size: 'Sub', cost: 170, slots: 3, blurb: 'Invisible to radar while submerged; only sonar finds it. Built-in sonar. U to surface or dive.' },
};

// Every module fills one slot.
export const MODULES = {
  skimmer: { name: 'Sea-Skimmer Battery', short: 'SKIMMER ×4', cat: 'missiles', cost: 55, desc: '4 subsonic missiles that hug the waves and weave at the end. 4.2 km.' },
  supersonic: { name: 'Supersonic Battery', short: 'SUPERSONIC ×2', cat: 'missiles', cost: 65, desc: '2 very fast missiles. Hard to shoot down, hit hard. 3.3 km.' },
  cruise: { name: 'Cruise Battery', short: 'CRUISE ×2', cat: 'missiles', cost: 60, desc: '2 long-range missiles. Fly high, then dive. Easier to intercept. 7.5 km.' },
  autocannon: { name: '57mm Autocannon', short: '57MM', cat: 'guns', cost: 25, desc: 'Rapid fire, short range. Also shoots down nearby missiles.' },
  naval: { name: '127mm Naval Gun', short: '127MM', cat: 'guns', cost: 35, desc: 'Steady medium-range gun. 1.7 km.' },
  railgun: { name: 'Railgun', short: 'RAILGUN', cat: 'guns', cost: 60, desc: 'Slow-firing, flat, devastating hits out to 3.2 km.' },
  sam: { name: 'SAM Battery', short: 'SAM ×8', cat: 'defense', cost: 50, desc: '8 interceptors for area defence. Needs radar on and unjammed.' },
  ciws: { name: 'CIWS Turret', short: 'CIWS', cat: 'defense', cost: 30, desc: 'Last-ditch gatling gun. Works even when jammed.' },
  laser: { name: 'Point-Defence Laser', short: 'LASER', cat: 'defense', cost: 50, desc: 'Burns down missiles inside 700 m. Never runs dry.' },
  decoy: { name: 'Decoy Launcher', short: 'DECOYS', cat: 'defense', cost: 15, desc: '+4 chaff salvos to pull missiles away.' },
  search: { name: 'Search Radar', short: 'SEARCH', cat: 'sensors', cost: 40, desc: '5.2 km range, pings every 3 s. Identifies inside 2 km.', unique: true },
  early: { name: 'Early-Warning Radar', short: 'EARLY WARN', cat: 'sensors', cost: 55, desc: '8 km range, slow pings. Mostly unknown blips. Loud.', unique: true },
  fire: { name: 'Fire-Control Radar', short: 'FIRE CTRL', cat: 'sensors', cost: 35, desc: '3.6 km, pings every second and identifies everything it sees.', unique: true },
  torpedo: { name: 'Torpedo Tubes', short: 'TORPEDO ×4', cat: 'missiles', cost: 50, desc: '4 heavy torpedoes. Run silent underwater; can\'t be shot down. 3.6 km.', hulls: ['ssk'] },
  asw: { name: 'ASW Torpedoes', short: 'ASW TORP ×4', cat: 'missiles', cost: 35, desc: '4 light homing torpedoes for hunting submarines. 2.8 km.', hulls: ['fac', 'ffg', 'ddg'] },
  sonar: { name: 'Sonar Array', short: 'SONAR', cat: 'sensors', cost: 35, desc: 'Hears ships and subs by their noise. P pings: reveals subs, but gives you away.', unique: true, hulls: ['fac', 'ffg', 'ddg'] },
  helo: { name: 'ASW Helicopter', short: 'HELO', cat: 'air', cost: 60, desc: 'Launches a helicopter that dips sonar and drops torpedoes on submarines.', hulls: ['ffg', 'ddg'] },
  drone: { name: 'Recon Drone', short: 'RECON UAV', cat: 'air', cost: 45, desc: 'Fast unarmed drone with a search radar. Send it ahead to spot.', hulls: ['ffg', 'ddg'] },
  strike: { name: 'Strike Drone', short: 'STRIKE UAV', cat: 'air', cost: 70, desc: 'Drone carrying 2 sea-skimmer missiles. Fires with your salvos.', hulls: ['ffg', 'ddg'] },
  noise: { name: 'Noise Jammer', short: 'NOISE JAM', cat: 'ew', cost: 45, desc: 'Cast a narrow 7 km cone: blinds radars and seekers for 10 s.', unique: true },
  barrage: { name: 'Barrage Jammer', short: 'BARRAGE JAM', cat: 'ew', cost: 45, desc: 'Cast a wide 4 km cone: blinds radars and seekers for 8 s.', unique: true },
};

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
  ['air', 'Aircraft'],
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
  },
  shield: {
    name: 'Air Defence Group',
    ships: [
      { cls: 'ddg', modules: ['sam', 'sam', 'laser', 'ciws', 'fire', 'search'] },
      { cls: 'ddg', modules: ['cruise', 'cruise', 'skimmer', 'naval', 'ciws', 'noise'] },
      { cls: 'ffg', modules: ['skimmer', 'sam', 'ciws', 'naval'] },
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
  },
  carrier: {
    name: 'Drone Carrier Group',
    ships: [
      { cls: 'ddg', modules: ['helo', 'drone', 'strike', 'sam', 'ciws', 'search'] },
      { cls: 'ffg', modules: ['strike', 'sam', 'ciws', 'sonar'] },
      { cls: 'ffg', modules: ['helo', 'asw', 'sam', 'noise'] },
      { cls: 'fac', modules: ['skimmer', 'autocannon'] },
    ],
  },
  strike: {
    name: 'Long-Range Strike',
    ships: [
      { cls: 'ddg', modules: ['cruise', 'cruise', 'cruise', 'early', 'sam', 'ciws'] },
      { cls: 'ffg', modules: ['railgun', 'search', 'sam', 'ciws'] },
      { cls: 'ffg', modules: ['railgun', 'noise', 'sam', 'ciws'] },
      { cls: 'fac', modules: ['cruise', 'decoy'] },
    ],
  },
};

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function shipCost(d) {
  return (HULLS[d.cls]?.cost || 0) + d.modules.reduce((a, m) => a + (MODULES[m]?.cost || 0), 0);
}

export function fleetCost(f) {
  return f.ships.reduce((a, d) => a + shipCost(d), 0);
}

// Clean up anything malformed (also used on designs received over the network).
export function validateFleet(f, side = 'blue') {
  if (!f || !Array.isArray(f.ships)) return null;
  const ships = [];
  for (const d of f.ships.slice(0, MAX_SHIPS)) {
    if (!d || !HULLS[d.cls]) continue;
    const mods = [];
    for (const m of Array.isArray(d.modules) ? d.modules : []) {
      if (!MODULES[m] || !moduleFits(d.cls, m)) continue;
      if (MODULES[m].unique && mods.includes(m)) continue;
      if (mods.length >= HULLS[d.cls].slots) break;
      mods.push(m);
    }
    ships.push({ cls: d.cls, modules: mods, name: typeof d.name === 'string' ? d.name.slice(0, 16) : '' });
  }
  if (!ships.length) return null;
  const out = { ships };
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
  let budget = BUDGET - ships.reduce((a, d) => a + HULLS[d.cls].cost, 0);
  const fit = (d, m) => {
    if (d.modules.length >= HULLS[d.cls].slots || MODULES[m].cost > budget) return;
    if (MODULES[m].unique && d.modules.includes(m)) return;
    if (!moduleFits(d.cls, m)) return;
    d.modules.push(m);
    budget -= MODULES[m].cost;
  };
  // every ship gets a missile battery; then a role-flavoured second pass
  for (const d of ships) fit(d, d.cls === 'ssk' ? 'torpedo' : pick(['skimmer', 'skimmer', 'supersonic', 'cruise']));
  for (const d of ships) {
    const wants =
      d.cls === 'ssk'
        ? [pick(['torpedo', 'skimmer', 'supersonic']), pick(['decoy', 'cruise'])]
        : d.cls === 'fac'
        ? [pick(['autocannon', 'decoy', 'skimmer', 'supersonic'])]
        : [pick(['sam', 'sam', 'laser']), pick(['ciws', 'autocannon']), pick(['search', 'fire', 'early', 'noise', 'barrage', 'sonar']), pick(['naval', 'railgun', 'skimmer', 'noise', 'helo', 'drone', 'strike']), pick(['sam', 'asw', 'sonar']), pick(['search', 'cruise', 'decoy'])];
    for (const m of wants) fit(d, m);
  }
  return validateFleet({ ships }, side);
}

// Aircraft carry their own fixed fit.
const AIR_FIT = {
  helo: { radars: [{ name: 'Helo Radar', range: 2600, period: 2, ident: 0.7 }], ammo: { light: 2 }, sonar: SONAR_TYPES.dipping },
  drone: { radars: [{ name: 'Drone Radar', range: 4800, period: 2, ident: 0.45 }], ammo: {}, sonar: null },
  strike: { radars: [{ name: 'Strike Radar', range: 2500, period: 2.5, ident: 0.5 }], ammo: { skimmer: 2 }, sonar: null },
  fighter: { radars: [{ name: 'Fighter Radar', range: 4200, period: 1.5, ident: 0.6 }], ammo: { aam: 4 }, sonar: null },
  jet: { radars: [{ name: 'Attack Radar', range: 3600, period: 2, ident: 0.5 }], ammo: { skimmer: 2 }, sonar: null },
  mpa: { radars: [{ name: 'Patrol Radar', range: 6500, period: 3, ident: 0.35 }], ammo: { light: 4 }, sonar: { name: 'Sonobuoys', passive: 2600, active: 0, ident: 0.5, cooldown: 99 } },
  aew: { radars: [{ name: 'AEW Radar', range: 11000, period: 4, ident: 0.25 }], ammo: {}, sonar: null },
};

// Stats for one ship design: the hull's values plus its modules.
export function buildSpec(cls, modules = []) {
  const base = CLASSES[cls];
  const n = (m) => modules.filter((x) => x === m).length;
  const air = AIR_FIT[cls];
  const radars = air ? air.radars : [RADAR_TYPES.nav, ...['search', 'early', 'fire'].filter((r) => n(r)).map((r) => RADAR_TYPES[r])];
  const jammers = ['noise', 'barrage'].filter((j) => n(j)).map((j) => ({ key: j, ...JAMMER_TYPES[j] }));
  const ammo = {
    skimmer: 4 * n('skimmer') + (air?.ammo.skimmer || 0),
    supersonic: 2 * n('supersonic'),
    cruise: 2 * n('cruise'),
    heavy: 4 * n('torpedo'),
    light: 4 * n('asw') + (air?.ammo.light || 0),
    aam: air?.ammo.aam || 0,
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
    sonar: air ? air.sonar : cls === 'ssk' ? SONAR_TYPES.hull : n('sonar') ? SONAR_TYPES.array : null,
    aircraft: modules.filter((m) => m === 'helo' || m === 'drone' || m === 'strike'),
    maxRange: Math.max(0, ...Object.keys(MISSILE_TYPES).filter((k) => ammo[k] > 0).map((k) => MISSILE_TYPES[k].range)),
    modules: modules.slice(),
  };
}
