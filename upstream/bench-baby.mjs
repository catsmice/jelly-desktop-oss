import { loadModel } from './load-model.mjs';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/app/locomotion.ts';

const time = fn => { const s = performance.now(); fn(); return performance.now() - s; };
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;

for (const name of ['jelly-baby', 'jelly-baby-small']) {
  const cage = loadModel(name);
  const body = new SoftBody(cage), rig = new Locomotion(body);
  for (let i = 0; i < 480; i++) { rig.step(PHYS.step); body.step(PHYS.step); }
  rig.move.set(0, 0, 1);
  const solver = [], surface = [];
  for (let f = 0; f < 240; f++) {
    // one rendered frame at 30 fps is eight fixed steps
    solver.push(time(() => { for (let i = 0; i < 8; i++) { rig.step(PHYS.step); body.step(PHYS.step); } }));
    surface.push(time(() => body.updateSurface()));
  }
  console.log(`${name.padEnd(17)} particles=${String(body.mass.length).padStart(4)} elements=${String(body.elements.length).padStart(5)} ` +
    `verts=${String(cage.surface.positions.length / 3).padStart(6)}  solver=${mean(solver).toFixed(2)}ms surface=${mean(surface).toFixed(2)}ms ` +
    `total=${(mean(solver) + mean(surface)).toFixed(2)}ms/frame`);
}
