// Fleet design: hulls, fittable modules, points budget and the function
// that turns a design into the stats the simulation uses.
import { CLASSES } from './config.js';

export const BUDGET = 1400;
export const MAX_SHIPS = 6;

export const HULLS = {
  fac: { name: 'Corvette', size: 'Small', cost: 60, slots: 4, blurb: 'Fast, cheap and fragile. A missile carrier for wolfpacks.' },
  ffg: { name: 'Frigate', size: 'Medium', cost: 120, slots: 6, blurb: 'Balanced escort. Good speed with room for a real loadout.' },
  ddg: { name: 'Destroyer', size: 'Large', cost: 200, slots: 8, blurb: 'Big, tough flagship hull. Slow to turn, carries the most.' },
};

// Every module fills one slot.
export const MODULES = {
  ssm: { name: 'Anti-Ship Missiles', short: 'SSM ×4', cat: 'weapons', cost: 50, desc: '+4 sea-skimming anti-ship missiles.' },
  gun: { name: 'Naval Gun', short: 'GUN', cat: 'weapons', cost: 30, desc: 'Fits a main gun. Each extra one fires 35% faster.' },
  sam: { name: 'SAM Cells', short: 'SAM ×6', cat: 'defense', cost: 45, desc: '+6 area air-defence missiles. Needs radar on.' },
  ciws: { name: 'CIWS Mount', short: 'CIWS', cat: 'defense', cost: 30, desc: 'Last-ditch gatling gun against missiles.' },
  chaff: { name: 'Decoy Launcher', short: 'CHAFF ×3', cat: 'defense', cost: 10, desc: '+3 chaff salvos to seduce missiles.' },
  armor: { name: 'Armour Belt', short: 'ARMOUR', cat: 'defense', cost: 35, desc: '+30% hull strength.' },
  radar: { name: 'Long-Range Radar', short: 'RADAR+', cat: 'sensors', cost: 30, desc: '+35% radar range (also louder on enemy ESM).', unique: true },
  esm: { name: 'ESM Suite', short: 'ESM+', cat: 'sensors', cost: 20, desc: 'Hears enemy radars and jammers 40% farther away.', unique: true },
  jammer: { name: 'Jammer', short: 'JAMMER', cat: 'sensors', cost: 40, desc: 'Allows jamming: shrinks enemy radar range, spoofs seekers.', unique: true },
  engine: { name: 'Gas Turbines', short: 'ENGINE', cat: 'mobility', cost: 20, desc: '+12% top speed and acceleration.' },
};

export const CATEGORIES = [
  ['weapons', 'Weapons'],
  ['defense', 'Defence'],
  ['sensors', 'Sensors & EW'],
  ['mobility', 'Mobility'],
];

const NAMES = {
  blue: {
    ddg: ['Valiant', 'Resolute', 'Dauntless', 'Intrepid', 'Vigilant', 'Sovereign'],
    ffg: ['Kestrel', 'Osprey', 'Merlin', 'Harrier', 'Peregrine', 'Goshawk'],
    fac: ['Stiletto', 'Rapier', 'Dirk', 'Cutlass', 'Sabre', 'Lancet'],
  },
  red: {
    ddg: ['Dominion', 'Tempest', 'Colossus', 'Imperator', 'Bastion', 'Leviathan'],
    ffg: ['Ardent', 'Fury', 'Vigil', 'Zealot', 'Wrath', 'Rampart'],
    fac: ['Viper', 'Adder', 'Krait', 'Mamba', 'Asp', 'Cobra'],
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
      { cls: 'ddg', modules: ['ssm', 'ssm', 'sam', 'sam', 'ciws', 'ciws', 'gun', 'jammer'] },
      { cls: 'ffg', modules: ['ssm', 'sam', 'ciws', 'gun', 'jammer', 'chaff'] },
      { cls: 'ffg', modules: ['ssm', 'sam', 'ciws', 'gun', 'jammer', 'chaff'] },
      { cls: 'fac', modules: ['ssm', 'gun', 'ciws', 'engine'] },
    ],
  },
  wolfpack: {
    name: 'Wolfpack',
    ships: [
      { cls: 'ffg', modules: ['sam', 'sam', 'ciws', 'radar', 'esm', 'jammer'] },
      { cls: 'fac', modules: ['ssm', 'ssm', 'engine', 'chaff'] },
      { cls: 'fac', modules: ['ssm', 'ssm', 'engine', 'chaff'] },
      { cls: 'fac', modules: ['ssm', 'ssm', 'engine', 'chaff'] },
      { cls: 'fac', modules: ['ssm', 'ssm', 'engine', 'chaff'] },
    ],
  },
  shield: {
    name: 'Air Defence Group',
    ships: [
      { cls: 'ddg', modules: ['sam', 'sam', 'sam', 'ciws', 'ciws', 'radar', 'esm', 'ssm'] },
      { cls: 'ddg', modules: ['ssm', 'ssm', 'ssm', 'sam', 'ciws', 'gun', 'armor', 'jammer'] },
      { cls: 'ffg', modules: ['ssm', 'sam', 'ciws', 'gun', 'jammer', 'chaff'] },
    ],
  },
  stealth: {
    name: 'Silent Hunters',
    ships: [
      { cls: 'ffg', modules: ['ssm', 'ssm', 'esm', 'ciws', 'chaff', 'engine'] },
      { cls: 'ffg', modules: ['ssm', 'ssm', 'esm', 'ciws', 'chaff', 'engine'] },
      { cls: 'ffg', modules: ['ssm', 'sam', 'radar', 'jammer', 'ciws', 'gun'] },
      { cls: 'fac', modules: ['ssm', 'esm', 'engine', 'gun'] },
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
      if (!MODULES[m]) continue;
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
    ['ffg', 'ffg', 'ffg', 'fac'],
    ['ffg', 'fac', 'fac', 'fac', 'fac'],
    ['ddg', 'fac', 'fac', 'fac'],
  ];
  const hulls = plans[Math.floor(Math.random() * plans.length)];
  const ships = hulls.map((cls) => ({ cls, modules: [] }));
  let budget = BUDGET - ships.reduce((a, d) => a + HULLS[d.cls].cost, 0);
  // Everyone gets missiles and a gun first, then weighted extras.
  const want = ['ssm', 'gun', 'ciws', 'sam', 'ssm', 'jammer', 'chaff', 'sam', 'radar', 'esm', 'armor', 'engine', 'ssm', 'ciws'];
  for (const m of want) {
    for (const d of ships) {
      const cost = MODULES[m].cost;
      if (d.modules.length >= HULLS[d.cls].slots || cost > budget) continue;
      if (MODULES[m].unique && d.modules.includes(m)) continue;
      if (m === 'sam' && d.cls === 'fac') continue;
      if (Math.random() < 0.25 && m !== 'ssm') continue;
      d.modules.push(m);
      budget -= cost;
    }
  }
  return validateFleet({ ships }, side);
}

// Stats for one ship design: the hull's class values plus its modules.
export function buildSpec(cls, modules = []) {
  const base = CLASSES[cls];
  const n = (m) => modules.filter((x) => x === m).length;
  const guns = n('gun');
  const engines = n('engine');
  const speed = Math.pow(1.12, engines);
  return {
    ...base,
    hp: Math.round(base.hp * (1 + 0.3 * n('armor'))),
    ssm: 4 * n('ssm'),
    sam: 6 * n('sam'),
    chaff: { fac: 1, ffg: 2, ddg: 2 }[cls] + 3 * n('chaff'),
    ciws: n('ciws'),
    ciwsPk: 0.35 * n('ciws'),
    gun: guns ? { ...base.gun, reload: base.gun.reload * Math.pow(0.65, guns - 1) } : null,
    radar: base.radar * (n('radar') ? 1.35 : 1),
    esm: n('esm') ? 1.4 : 1,
    canJam: n('jammer') > 0,
    maxSpeed: base.maxSpeed * speed,
    accel: base.accel * speed,
    modules: modules.slice(),
  };
}
