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
    shapeIsland(isl);
    const R = isl.rmax;
    const clear =
      laneDistance(lane, isl.x, isl.z) > R + 380 &&
      Math.hypot(isl.x - cp.x, isl.z - cp.z) > R + cp.r + 280 &&
      Math.hypot(isl.x, isl.z - half) > R + 1500 &&
      Math.hypot(isl.x, isl.z + half) > R + 1500 &&
      islands.every((o) => Math.hypot(o.x - isl.x, o.z - isl.z) > o.rmax + R + 320);
    if (clear) islands.push(isl);
  }
  return { seed, lane, cp, islands };
}

// An irregular coastline: the radius changes with bearing (a sum of a few
// seeded harmonics), so no island is a circle. Pure function of the seed, so
// host and guest agree.
export function shapeIsland(isl) {
  const rnd = mulberry32(isl.seed);
  const r = (a, b) => a + rnd() * (b - a);
  isl.coast = [
    { n: 1, a: r(0.04, 0.12), p: r(0, 6.3) },
    { n: 2, a: r(0.12, 0.3), p: r(0, 6.3) },
    { n: 3, a: r(0.05, 0.16), p: r(0, 6.3) },
    { n: 5, a: r(0.02, 0.08), p: r(0, 6.3) },
    { n: 8, a: r(0.02, 0.05), p: r(0, 6.3) },
    { n: 13, a: r(0.01, 0.03), p: r(0, 6.3) },
  ];
  // relief: a few peaks and a ridge, so the hills are not one dome
  isl.relief = [];
  for (let k = 0; k < 4; k++) isl.relief.push({ fx: (r(2, 5) * (k + 1)) / isl.r, fz: (r(2, 5) * (k + 1)) / isl.r, px: r(0, 6.3), pz: r(0, 6.3), a: r(0.18, 0.3) / (k + 1) });
  isl.peak = { x: r(-0.25, 0.25) * isl.r, z: r(-0.25, 0.25) * isl.r };
  isl.rmax = isl.r * (1 + isl.coast.reduce((a, c) => a + c.a, 0));
  return isl;
}

// Coast radius of an island toward the direction (dx, dz) from its centre.
export function islandRadius(isl, dx, dz) {
  if (!isl.coast) shapeIsland(isl);
  const t = Math.atan2(dz, dx);
  let k = 1;
  for (const c of isl.coast) k += c.a * Math.cos(c.n * t + c.p);
  return isl.r * Math.max(0.4, k);
}

// Signed terrain height of one island: above 0 on land, dipping under the
// sea just past the shore (the renderer uses the underwater part).
export function islandTerrain(isl, x, z) {
  const dx = x - isl.x;
  const dz = z - isl.z;
  const R = islandRadius(isl, dx, dz);
  const k = Math.hypot(dx, dz) / R;
  if (k >= 1) return -Math.min(14, (k - 1) * 60);
  // peak sits off centre
  const px = dx - isl.peak.x * (1 - k);
  const pz = dz - isl.peak.z * (1 - k);
  const kp = Math.min(1, Math.hypot(px, pz) / R);
  // ridged noise: sharp crests and gullies instead of a smooth dome
  let rough = 0.75;
  for (const f of isl.relief) rough += f.a * (1 - 2 * Math.abs(Math.sin(x * f.fx + f.px) * Math.sin(z * f.fz + f.pz)));
  rough = Math.max(0.35, rough);
  const base = Math.pow(1 - kp * kp, 0.9);
  // a low shelf of beach before the hills start
  const shore = Math.min(1, k < 0.85 ? 1 : (1 - k) / 0.15);
  return Math.max(0.6, isl.h * base * rough * 1.05) * shore;
}

// Terrain height at a point (0 on open water).
export function islandHeight(map, x, z) {
  let h = 0;
  for (const i of map.islands) {
    if (!i.coast) shapeIsland(i);
    const dx = x - i.x;
    const dz = z - i.z;
    if (dx * dx + dz * dz > i.rmax * i.rmax) continue;
    h = Math.max(h, islandTerrain(i, x, z));
  }
  return h;
}

// Does any island block the straight line between two points?
export function lineBlocked(map, x1, z1, x2, z2) {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const L2 = vx * vx + vz * vz || 1;
  const L = Math.sqrt(L2);
  for (const i of map.islands) {
    if (!i.coast) shapeIsland(i);
    const t = Math.max(0, Math.min(1, ((i.x - x1) * vx + (i.z - z1) * vz) / L2));
    const px = x1 + vx * t - i.x;
    const pz = z1 + vz * t - i.z;
    const R = i.rmax * 0.85;
    const dc2 = px * px + pz * pz;
    if (dc2 > R * R) continue;
    // walk the chord through the island's bounding circle
    const half = Math.sqrt(R * R - dc2) / L;
    const a = Math.max(0, t - half);
    const b = Math.min(1, t + half);
    const n = Math.max(2, Math.ceil(((b - a) * L) / 30));
    for (let k = 0; k <= n; k++) {
      const u = a + ((b - a) * k) / n;
      const qx = x1 + vx * u - i.x;
      const qz = z1 + vz * u - i.z;
      if (qx * qx + qz * qz < (islandRadius(i, qx, qz) * 0.85) ** 2) return true;
    }
  }
  return false;
}
