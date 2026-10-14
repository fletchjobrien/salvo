// Headless battle test: two AI fleets fight until one side is sunk.
// Checks that the simulation runs without errors, resolves, and that every
// weapon system gets used.
import { World } from '../src/sim/world.js';
import { AIController } from '../src/sim/ai.js';

const runs = Number(process.argv[2] || 6);
const totals = { ssmFired: 0, ssmHits: 0, intercepts: 0, shellHits: 0 };
const evCount = {};
let resolved = 0;
let totalTime = 0;

for (let r = 0; r < runs; r++) {
  const w = World.createScenario();
  const ais = [new AIController(w, 'blue'), new AIController(w, 'red')];
  const dt = 1 / 30;
  let t = 0;
  while (!w.winner && t < 1800) {
    for (const ai of ais) ai.update(dt);
    w.step(dt);
    for (const e of w.drainEvents()) evCount[e.t] = (evCount[e.t] || 0) + 1;
    JSON.stringify(w.snapshot());
    t += dt;
  }
  for (const s of w.ships) {
    for (const k of ['x', 'z', 'heading', 'hp']) {
      if (!Number.isFinite(s[k])) throw new Error(`ship ${s.name} has non-finite ${k}`);
    }
  }
  if (w.winner) resolved++;
  totalTime += t;
  for (const side of ['blue', 'red']) for (const k in totals) totals[k] += w.stats[side][k];
  console.log(
    `run ${r + 1}: winner=${w.winner ?? 'none'} time=${t.toFixed(0)}s`,
    `blue=${JSON.stringify(w.stats.blue)}`,
    `red=${JSON.stringify(w.stats.red)}`,
  );
}
console.log('events', evCount);
console.log('totals', totals, `avg battle ${(totalTime / runs).toFixed(0)}s`);

const need = ['launch', 'gun', 'hit', 'splash', 'intercept', 'sink', 'contact', 'end', 'ciws'];
const missing = need.filter((k) => !evCount[k]);
if (missing.length) {
  console.error('FAIL: events never fired:', missing);
  process.exit(1);
}
if (resolved < Math.ceil(runs / 2)) {
  console.error(`FAIL: only ${resolved}/${runs} battles resolved`);
  process.exit(1);
}
console.log('OK');
