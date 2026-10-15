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

// Distance from a point to the shipping lane (a bent polyline).
export function laneDistance(lane, x, z) {
  let best = Infinity;
  const P = lane.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(a.x + vx * t - x, a.z + vz * t - z));
  }
  return best;
}

// The lane as waypoints for traffic going one way (dir +1: first point to
// last), offset to the right of the centre line like a traffic separation
// scheme.
export function lanePath(lane, dir, off = 110) {
  const P = dir > 0 ? lane.pts : lane.pts.slice().reverse();
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(P.length - 1, i + 1)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const tx = (b.x - a.x) / L;
    const tz = (b.z - a.z) / L;
    return { x: p.x + tz * off, z: p.z - tx * off };
  });
}

// Point at fraction t (0..1, by length) along a path; also the index of the
// next vertex.
export function pathPoint(path, t) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const L = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    seg.push(L);
    total += L;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = Math.min(1, d / (seg[i] || 1));
      return { x: path[i].x + (path[i + 1].x - path[i].x) * k, z: path[i].z + (path[i + 1].z - path[i].z) * k, next: i + 1 };
    }
    d -= seg[i];
  }
  return { x: path[0].x, z: path[0].z, next: 1 };
}

export function generateMap(seed = Math.floor(Math.random() * 1e9)) {
  const rnd = mulberry32(seed);
  const r = (a, b) => a + rnd() * (b - a);
  const half = START_DISTANCE / 2;

  // Control point: near the middle.
  const cp = { x: r(-1600, 1600), z: r(-700, 700), r: CONTROL.radius };

  // Shipping lane: crosses the map side to side, alters course at a few
  // turning points, and runs straight through the control point.
  const flip = rnd() < 0.5 ? -1 : 1;
  const pts = [{ x: -10500 * flip, z: r(-1500, 1500) }];
  for (const x of [-6500, -3200]) pts.push({ x: x * flip, z: r(-1400, 1400) });
  pts.push({ x: cp.x, z: cp.z });
  for (const x of [3400, 6800]) pts.push({ x: x * flip + cp.x * 0.3, z: r(-1400, 1400) });
  pts.push({ x: 10500 * flip, z: r(-1500, 1500) });
  // keep turns gentle: no leg may bend more than ~40 degrees
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].x === cp.x && pts[i].z === cp.z) continue;
    const a = pts[i - 1];
    const b = pts[i + 1];
    pts[i].z = pts[i].z * 0.6 + ((a.z + b.z) / 2) * 0.4;
  }
  const lane = { pts, width: 260 };

  // Islands. They matter: a few flank the control point so the fight there
  // happens among them, and the rest form channels across the middle where
  // the fleets must pass. Land masks radar and stops sea-skimmers.
  const islands = [];
  const fits = (isl) => {
    const R = isl.rmax;
    return (
      laneDistance(lane, isl.x, isl.z) > R + 330 &&
      Math.hypot(isl.x - cp.x, isl.z - cp.z) > R + cp.r + 120 &&
      Math.hypot(isl.x, isl.z - half) > R + 1300 &&
      Math.hypot(isl.x, isl.z + half) > R + 1300 &&
      islands.every((o) => Math.hypot(o.x - isl.x, o.z - isl.z) > o.rmax + R + 260)
    );
  };
  const make = (x, z, rr) => {
    const isl = { x, z, r: rr };
    isl.h = isl.r * r(0.24, 0.45);
    isl.seed = Math.floor(rnd() * 1e6);
    return shapeIsland(isl);
  };
  // around the point
  const nearCp = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < 200 && islands.length < nearCp; i++) {
    const ang = r(0, Math.PI * 2);
    const rr = r(240, 520);
    const d = cp.r + rr * 1.25 + r(140, 520);
    const isl = make(cp.x + Math.cos(ang) * d, cp.z + Math.sin(ang) * d, rr);
    if (fits(isl)) islands.push(isl);
  }
  // channels across the middle, mostly between the fleets
  const want = islands.length + 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < 400 && islands.length < want; i++) {
    const wide = i > 200;
    const isl = make(r(wide ? -6500 : -4200, wide ? 6500 : 4200), r(-half + 700, half - 700), r(280, 760));
    if (fits(isl)) islands.push(isl);
  }
  // a scatter of rocks and islets
  for (let i = 0; i < 200 && islands.length < want + 3; i++) {
    const isl = make(r(-6000, 6000), r(-half + 500, half - 500), r(90, 170));
    if (fits(isl)) islands.push(isl);
  }
  return { seed, lane, cp, islands };
}

// Within `margin` of any coast? Ships close inshore hide in radar land
// clutter.
export function nearCoast(map, x, z, margin) {
  for (const i of map.islands) {
    if (!i.coast) shapeIsland(i);
    const dx = x - i.x;
    const dz = z - i.z;
    const d2 = dx * dx + dz * dz;
    const R = i.rmax + margin;
    if (d2 > R * R) continue;
    if (Math.sqrt(d2) < islandRadius(i, dx, dz) + margin) return true;
  }
  return false;
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
