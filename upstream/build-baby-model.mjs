// A second, smaller jelly from the same implicit shape: coarser cage, lighter
// surface. Scaling the full model down would keep all 4,026 elements and cost
// as much as the mother; a small creature seen at fifty-odd points on screen
// does not need them. Usage: node --experimental-strip-types scripts/build-baby-model.mjs [scale] [spacing]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as THREE from 'three/webgpu';
import { buildCage } from './model-cage.mjs';
import { buildOpticalModel } from './optical-model.mjs';

const HEIGHT = Number(process.argv[2] ?? .028);     // metres, against the mother's .07
const SPACING = Number(process.argv[3] ?? .005);    // cage lattice, against her .0075
const SURFACE = 'const NX = 52, NY = 48, NZ = 44;'; // against her 104, 96, 88

const source = readFileSync('refs/jelly_baby_mesh.html', 'utf8');
const begin = source.indexOf('const V =');
const end = source.indexOf('// Minimal WebGPU viewer');
const definitions = source.slice(begin, end);
const lighter = definitions.replace('const NX = 104, NY = 96, NZ = 88;', SURFACE);
if (lighter === definitions) throw new Error('Reference polygonizer dimensions changed');

const model = new Function('THREE', lighter + '\nreturn {buildJellyGeometry,jellySDF};')(THREE);
const raw = model.buildJellyGeometry();
const scale = HEIGHT / (raw.boundingBox.max.y - raw.boundingBox.min.y);
const bottom = raw.boundingBox.min.y;
raw.translate(0, -bottom, 0);
raw.scale(scale, scale, scale);

const p = raw.attributes.position.array, n = raw.attributes.normal.array;
const positions = [], normals = [], indices = [], vertices = new Map();
for (let i = 0; i < p.length; i += 3) {
  const key = `${p[i]},${p[i + 1]},${p[i + 2]}`;
  let id = vertices.get(key);
  if (id === undefined) {
    id = positions.length / 3;
    vertices.set(key, id);
    positions.push(p[i], p[i + 1], p[i + 2]);
    normals.push(n[i], n[i + 1], n[i + 2]);
  }
  indices.push(id);
}
let signedVolume = 0;
for (let i = 0; i < indices.length; i += 3) {
  const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
  signedVolume += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) +
    positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]) +
    positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
}
const edges = new Map();
for (let i = 0; i < indices.length; i += 3) for (let k = 0; k < 3; k++) {
  const a = indices[i + k], b = indices[i + (k + 1) % 3];
  edges.set(`${Math.min(a, b)},${Math.max(a, b)}`, (edges.get(`${Math.min(a, b)},${Math.max(a, b)}`) || 0) + 1);
}
console.log({ height: HEIGHT, spacing: SPACING, vertices: positions.length / 3, triangles: indices.length / 3,
  volume: signedVolume, badEdges: [...edges.values()].filter(c => c !== 2).length });

mkdirSync('src/assets/model', { recursive: true });
const arrays = {
  positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices),
  ...buildCage(positions, scale, bottom, model.jellySDF, signedVolume, SPACING),
};
// The optical proxy is unused by the desktop pet but the loader expects it, and
// it does its own reduction from the untouched reference dimensions.
Object.assign(arrays, buildOpticalModel(definitions, scale, bottom, arrays));

const chunks = [], layout = {};
let offset = 0;
for (const [name, array] of Object.entries(arrays)) {
  const padding = (8 - offset % 8) % 8;
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
  layout[name] = { offset, length: array.length, type: array.constructor.name };
  chunks.push(Buffer.from(array.buffer));
  offset += array.byteLength;
}
writeFileSync('src/assets/model/jelly-baby-small.bin', Buffer.concat(chunks));
writeFileSync('src/assets/model/jelly-baby-small.json', JSON.stringify({
  sourceHash: createHash('sha256').update(source).digest('hex'), scale, bottom, volume: signedVolume, layout,
}, null, 2));
