// Headless battle test: two AI fleets fight until one side wins.
// Checks that the simulation runs without errors, resolves, and that every
// system (sensors, jamming, weapons, control point, civilians) gets used.
import { World } from '../src/sim/world.js';
import { AIController } from '../src/sim/ai.js';
import { randomFleet, presetFleet, PRESETS, fleetCost, BUDGET } from '../src/fleet.js';

// Every preset must fit the budget.
for (const k of Object.keys(PRESETS)) {
  const f = presetFleet(k);
  if (!f || fleetCost(f) > BUDGET) throw new Error(`preset ${k} is invalid or over budget`);
}

const runs = Number(process.argv[2] || 6);
const totals = { ssmFired: 0, ssmHits: 0, intercepts: 0, shellHits: 0, civHits: 0 };
const evCount = {};
const how = {};
let resolved = 0;
let totalTime = 0;

for (let r = 0; r < runs; r++) {
  // Alternate standard and random designs.
  const w = r % 2 ? World.createScenario({ blue: randomFleet('blue'), red: randomFleet('red') }) : World.createScenario();
  const ais = [new AIController(w, 'blue'), new AIController(w, 'red')];
  const dt = 1 / 30;
  let t = 0;
  let endEv = null;
  while (!w.winner && t < 1500) {
    for (const ai of ais) ai.update(dt);
    w.step(dt);
    for (const e of w.drainEvents()) {
      evCount[e.t] = (evCount[e.t] || 0) + 1;
      if (e.t === 'end') endEv = e;
    }
    JSON.stringify(w.snapshot());
    t += dt;
  }
  for (const s of w.ships) {
    for (const k of ['x', 'z', 'heading', 'hp']) {
      if (!Number.isFinite(s[k])) throw new Error(`ship ${s.name} has non-finite ${k}`);
    }
    for (const i of w.map.islands) {
      if (s.alive && Math.hypot(s.x - i.x, s.z - i.z) < i.r * 0.9) throw new Error(`ship ${s.name} ran aground`);
    }
  }
  if (w.winner) resolved++;
  const kind = endEv ? (endEv.cp ? 'control point' : 'fleet') : 'timeout';
  how[kind] = (how[kind] || 0) + 1;
  totalTime += t;
  for (const side of ['blue', 'red']) for (const k in totals) totals[k] += w.stats[side][k];
  console.log(`run ${r + 1}: winner=${w.winner ?? 'none'} by ${kind} time=${t.toFixed(0)}s islands=${w.map.islands.length} cp=${w.cp.score.blue.toFixed(0)}/${w.cp.score.red.toFixed(0)}`);
}
console.log('events', evCount);
console.log('totals', totals, how, `avg battle ${(totalTime / runs).toFixed(0)}s`);

const need = ['launch', 'gun', 'hit', 'splash', 'intercept', 'sink', 'contact', 'ident', 'ping', 'end', 'jam', 'cp'];
const missing = need.filter((k) => !evCount[k]);
if (missing.length) {
  console.error('FAIL: events never fired:', missing);
  process.exit(1);
}
if (resolved < Math.ceil(runs * 0.66)) {
  console.error(`FAIL: only ${resolved}/${runs} battles resolved`);
  process.exit(1);
}
console.log('OK');
