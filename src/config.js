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

export const CLASSES = {
  ddg: {
    label: 'Destroyer',
    short: 'DDG',
    len: 62,
    beam: 8,
    maxSpeed: 16,
    accel: 1.3,
    turnRate: 0.13,
    hp: 100,
    radar: 4600,
    ssm: 8,
    sam: 12,
    samReload: 1.5,
    chaff: 4,
    gun: { range: 1600, reload: 1.0, dmg: 4, speed: 430, spread: 0.022 },
    ciws: 2,
    ciwsPk: 0.6,
    vls: [18, -10], // local z offsets of launch cells (bow and aft)
  },
  ffg: {
    label: 'Frigate',
    short: 'FFG',
    len: 48,
    beam: 6.5,
    maxSpeed: 17,
    accel: 1.5,
    turnRate: 0.16,
    hp: 70,
    radar: 4000,
    ssm: 4,
    sam: 6,
    samReload: 2.2,
    chaff: 3,
    gun: { range: 1400, reload: 1.4, dmg: 4, speed: 410, spread: 0.026 },
    ciws: 1,
    ciwsPk: 0.5,
    vls: [12],
  },
  fac: {
    label: 'Missile Boat',
    short: 'FAC',
    len: 26,
    beam: 4.5,
    maxSpeed: 26,
    accel: 2.6,
    turnRate: 0.24,
    hp: 34,
    radar: 3300,
    ssm: 4,
    sam: 0,
    samReload: 99,
    chaff: 2,
    gun: { range: 1000, reload: 0.55, dmg: 2, speed: 380, spread: 0.03 },
    ciws: 1,
    ciwsPk: 0.35,
    vls: [-6],
  },
};

export const WEAPONS = {
  ssm: {
    speed: 175,
    range: 4200,
    turn: 0.85,
    dmg: 34,
    cruiseAlt: 7,
    terminalAlt: 3.5,
    terminalRange: 520,
  },
  sam: { speed: 360, range: 1500, turn: 4.0, pk: 0.5, life: 6.5 },
  ciws: { range: 230 },
  chaff: { seduce: 0.4, radius: 1500, life: 7, cooldown: 9 },
};

// Sensors and electronic warfare.
export const SENSORS = {
  visual: 1300, // lookouts / IR: always works, radar or not
  esmFactor: 1.6, // passive ESM hears a radar this many times its own range
  jamEsm: 9000, // a jammer is heard from very far away
  jamFactor: 0.55, // jamming shrinks enemy radar range to this fraction...
  burnThrough: 1500, // ...but never below this (radar burns through)
  esmError: 0.12, // ESM position error as a fraction of distance
  seeker: 1700, // missile seeker acquisition range
  seekerJammed: 950, // seeker range against a jamming target
  breakLock: 0.22, // chance a jammer breaks a seeker's lock once it acquires
};

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
