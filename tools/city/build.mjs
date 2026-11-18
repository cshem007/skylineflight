// Builds the big solid city: original model (scaled to metres) + extruded facades (+ infill, + outskirts when present)
import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
const [,, SRC, OUT, ...extra] = process.argv;
const io = new NodeIO(), doc = await io.read(SRC), root = doc.getRoot(), scene = root.listScenes()[0], buffer = root.listBuffers()[0];
const mats = root.listMaterials();
const ROOF = 'roof';                                          // the new gravel roof material (the model has no usable roof texture)

/* ---- geometry accumulators, one per material ---- */
class Acc { constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  quad(p, uv, nOut) {                                          // p: 4 points, wound so the face looks along nOut
    const e1 = [p[1][0]-p[0][0], p[1][1]-p[0][1], p[1][2]-p[0][2]], e2 = [p[2][0]-p[0][0], p[2][1]-p[0][1], p[2][2]-p[0][2]];
    const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    if (n[0]*nOut[0] + n[1]*nOut[1] + n[2]*nOut[2] < 0) { p = [p[0], p[3], p[2], p[1]]; uv = [uv[0], uv[3], uv[2], uv[1]]; }
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(...p[i]); this.nor.push(...nOut); this.uv.push(...uv[i]); }
    this.idx.push(b, b+1, b+2, b, b+2, b+3);
  } }
const acc = new Map(); const A = mi => { if (!acc.has(mi)) acc.set(mi, new Acc()); return acc.get(mi); };
const newMats = new Map(), texCache = new Map();
const tex = path => { if (!path) return null; if (!texCache.has(path)) texCache.set(path, doc.createTexture(path).setImage(new Uint8Array(fs.readFileSync(path))).setMimeType('image/png')); return texCache.get(path); };
const matOf = key => typeof key === 'number' ? mats[key] : newMats.get(key);
const add3 = (a, b, k = 1) => [a[0]+b[0]*k, a[1]+b[1]*k, a[2]+b[2]*k];

/* ---- 0. new materials from the other stages ---- */
const specs = extra.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
for (const spec of specs) for (const m of spec.materials || []) {
  const mm = doc.createMaterial(m.name).setBaseColorFactor([m.color[0], m.color[1], m.color[2], 1]).setRoughnessFactor(m.rough).setMetallicFactor(m.metal).setDoubleSided(true);
  if (m.tex) mm.setBaseColorTexture(tex(m.tex)); if (m.emissive) mm.setEmissiveTexture(tex(m.emissive)).setEmissiveFactor([1, 1, 1]);
  newMats.set(m.name, mm);
}

/* ---- 1. facades extruded backwards into solid buildings ---- */
const ext = JSON.parse(fs.readFileSync('extruded.json', 'utf8'));
for (const e of ext) {
  const t = e.t, bk = e.bk, y0 = e.y0, y1 = e.y1, d = e.depth, mi = e.mat;
  const sw = s => e.s_origin + s;                                // world s coordinate along the wall
  const F0 = add3(e.base, t, e.s0), F1 = add3(e.base, t, e.s1), R0 = add3(F0, bk, d), R1 = add3(F1, bk, d);
  const uvOf = (s, y) => [e.su[0]*sw(s) + e.su[1]*y + e.su[2], e.sv[0]*sw(s) + e.sv[1]*y + e.sv[2]];
  const sideU = dd => Math.abs(e.su[0]) * dd, vOf = y => e.sv[1] * y + e.sv[2];
  const up = (p, y) => [p[0], y, p[2]];
  // back face (looks along bk)
  A(mi).quad([up(R0, y0), up(R1, y0), up(R1, y1), up(R0, y1)], [uvOf(e.s0, y0), uvOf(e.s1, y0), uvOf(e.s1, y1), uvOf(e.s0, y1)], bk);
  // side faces
  A(mi).quad([up(F0, y0), up(R0, y0), up(R0, y1), up(F0, y1)], [[0, vOf(y0)], [sideU(d), vOf(y0)], [sideU(d), vOf(y1)], [0, vOf(y1)]], [-t[0], 0, -t[2]]);
  A(mi).quad([up(F1, y0), up(R1, y0), up(R1, y1), up(F1, y1)], [[0, vOf(y0)], [sideU(d), vOf(y0)], [sideU(d), vOf(y1)], [0, vOf(y1)]], [t[0], 0, t[2]]);
  // flat roof (8 m texture tile)
  A(ROOF).quad([up(F0, y1), up(F1, y1), up(R1, y1), up(R0, y1)], [[F0[0]/8, F0[2]/8], [F1[0]/8, F1[2]/8], [R1[0]/8, R1[2]/8], [R0[0]/8, R0[2]/8]], [0, 1, 0]);
}
console.log('extruded boxes:', ext.length);

/* ---- 2. extra geometry produced by other stages (infill, outskirts): same box/quad format ---- */
for (const spec of specs) { for (const q of spec.quads) A(q.mat).quad(q.p, q.uv, q.n); console.log('stage quads', spec.quads.length); }

/* ---- 3. scale the original model to metres, add the new geometry ---- */
const orig = doc.createNode('original-model').setScale([20, 20, 20]);
for (const ch of scene.listChildren()) { scene.removeChild(ch); orig.addChild(ch); }
scene.addChild(orig);
const mesh = doc.createMesh('new-city');
for (const [mi, a] of acc) {
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(a.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(a.nor)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(a.uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(a.idx)).setBuffer(buffer))
    .setMaterial(matOf(mi));
  mesh.addPrimitive(prim);
}
scene.addChild(doc.createNode('new-city').setMesh(mesh));
await io.write(OUT, doc);
console.log('written', OUT);
