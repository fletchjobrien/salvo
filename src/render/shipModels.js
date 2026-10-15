// Procedural low-poly warships built from merged primitives with vertex
// colours. Flat-shaded so they read well when pixelated.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLASSES } from '../config.js';

const PALETTES = {
  blue: {
    hull: 0x8e99a3,
    deck: 0x58616a,
    sup: 0xaab4bd,
    sup2: 0x9aa4ad,
    dark: 0x1a2026,
    window: 0x10161c,
    boot: 0x15181b,
    red: 0x7b2c22,
    panel: 0x5d6770,
    pad: 0x6f7880,
    white: 0xd8dde0,
    stack: 0x2a2e33,
  },
  red: {
    hull: 0x7f8a7c,
    deck: 0x5a544b,
    sup: 0x95a093,
    sup2: 0x879285,
    dark: 0x1d211e,
    window: 0x101512,
    boot: 0x171a18,
    red: 0x6e2a24,
    panel: 0x58625a,
    pad: 0x5e5a52,
    white: 0xcfd3cc,
    stack: 0x252826,
  },
};

PALETTES.civ = {
  hull: 0x2f3f5a,
  deck: 0x6b4a3a,
  sup: 0xe6e2d8,
  sup2: 0xcfcac0,
  dark: 0x1a1d22,
  window: 0x12161b,
  boot: 0x15181b,
  red: 0x8a2f24,
  panel: 0x6f6a60,
  pad: 0x5a5a55,
  white: 0xeeeeea,
  stack: 0xb8452e,
};
const CONTAINER_COLORS = [0xb8452e, 0x2e6fb8, 0x3c8a4a, 0xd0a030, 0x8a8a88, 0x6a3fa0, 0xc06a2a];

const _c = new THREE.Color();

function colorize(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _c.set(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

class Builder {
  constructor() {
    this.parts = [];
  }
  box(w, h, d, x, y, z, color, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.parts.push(colorize(g, color));
    return this;
  }
  // Box with the top narrower than the base (sloped "stealth" sides).
  taper(w, h, d, x, y, z, color, top = 0.75, topD = 0.85) {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * top);
        p.setZ(i, p.getZ(i) * topD);
      }
    }
    g.translate(x, y, z);
    this.parts.push(colorize(g, color));
    return this;
  }
  cyl(rt, rb, h, x, y, z, color, seg = 8, rx = 0) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    this.parts.push(colorize(g, color));
    return this;
  }
  sphere(r, x, y, z, color, seg = 8) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1));
    g.translate(x, y, z);
    this.parts.push(colorize(g, color));
    return this;
  }
  add(geo) {
    this.parts.push(geo);
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    return g;
  }
}

// Hull from cross-sections. Stern at -len/2, bow at +len/2.
function hullGeometry(len, beam, free, draft, pal, opts = {}) {
  const N = 16;
  const pos = [];
  const col = [];
  const cHull = new THREE.Color(pal.hull);
  const cBoot = new THREE.Color(pal.boot);
  const cRed = new THREE.Color(pal.red);
  const cDeck = new THREE.Color(pal.deck);
  const sections = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -len / 2 + t * len;
    let hw;
    if (t < 0.12) hw = 0.42 + (t / 0.12) * 0.08;
    else if (t < 0.55) hw = 0.5;
    else hw = 0.5 * (1 - Math.pow((t - 0.55) / 0.45, 1.7));
    hw = Math.max(hw * beam, 0.02);
    const sheer = free * (1 + (opts.sheer ?? 0.4) * Math.pow(Math.max(0, (t - 0.5) / 0.5), 2));
    const d = draft * (t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.7 : t < 0.1 ? 0.7 + t * 3 : 1);
    // bow flare: deck edge wider than waterline toward the bow
    const flare = t > 0.6 ? 1.0 + (t - 0.6) * 0.25 : 1.0;
    sections.push([
      [hw * flare, sheer, z],
      [hw * 0.97, 0.7, z],
      [hw * 0.94, -0.5, z],
      [hw * 0.5, -d * 0.85, z],
      [0, -d, z],
    ]);
  }
  const tri = (a, b, c, color) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
  };
  const mirror = (p) => [-p[0], p[1], p[2]];
  const bandColor = [cHull, cBoot, cRed, cRed];
  for (let i = 0; i < N; i++) {
    const A = sections[i];
    const B = sections[i + 1];
    for (let k = 0; k < 4; k++) {
      // starboard (+x)
      tri(A[k], B[k], A[k + 1], bandColor[k]);
      tri(A[k + 1], B[k], B[k + 1], bandColor[k]);
      // port (-x): mirroring flips handedness
      tri(mirror(A[k]), mirror(A[k + 1]), mirror(B[k]), bandColor[k]);
      tri(mirror(A[k + 1]), mirror(B[k + 1]), mirror(B[k]), bandColor[k]);
    }
    // deck
    tri(A[0], mirror(A[0]), B[0], cDeck);
    tri(mirror(A[0]), mirror(B[0]), B[0], cDeck);
  }
  // transom
  const S = sections[0];
  for (let k = 0; k < 4; k++) {
    const c = k === 0 ? cHull : bandColor[k];
    tri(S[k], S[k + 1], mirror(S[k]), c);
    tri(mirror(S[k]), S[k + 1], mirror(S[k + 1]), c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return { geo: g, deckAt: (z) => sections[Math.round(((z + len / 2) / len) * N)][0][1] };
}

function turretGeometry(pal, size = 1) {
  const b = new Builder();
  b.taper(3.2 * size, 1.6 * size, 3.8 * size, 0, 0.8 * size, 0, pal.sup, 0.7, 0.75);
  b.box(0.35 * size, 0.35 * size, 1.2 * size, 0, 1.0 * size, 2.0 * size, pal.sup2);
  return b.build();
}

function barrelGeometry(pal, size = 1) {
  const b = new Builder();
  b.cyl(0.18 * size, 0.24 * size, 5.5 * size, 0, 0, 2.75 * size, pal.dark, 6, Math.PI / 2);
  return b.build();
}

function radarGeometry(pal, w = 4) {
  const b = new Builder();
  b.box(w, 0.7, 0.35, 0, 0, 0, pal.dark);
  b.box(0.3, 0.6, 0.3, 0, -0.5, 0, pal.dark);
  return b.build();
}

function ciws(b, pal, x, y, z) {
  b.cyl(0.9, 1.1, 1.0, x, y + 0.5, z, pal.sup2, 8);
  b.cyl(0.75, 0.75, 1.4, x, y + 1.7, z, pal.white, 8);
  b.sphere(0.75, x, y + 2.4, z, pal.white, 8);
  b.box(0.25, 0.25, 1.6, x, y + 1.3, z + 1.0, pal.dark);
}

function buildDDG(pal, side) {
  const c = CLASSES.ddg;
  const b = new Builder();
  const hull = hullGeometry(c.len, c.beam, 4.2, 3.2, pal);
  b.add(hull.geo);
  const deck = 4.4;
  if (side === 'blue') {
    // forward VLS
    b.box(5.0, 0.3, 6.5, 0, deck + 0.1, 18, pal.panel);
    for (let i = -2; i <= 2; i++) b.box(0.12, 0.32, 6.5, i * 0.9, deck + 0.12, 18, pal.dark);
    // main superstructure + bridge
    b.taper(7.2, 6.5, 14, 0, deck + 3.2, 5, pal.sup, 0.82, 0.88);
    b.taper(6.4, 2.6, 7, 0, deck + 7.6, 7.5, pal.sup2, 0.85, 0.85);
    b.box(6.0, 0.7, 0.4, 0, deck + 8.0, 11.1, pal.window);
    // SPY-style faces
    b.box(4.2, 3.6, 0.3, 0, deck + 5.4, 12.1, pal.panel, 0, -0.25);
    b.box(0.3, 3.6, 4.2, 3.55, deck + 5.4, 8.5, pal.panel, 0, 0, -0.25);
    b.box(0.3, 3.6, 4.2, -3.55, deck + 5.4, 8.5, pal.panel, 0, 0, 0.25);
    // mast
    b.taper(1.6, 9, 1.6, 0, deck + 13.5, 5.5, pal.sup2, 0.4, 0.4);
    b.box(7, 0.25, 0.25, 0, deck + 15.5, 5.5, pal.dark);
    b.box(0.15, 4, 0.15, 0, deck + 19.5, 5.5, pal.dark);
    // funnels
    b.taper(3.6, 5, 4.4, 0, deck + 2.5, -4.5, pal.sup2, 0.8, 0.8);
    b.box(2.6, 0.5, 3.2, 0, deck + 5.2, -4.5, pal.stack);
    b.taper(3.6, 4.6, 4.4, 0, deck + 2.3, -13.5, pal.sup2, 0.8, 0.8);
    b.box(2.6, 0.5, 3.2, 0, deck + 4.8, -13.5, pal.stack);
    // aft VLS between funnels
    b.box(5.0, 0.3, 4.5, 0, deck + 0.1, -9, pal.panel);
    // hangar + flight deck
    b.taper(7.2, 4.6, 9, 0, deck + 2.2, -20, pal.sup, 0.9, 0.95);
    b.box(6.6, 0.12, 10, 0, deck + 0.02, -27.5, pal.pad);
    b.box(0.25, 0.14, 8, 0, deck + 0.05, -27.5, pal.white);
    ciws(b, pal, 0, deck + 4.6, -18);
    ciws(b, pal, 0, deck + 6.5, 12.6);
  } else {
    // Red Pact: slab-sided, busier silhouette, deck launchers.
    b.box(6.4, 0.6, 4, 0, deck + 0.3, 20, pal.sup2);
    b.box(1.6, 1.4, 7, 2.2, deck + 1.0, 14, pal.panel, 0, 0.18);
    b.box(1.6, 1.4, 7, -2.2, deck + 1.0, 14, pal.panel, 0, 0.18);
    b.box(7.4, 6, 13, 0, deck + 3, 4, pal.sup);
    b.box(6.6, 2.4, 6, 0, deck + 7.2, 6.5, pal.sup2);
    b.box(6.2, 0.7, 0.4, 0, deck + 7.6, 9.6, pal.window);
    b.box(1.4, 11, 1.4, 0, deck + 14, 4, pal.sup2);
    b.sphere(2.2, 0, deck + 20, 4, pal.white, 10);
    b.box(6, 0.3, 0.3, 0, deck + 16.5, 4, pal.dark);
    b.box(4.5, 6, 6, 0, deck + 3, -6.5, pal.sup2);
    b.box(3.6, 1, 5, 0, deck + 6.5, -6.5, pal.stack);
    b.box(1.2, 7, 1.2, 0, deck + 9, -11, pal.sup2);
    b.box(5, 0.3, 0.3, 0, deck + 11, -11, pal.dark);
    b.box(6.8, 4, 8, 0, deck + 2, -17, pal.sup);
    b.box(6.6, 0.12, 12, 0, deck + 0.02, -26, pal.pad);
    ciws(b, pal, 2.6, deck + 4, -14);
    ciws(b, pal, -2.6, deck + 4, -14);
  }
  return { geo: b.build(), deck, gunZ: c.len * 0.3, gunSize: 1.1, radarY: deck + (side === 'blue' ? 17.8 : 23), radarZ: side === 'blue' ? 5.5 : 4, stacks: [[0, deck + 5.6, -4.5], [0, deck + 5.2, -13.5]], ciws: [[0, deck + 7, -18], [0, deck + 9, 12.6]], mastTop: [0, deck + 21.5, 5.5] };
}

function buildFFG(pal, side) {
  const c = CLASSES.ffg;
  const b = new Builder();
  const hull = hullGeometry(c.len, c.beam, 3.6, 2.6, pal, { sheer: 0.35 });
  b.add(hull.geo);
  const deck = 3.8;
  if (side === 'blue') {
    b.box(4.0, 0.3, 4, 0, deck + 0.1, 11, pal.panel);
    b.taper(6.2, 6.2, 17, 0, deck + 3.1, -1, pal.sup, 0.78, 0.9);
    b.box(5.2, 0.6, 0.3, 0, deck + 5.3, 7.3, pal.window);
    b.taper(3.2, 9, 3.6, 0, deck + 10.5, 1.5, pal.sup2, 0.35, 0.35);
    b.box(0.15, 3, 0.15, 0, deck + 16, 1.5, pal.dark);
    b.box(2.8, 1.2, 3.4, 0, deck + 6.6, -4, pal.stack);
    b.box(5.8, 0.12, 9, 0, deck + 0.02, -18.5, pal.pad);
    ciws(b, pal, 0, deck + 6.2, -8);
  } else {
    b.box(5.4, 5.6, 14, 0, deck + 2.8, 0, pal.sup);
    b.box(4.8, 2.2, 5, 0, deck + 6.6, 3.5, pal.sup2);
    b.box(4.6, 0.6, 0.3, 0, deck + 7, 6.1, pal.window);
    b.box(1.6, 1.3, 6, 1.9, deck + 1.0, 11, pal.panel, 0, 0.15);
    b.box(1.6, 1.3, 6, -1.9, deck + 1.0, 11, pal.panel, 0, 0.15);
    b.box(1.2, 9, 1.2, 0, deck + 11, 2, pal.sup2);
    b.sphere(1.6, 0, deck + 16, 2, pal.white, 8);
    b.box(3.2, 3, 4, 0, deck + 7, -4, pal.stack);
    b.box(5.8, 0.12, 9, 0, deck + 0.02, -18, pal.pad);
    ciws(b, pal, 0, deck + 5.6, -6);
  }
  return { geo: b.build(), deck, gunZ: c.len * 0.3, gunSize: 0.95, radarY: deck + (side === 'blue' ? 15.3 : 18), radarZ: side === 'blue' ? 1.5 : 2, stacks: [[0, deck + 7.4, -4]], ciws: [[0, deck + 8.6, -8]], mastTop: [0, deck + 17.5, 1.5] };
}

function buildFAC(pal, side) {
  const c = CLASSES.fac;
  const b = new Builder();
  const hull = hullGeometry(c.len, c.beam, 2.2, 1.6, pal, { sheer: 0.3 });
  b.add(hull.geo);
  const deck = 2.4;
  b.taper(3.6, 3.2, 8, 0, deck + 1.6, 1.5, pal.sup, 0.8, 0.85);
  b.box(3.2, 0.5, 0.25, 0, deck + 2.6, 5.4, pal.window);
  b.taper(1.0, 5, 1.0, 0, deck + 5.5, 0.5, pal.sup2, 0.5, 0.5);
  if (side === 'red') b.sphere(0.9, 0, deck + 8.4, 0.5, pal.white, 8);
  // missile canisters, angled outboard and up
  for (const s of [-1, 1]) {
    b.box(0.9, 0.9, 5.2, s * 1.3, deck + 0.9, -6, pal.panel, s * 0.5, -0.28);
    b.box(0.9, 0.9, 5.2, s * 1.3, deck + 1.9, -6.5, pal.panel, s * 0.5, -0.28);
  }
  ciws(b, pal, 0, deck, -10.5);
  return { geo: b.build(), deck, gunZ: c.len * 0.3, gunSize: 0.6, radarY: deck + 7.6, radarZ: 0.5, stacks: [[0, deck + 3.4, -2]], ciws: [[0, deck + 2.6, -10.5]], mastTop: [0, deck + 8.4, 0.5] };
}

function buildCargo(pal) {
  const c = CLASSES.cargo;
  const b = new Builder();
  b.add(hullGeometry(c.len, c.beam, 6, 4.5, pal, { sheer: 0.2 }).geo);
  const deck = 6.2;
  // container stacks
  let k = 0;
  for (let z = -26; z <= 40; z += 7.5) {
    const tiers = 2 + ((k * 7) % 3);
    for (let t = 0; t < tiers; t++) {
      for (const x of [-4.5, 0, 4.5]) {
        b.box(4.2, 2.4, 6.8, x, deck + 1.2 + t * 2.5, z, CONTAINER_COLORS[(k * 3 + t * 5 + Math.round(x)) % CONTAINER_COLORS.length]);
      }
    }
    k++;
  }
  // aft accommodation block + funnel
  b.box(13, 9, 9, 0, deck + 4.5, -40, pal.sup);
  b.box(14, 1, 1.2, 0, deck + 8, -35.6, pal.window);
  b.box(3, 5, 3.5, 0, deck + 11, -45, pal.stack);
  return { geo: b.build(), deck, gunZ: 0, gunSize: 0.1, radarY: deck + 11, radarZ: -40, stacks: [[0, deck + 13.5, -45]], ciws: [[0, deck + 10, -40]], mastTop: [0, deck + 13, -40] };
}

function buildTanker(pal) {
  const c = CLASSES.tanker;
  const b = new Builder();
  b.add(hullGeometry(c.len, c.beam, 5, 5, { ...pal, hull: 0x7a2c24, deck: 0x4a6a4a }, { sheer: 0.15 }).geo);
  const deck = 5.2;
  // pipe run and manifolds along the deck
  b.box(1.2, 1.2, 90, 0, deck + 0.8, 5, pal.panel);
  for (let z = -30; z <= 45; z += 15) b.box(10, 1.4, 1.4, 0, deck + 1.2, z, pal.panel);
  b.box(15, 10, 11, 0, deck + 5, -50, pal.sup);
  b.box(16, 1, 1.2, 0, deck + 9, -44.5, pal.window);
  b.box(3.2, 5, 3.6, 0, deck + 12, -56, pal.stack);
  return { geo: b.build(), deck, gunZ: 0, gunSize: 0.1, radarY: deck + 12, radarZ: -50, stacks: [[0, deck + 14.5, -56]], ciws: [[0, deck + 10, -50]], mastTop: [0, deck + 14, -50] };
}

function buildSSK(pal) {
  const c = CLASSES.ssk;
  const b = new Builder();
  // cigar hull lying mostly awash
  const hull = new THREE.CylinderGeometry(c.beam / 2, c.beam / 2, c.len * 0.8, 10).rotateX(Math.PI / 2);
  b.add(colorize(hull, pal.dark));
  b.add(colorize(new THREE.SphereGeometry(c.beam / 2, 10, 6).scale(1, 1, 1.8).translate(0, 0, c.len * 0.4), pal.dark));
  b.add(colorize(new THREE.ConeGeometry(c.beam / 2, c.len * 0.2, 10).rotateX(-Math.PI / 2).translate(0, 0, -c.len * 0.5), pal.dark));
  // sail and planes
  b.taper(2.4, 6, 9, 0, c.beam / 2 + 3, c.len * 0.12, pal.stack, 0.8, 0.8);
  b.box(8, 0.3, 1.5, 0, c.beam / 2 + 3.5, c.len * 0.14, pal.stack);
  b.box(0.3, 4, 2, 0, 0, -c.len * 0.47, pal.stack);
  b.box(7, 0.3, 2, 0, 0, -c.len * 0.45, pal.stack);
  return { geo: b.build(), deck: c.beam / 2, gunZ: 0, gunSize: 0.1, radarY: c.beam / 2 + 7, radarZ: c.len * 0.12, stacks: [[0, c.beam / 2 + 6, c.len * 0.12]], ciws: [[0, c.beam / 2 + 5, c.len * 0.12]], mastTop: [0, c.beam / 2 + 7.5, c.len * 0.12] };
}

function buildHelo(pal) {
  const b = new Builder();
  b.taper(2.6, 2.6, 7, 0, 0, 1, pal.sup2, 0.8, 0.9);
  b.box(0.8, 0.8, 8, 0, 0.4, -5, pal.sup2);
  b.box(0.2, 2.2, 1.2, 0, 1.4, -9, pal.sup2);
  b.box(1.6, 0.5, 2, 0, 1.2, 4.2, pal.window);
  return { geo: b.build(), deck: 1.5, gunZ: 0, gunSize: 0.1, radarY: -1.5, radarZ: 1, stacks: [[0, 1.5, -1]], ciws: [[0, 0, 0]], mastTop: [0, 2, 0], rotor: { y: 1.9, r: 7 } };
}

function buildDrone(pal, strike) {
  const b = new Builder();
  b.taper(1.4, 1.2, strike ? 11 : 8, 0, 0, 0, pal.sup2, 0.8, 0.9);
  b.box(strike ? 15 : 12, 0.25, 1.8, 0, 0.2, 0, pal.sup2);
  b.box(4.5, 0.2, 1, 0, 0.2, -(strike ? 5 : 3.8), pal.sup2);
  b.box(0.2, 1.4, 1, 0, 0.9, -(strike ? 5 : 3.8), pal.sup2);
  if (strike) for (const x of [-4, 4]) b.cyl(0.35, 0.35, 3.4, x, -0.4, 0.4, pal.white, 6, Math.PI / 2);
  return { geo: b.build(), deck: 0.6, gunZ: 0, gunSize: 0.1, radarY: -0.8, radarZ: 1.5, stacks: [[0, 0, -3]], ciws: [[0, 0, 0]], mastTop: [0, 0.8, 0] };
}

// Fast jets: delta / swept wings built from flat wedges.
function wing(b, span, root, tip, sweep, x0, y, z, color, side) {
  const g = new THREE.BufferGeometry();
  const s = side;
  // root leading, root trailing, tip trailing, tip leading (z forward)
  const v = [
    [x0 * s, y, z + root / 2],
    [x0 * s, y, z - root / 2],
    [(x0 + span) * s, y, z - root / 2 - sweep + (root - tip) * 0.15],
    [(x0 + span) * s, y, z - sweep + tip / 2 + (root - tip) * 0.15],
  ];
  const T = 0.25;
  const pos = [];
  const quad = (a, c, d, e) => pos.push(...a, ...c, ...d, ...a, ...d, ...e);
  const up = v.map((p) => [p[0], p[1] + T, p[2]]);
  const dn = v.map((p) => [p[0], p[1] - T, p[2]]);
  if (s > 0) {
    quad(up[0], up[3], up[2], up[1]);
    quad(dn[0], dn[1], dn[2], dn[3]);
  } else {
    quad(up[0], up[1], up[2], up[3]);
    quad(dn[0], dn[3], dn[2], dn[1]);
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (s > 0) quad(up[i], dn[i], dn[j], up[j]);
    else quad(up[i], up[j], dn[j], dn[i]);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(colorize(g, color));
}

function buildFighter(pal) {
  const b = new Builder();
  b.taper(1.6, 1.5, 15, 0, 0, -0.5, pal.sup2, 0.7, 0.92);
  b.cyl(0.05, 0.8, 3, 0, 0, 8.3, pal.sup2, 6, Math.PI / 2);
  b.box(1, 0.6, 2.6, 0, 0.9, 3.6, pal.window);
  for (const s of [-1, 1]) {
    wing(b, 5, 7, 1.4, 4.2, 0.6, 0, -1.5, pal.sup2, s);
    wing(b, 2.2, 2.4, 0.9, 1.2, 0.5, 0, -6.6, pal.sup2, s);
    b.box(0.2, 2.4, 2, s * 0.9, 1.4, -5.8, pal.sup2, 0, 0, s * 0.35);
    b.cyl(0.18, 0.18, 2.6, s * 5.4, -0.3, -1.6, pal.white, 5, Math.PI / 2);
  }
  return { geo: b.build(), deck: 0.6, gunZ: 0, gunSize: 0.1, radarY: -0.8, radarZ: 1.5, stacks: [[0, 0, -6]], ciws: [[0, 0, 0]], mastTop: [0, 1, 0], jet: [[0, 0, -8.3, 0.7]] };
}

function buildJet(pal) {
  const b = new Builder();
  b.taper(1.8, 1.6, 16, 0, 0, 0, pal.sup2, 0.75, 0.92);
  b.cyl(0.05, 0.9, 3, 0, 0, 9.4, pal.sup2, 6, Math.PI / 2);
  b.box(1, 0.6, 3, 0, 1, 4.6, pal.window);
  b.box(0.25, 3, 2.6, 0, 1.8, -6.6, pal.sup2);
  for (const s of [-1, 1]) {
    wing(b, 6.2, 4.6, 1.8, 2.6, 0.8, 0.1, 0.5, pal.sup2, s);
    wing(b, 2.6, 2.2, 1, 1, 0.6, 0.2, -7, pal.sup2, s);
    for (const x of [2.6, 4.4]) b.cyl(0.28, 0.28, 3.2, s * x, -0.6, -0.4, pal.white, 6, Math.PI / 2);
  }
  return { geo: b.build(), deck: 0.6, gunZ: 0, gunSize: 0.1, radarY: -0.8, radarZ: 1.5, stacks: [[0, 0, -7]], ciws: [[0, 0, 0]], mastTop: [0, 1, 0], jet: [[0, 0, -8.6, 0.8]] };
}

function buildPatrol(pal, aew) {
  const b = new Builder();
  const L = aew ? 18 : 34;
  b.cyl(1.7, 1.7, L, 0, 0, 0, pal.sup2, 8, Math.PI / 2);
  b.cyl(0.4, 1.7, 4, 0, 0, L / 2 + 2, pal.sup2, 8, Math.PI / 2);
  b.cyl(1.7, 0.4, 7, 0, 0.6, -L / 2 - 3.5, pal.sup2, 8, Math.PI / 2);
  b.box(1.6, 0.6, 1.2, 0, 1, L / 2 + 1.2, pal.window);
  const wy = aew ? 1.4 : -0.6;
  const span = aew ? 13 : 16;
  for (const s of [-1, 1]) {
    wing(b, span, 4.4, 1.8, aew ? 0.6 : 3, 1.2, wy, aew ? 1 : 0, pal.sup2, s);
    wing(b, aew ? 4 : 5.2, 2.6, 1.2, 1.2, 0.6, 0.6, -L / 2 - 4, pal.sup2, s);
    // engines
    b.cyl(0.9, 0.9, aew ? 5 : 5.5, s * (aew ? 4.2 : 5.8), wy - 0.9, aew ? 2.4 : 1.6, pal.stack, 7, Math.PI / 2);
    if (aew) b.box(0.25, 3, 2.2, s * 4.5, 1.6, -L / 2 - 4.2, pal.sup2);
  }
  if (!aew) b.box(0.3, 4.5, 3.2, 0, 2.6, -L / 2 - 4.5, pal.sup2);
  else {
    b.cyl(0.4, 0.4, 2.4, 0, 2.6, -2, pal.stack, 5);
    b.cyl(5.2, 5.2, 0.9, 0, 4.2, -2, pal.white, 14);
  }
  // patrol plane: MAD tail boom
  if (!aew) b.cyl(0.25, 0.25, 4, 0, 0.6, -L / 2 - 8.5, pal.stack, 5, Math.PI / 2);
  return { geo: b.build(), deck: 1.5, gunZ: 0, gunSize: 0.1, radarY: -1.2, radarZ: 2, stacks: [[0, 0, -L / 2]], ciws: [[0, 0, 0]], mastTop: [0, 2, 0] };
}

function buildWhale() {
  const b = new Builder();
  const skin = 0x2c3238;
  const belly = 0x5d646a;
  b.taper(3.6, 2.6, 11, 0, 0, 1.5, skin, 0.75, 0.9);
  b.cyl(1.2, 1.8, 3.4, 0, 0.1, 8.4, skin, 7, Math.PI / 2);
  b.box(3.0, 0.8, 9, 0, -1.2, 1.5, belly);
  b.cyl(1.4, 0.4, 6, 0, 0.2, -6.2, skin, 7, Math.PI / 2);
  // flukes and flippers
  b.box(6, 0.25, 1.6, 0, 0.2, -9.6, skin, 0, 0, 0);
  for (const s of [-1, 1]) b.box(3.4, 0.25, 1.1, s * 2.6, -0.8, 4.5, skin, s * 0.5);
  b.box(0.3, 0.9, 1.4, 0, 1.5, -2.5, skin);
  return { geo: b.build(), deck: 1, gunZ: 0, gunSize: 0.1, radarY: -3, radarZ: 0, stacks: [[0, 0, 0]], ciws: [[0, 0, 0]], mastTop: [0, -3, 0] };
}

function buildAirliner(pal) {
  const b = new Builder();
  const white = 0xd8dde0;
  b.cyl(2.1, 2.1, 30, 0, 0, 0, white, 9, Math.PI / 2);
  b.cyl(0.5, 2.1, 5, 0, 0.2, 17.5, white, 9, Math.PI / 2);
  b.cyl(2.1, 0.5, 8, 0, 0.8, -19, white, 9, Math.PI / 2);
  b.box(2.2, 0.5, 1, 0, 1.1, 18.4, pal.window || 0x223344);
  for (const s of [-1, 1]) {
    wing(b, 15, 6, 1.8, 6, 1.6, -0.9, 2, white, s);
    wing(b, 5, 3, 1.2, 2.4, 0.5, 0.9, -19.5, white, s);
    b.cyl(1.1, 1.1, 4.5, s * 6.2, -1.9, 4.6, 0x8a9096, 8, Math.PI / 2);
  }
  b.box(0.3, 6, 4.2, 0, 3.6, -20.5, 0x2f6fae);
  return { geo: b.build(), deck: 2, gunZ: 0, gunSize: 0.1, radarY: -1.5, radarZ: 2, stacks: [[0, 0, -15]], ciws: [[0, 0, 0]], mastTop: [0, 2.3, 0] };
}

const cache = new Map();
let hullMat = null;

export function shipMaterial() {
  if (!hullMat) {
    hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.12 });
  }
  return hullMat;
}

const lightMats = {};
function lightMat(r, g, b) {
  const key = `${r},${g},${b}`;
  if (!lightMats[key]) lightMats[key] = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false });
  return lightMats[key];
}

export function buildShipModel(cls, side) {
  const key = cls + side;
  if (!cache.has(key)) {
    const pal = PALETTES[side];
    const builders = {
      ddg: () => buildDDG(pal, side),
      ffg: () => buildFFG(pal, side),
      fac: () => buildFAC(pal, side),
      ssk: () => buildSSK(pal),
      helo: () => buildHelo(pal),
      drone: () => buildDrone(pal, false),
      strike: () => buildDrone(pal, true),
      fighter: () => buildFighter(pal),
      jet: () => buildJet(pal),
      mpa: () => buildPatrol(pal, false),
      aew: () => buildPatrol(pal, true),
      whale: () => buildWhale(),
      airliner: () => buildAirliner(pal),
      cargo: () => buildCargo(pal),
      tanker: () => buildTanker(pal),
    };
    const def = builders[cls]();
    def.turretGeo = turretGeometry(pal, def.gunSize);
    def.barrelGeo = barrelGeometry(pal, def.gunSize);
    def.radarGeo = radarGeometry(pal, cls === 'fac' ? 2.2 : 4);
    cache.set(key, def);
  }
  const def = cache.get(key);
  const mat = shipMaterial();
  const group = new THREE.Group();
  const body = new THREE.Group(); // receives bob/pitch/roll
  group.add(body);
  const hull = new THREE.Mesh(def.geo, mat);
  body.add(hull);

  const turret = new THREE.Group();
  turret.position.set(0, def.deck, def.gunZ);
  turret.add(new THREE.Mesh(def.turretGeo, mat));
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.0 * def.gunSize, 1.0 * def.gunSize);
  barrel.add(new THREE.Mesh(def.barrelGeo, mat));
  turret.add(barrel);
  body.add(turret);

  const radar = new THREE.Mesh(def.radarGeo, mat);
  radar.position.set(0, def.radarY, def.radarZ);
  body.add(radar);

  // navigation lights (HDR so they bloom at night)
  const lightGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const c = CLASSES[cls];
  const port = new THREE.Mesh(lightGeo, lightMat(5, 0.2, 0.15));
  port.position.set(-c.beam * 0.5, def.deck + 3, c.len * 0.1);
  const stbd = new THREE.Mesh(lightGeo, lightMat(0.2, 5, 0.6));
  stbd.position.set(c.beam * 0.5, def.deck + 3, c.len * 0.1);
  const top = new THREE.Mesh(lightGeo, lightMat(5, 5, 4.5));
  top.position.set(...def.mastTop);
  body.add(port, stbd, top);

  let rotor = null;
  if (def.rotor) {
    rotor = new THREE.Mesh(
      new THREE.CircleGeometry(def.rotor.r, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x20262c, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    );
    rotor.position.y = def.rotor.y;
    body.add(rotor);
  }
  // jet exhaust: a hot core that blooms
  if (def.jet) {
    for (const [x, y, z, r] of def.jet) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.7, 0.8, 6).rotateX(Math.PI / 2), lightMat(4, 1.6, 0.5));
      e.position.set(x, y, z);
      body.add(e);
    }
  }
  if (c.air || cls === 'ssk' || c.civ) {
    turret.visible = false;
    port.visible = stbd.visible = !c.air;
  }
  if (c.bio) port.visible = stbd.visible = top.visible = radar.visible = false;
  if (cls === 'airliner') radar.visible = false;
  // patrol plane: rotodome, shown when an AEW radar is fitted
  let dome = null;
  if (cls === 'mpa') {
    const b = new Builder();
    b.cyl(0.4, 0.4, 2.6, 0, 3, -6, PALETTES[side].stack, 5);
    b.cyl(5.2, 5.2, 0.9, 0, 4.6, -6, PALETTES[side].white, 14);
    dome = new THREE.Mesh(b.build(), mat);
    dome.visible = false;
    body.add(dome);
  }
  return { group, body, turret, barrel, radar, rotor, dome, def };
}
