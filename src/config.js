// Game tuning. Distances are in world units (roughly metres, with ranges
// compressed so engagements stay casual and fast).

export const WORLD = {
  radius: 9000, // playable area radius
  gravity: 60, // shell gravity (exaggerated for visible arcs)
};

export const SPEED_LEVELS = [
  { key: 'STOP', f: 0 },
  { key: 'SLOW', f: 0.3 },
  { key: 'HALF', f: 0.55 },
  { key: 'FULL', f: 0.8 },
  { key: 'FLANK', f: 1.0 },
];

export const KNOTS = 1.9; // display factor: knots per world unit/sec

// Hulls. Weapons and sensors come from fitted modules (src/fleet.js).
export const CLASSES = {
  // noise: how loud the hull is to passive sonar (scaled by speed)
  ddg: { label: 'Destroyer', short: 'DDG', len: 62, beam: 8, maxSpeed: 16, accel: 1.3, turnRate: 0.13, hp: 100, chaff: 4, vls: [18, -10], noise: 1.0 },
  ffg: { label: 'Frigate', short: 'FFG', len: 48, beam: 6.5, maxSpeed: 18, accel: 1.5, turnRate: 0.16, hp: 70, chaff: 3, vls: [12], noise: 0.9 },
  fac: { label: 'Corvette', short: 'FAC', len: 26, beam: 4.5, maxSpeed: 26, accel: 2.6, turnRate: 0.24, hp: 36, chaff: 2, vls: [-6], noise: 0.8 },
  ssk: { label: 'Submarine', short: 'SSK', len: 56, beam: 7, maxSpeed: 13, accel: 1.0, turnRate: 0.12, hp: 60, chaff: 2, vls: [6], noise: 0.6, sub: true },
  // aircraft (launched from deck modules)
  helo: { label: 'ASW Helicopter', short: 'HELO', len: 14, beam: 3, maxSpeed: 45, accel: 10, turnRate: 0.9, hp: 12, chaff: 0, vls: [0], noise: 0, air: true, alt: 60 },
  drone: { label: 'Recon Drone', short: 'UAV', len: 9, beam: 12, maxSpeed: 70, accel: 12, turnRate: 0.45, hp: 8, chaff: 0, vls: [0], noise: 0, air: true, alt: 180 },
  strike: { label: 'Strike Drone', short: 'UCAV', len: 12, beam: 15, maxSpeed: 85, accel: 14, turnRate: 0.4, hp: 10, chaff: 0, vls: [0], noise: 0, air: true, alt: 140 },
  // civilians on the shipping lane
  cargo: { label: 'Container Ship', short: 'CIV', len: 110, beam: 16, maxSpeed: 9, accel: 0.4, turnRate: 0.05, hp: 60, chaff: 0, vls: [0], civ: true, noise: 1.3 },
  tanker: { label: 'Tanker', short: 'CIV', len: 128, beam: 19, maxSpeed: 8, accel: 0.35, turnRate: 0.045, hp: 75, chaff: 0, vls: [0], civ: true, noise: 1.4 },
};

// Anti-ship missiles. `defense` scales how easily SAMs/CIWS kill them.
export const MISSILE_TYPES = {
  skimmer: { name: 'Sea-Skimmer', short: 'SKM', speed: 175, range: 4200, dmg: 34, turn: 0.85, cruiseAlt: 7, terminalAlt: 3.5, terminalRange: 520, weave: 0.22, defense: 1.0 },
  supersonic: { name: 'Supersonic', short: 'SSN', speed: 330, range: 3300, dmg: 44, turn: 1.1, cruiseAlt: 10, terminalAlt: 4, terminalRange: 700, weave: 0, defense: 0.45 },
  cruise: { name: 'Cruise Missile', short: 'CRU', speed: 140, range: 7500, dmg: 38, turn: 0.7, cruiseAlt: 70, terminalAlt: 4, terminalRange: 950, weave: 0.1, defense: 1.25 },
};
// Order the fire command picks missile types in (first that can reach).
export const MISSILE_PREFERENCE = ['supersonic', 'skimmer', 'cruise'];

// Torpedoes run underwater: SAMs, CIWS and lasers can't touch them; decoys can.
export const TORPEDO_TYPES = {
  heavy: { name: 'Heavy Torpedo', short: 'TRP', speed: 45, range: 3600, dmg: 55, seek: 750 },
  light: { name: 'ASW Torpedo', short: 'ASW', speed: 55, range: 2800, dmg: 34, seek: 650 },
};

// Sonar: passive hears units by noise; active pings reveal everything nearby
// exactly, but give the pinging unit away.
export const SONAR_TYPES = {
  hull: { name: 'Submarine Sonar', passive: 4200, active: 3800, ident: 0.3, cooldown: 20 },
  array: { name: 'Sonar Array', passive: 3400, active: 3400, ident: 0.3, cooldown: 20 },
  dipping: { name: 'Dipping Sonar', passive: 0, active: 2400, ident: 1, cooldown: 12 },
};

export const GUN_TYPES = {
  autocannon: { name: '57mm Autocannon', range: 1000, reload: 0.32, dmg: 1.3, speed: 520, spread: 0.03, g: 1, antiMissile: { range: 650, pk: 0.5 } },
  naval: { name: '127mm Gun', range: 1700, reload: 1.1, dmg: 5, speed: 430, spread: 0.022, g: 1 },
  railgun: { name: 'Railgun', range: 3200, reload: 4.5, dmg: 16, speed: 1300, spread: 0.006, g: 0.12 },
};

// Radars ping every `period` seconds out to `range`. Contacts inside
// range * ident are identified; the rest are unknown blips.
export const RADAR_TYPES = {
  nav: { name: 'Navigation Radar', range: 2000, period: 2.5, ident: 0.6 },
  search: { name: 'Search Radar', range: 5200, period: 3, ident: 0.4 },
  early: { name: 'Early-Warning Radar', range: 8000, period: 5, ident: 0.22 },
  fire: { name: 'Fire-Control Radar', range: 3600, period: 1, ident: 1 },
};

// Jammers are cast: a cone aimed at a point that blinds enemy radars and
// missile seekers inside it for a few seconds.
export const JAMMER_TYPES = {
  noise: { name: 'Noise Jammer', half: 0.2, range: 7000, duration: 10, cooldown: 30 },
  barrage: { name: 'Barrage Jammer', half: 0.62, range: 4000, duration: 8, cooldown: 32 },
};

export const WEAPONS = {
  sam: { speed: 360, range: 1500, turn: 4.0, pk: 0.5, life: 6.5 },
  ciws: { range: 230 },
  laser: { range: 700, rate: 1.0 },
  chaff: { seduce: 0.4, radius: 1500, life: 7, cooldown: 9 },
};

export const SENSORS = {
  visual: 1300, // lookouts: identify anything this close with line of sight
  counter: 1.3, // a radiating radar is detected out to this many times its range
  contactLife: 10, // seconds an un-refreshed contact stays on the plot
  seeker: 1700, // missile seeker turns on this far from its aim point
  seekerSearch: 700, // and locks the ship nearest the aim point within this
};

export const CONTROL = { radius: 650, capture: 12, win: 300 };

// Starting formation offsets (lateral x, forward z) relative to the flagship.
export const FORMATION = [
  [0, 0],
  [-260, -120],
  [260, -120],
  [0, 300],
  [-420, 180],
  [420, 180],
];

export const START_DISTANCE = 6400;

// Ocean waves. Shared by the GPU shader and the CPU (ship bobbing).
export const WAVES = [
  // Several trains with unrelated wavelengths and directions so the swell
  // never forms a visible repeating pattern.
  { dir: [1.0, 0.35], amp: 0.72, len: 151 },
  { dir: [0.55, 1.0], amp: 0.44, len: 97 },
  { dir: [-0.45, 1.0], amp: 0.3, len: 61 },
  { dir: [1.0, -0.75], amp: 0.2, len: 43 },
  { dir: [-0.9, 0.3], amp: 0.15, len: 33 },
  { dir: [0.2, -1.0], amp: 0.11, len: 23.7 },
  { dir: [0.8, 0.9], amp: 0.08, len: 17.3 },
];
