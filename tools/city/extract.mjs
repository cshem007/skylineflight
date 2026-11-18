import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
const SRC = process.argv[2], OUT = process.argv[3], SCALE = 20;   // model units -> metres
const io = new NodeIO(), doc = await io.read(SRC), root = doc.getRoot();
const mats = root.listMaterials(), matIndex = new Map(mats.map((m, i) => [m, i]));
const P = [], U = [], M = [], N = [];
let nodes = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue; nodes++;
  const w = node.getWorldMatrix();   // column-major 4x4
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
    const pa = pos.getArray(), ua = uv ? uv.getArray() : null, ia = idx ? idx.getArray() : null;
    const count = ia ? ia.length : pa.length / 3, mi = matIndex.get(prim.getMaterial()) ?? -1;
    const v = i => { const x = pa[i*3], y = pa[i*3+1], z = pa[i*3+2]; return [ (w[0]*x+w[4]*y+w[8]*z+w[12])*SCALE, (w[1]*x+w[5]*y+w[9]*z+w[13])*SCALE, (w[2]*x+w[6]*y+w[10]*z+w[14])*SCALE ]; };
    for (let t = 0; t < count; t += 3) {
      const i0 = ia ? ia[t] : t, i1 = ia ? ia[t+1] : t+1, i2 = ia ? ia[t+2] : t+2;
      P.push(...v(i0), ...v(i1), ...v(i2));
      U.push(...(ua ? [ua[i0*2], ua[i0*2+1], ua[i1*2], ua[i1*2+1], ua[i2*2], ua[i2*2+1]] : [0,0,0,0,0,0]));
      M.push(mi); N.push(nodes);
    }
  }
}
fs.writeFileSync(OUT + '.pos', Buffer.from(new Float32Array(P).buffer));
fs.writeFileSync(OUT + '.uv', Buffer.from(new Float32Array(U).buffer));
fs.writeFileSync(OUT + '.mat', Buffer.from(new Uint16Array(M).buffer));
fs.writeFileSync(OUT + '.meta.json', JSON.stringify({ tris: M.length, materials: mats.map((m, i) => ({ i, name: m.getName(), alpha: m.getAlphaMode(), tex: m.getBaseColorTexture() ? m.getBaseColorTexture().getSize() : null })) }));
console.log('triangles', M.length, 'materials', mats.length, 'mesh nodes', nodes);
