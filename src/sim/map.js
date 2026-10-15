// Seeded random battlefield: a shipping lane, a control point and islands.
// Host and guest generate the same map from the same seed.
import { CONTROL, START_DISTANCE } from '../config.js';

export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distance from point to the infinite lane line.
export function laneDistance(lane, x, z) {
  return Math.abs((x - lane.ax) * lane.nz - (z - lane.az) * lane.nx);
}

export function generateMap(seed = Math.floor(Math.random() * 1e9)) {
  const rnd = mulberry32(seed);
  const r = (a, b) => a + rnd() * (b - a);
  const half = START_DISTANCE / 2;

  // Shipping lane: crosses the map side to side between the fleets.
  const ang = r(-0.3, 0.3);
  const off = r(-1300, 1300);
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const L = 10500;
  const lane = {
    ax: -dx * L,
    az: off - dz * L,
    bx: dx * L,
    bz: off + dz * L,
    nx: dx, // unit direction
    nz: dz,
    width: 260,
  };

  // Control point: near the middle, off the lane.
  let cp = null;
  for (let i = 0; i < 60 && !cp; i++) {
    const c = { x: r(-1800, 1800), z: r(-900, 900), r: CONTROL.radius };
    if (laneDistance(lane, c.x, c.z) > c.r + 450) cp = c;
  }
  if (!cp) cp = { x: 0, z: off > 0 ? -1400 : 1400, r: CONTROL.radius };

  // Islands: in the band between the fleets, clear of spawns, lane and point.
  const islands = [];
  const want = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < 400 && islands.length < want; i++) {
    const isl = { x: r(-6500, 6500), z: r(-half + 900, half - 900), r: r(260, 720) };
    isl.h = isl.r * r(0.22, 0.42);
    isl.seed = Math.floor(rnd() * 1e6);
    const clear =
      laneDistance(lane, isl.x, isl.z) > isl.r + 380 &&
      Math.hypot(isl.x - cp.x, isl.z - cp.z) > isl.r + cp.r + 280 &&
      Math.hypot(isl.x, isl.z - half) > isl.r + 1500 &&
      Math.hypot(isl.x, isl.z + half) > isl.r + 1500 &&
      islands.every((o) => Math.hypot(o.x - isl.x, o.z - isl.z) > o.r + isl.r + 320);
    if (clear) islands.push(isl);
  }
  return { seed, lane, cp, islands };
}

// Terrain height at a point (0 on open water).
export function islandHeight(map, x, z) {
  let h = 0;
  for (const i of map.islands) {
    const d = Math.hypot(x - i.x, z - i.z);
    if (d < i.r) h = Math.max(h, i.h * Math.pow(1 - (d / i.r) ** 2, 0.7));
  }
  return h;
}

// Does any island block the straight line between two points?
export function lineBlocked(map, x1, z1, x2, z2) {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const L2 = vx * vx + vz * vz || 1;
  for (const i of map.islands) {
    const t = Math.max(0, Math.min(1, ((i.x - x1) * vx + (i.z - z1) * vz) / L2));
    const px = x1 + vx * t - i.x;
    const pz = z1 + vz * t - i.z;
    if (px * px + pz * pz < (i.r * 0.82) ** 2) return true;
  }
  return false;
}
