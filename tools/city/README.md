# City build pipeline

Turns the Sketchfab "City" model (facade-only buildings, 67 % empty space) into the solid, much larger city in `public/assets/city.glb`.
Not part of the game build: run by hand when the city changes. Needs Node, Python 3 (numpy, Pillow) and `@gltf-transform/core` + `@gltf-transform/cli`.

1. `node extract.mjs <model.glb> tris`: dumps every triangle in metres (model units x 20).
2. `python3 textures.py`: procedural facade / road / roof / ground textures (`tex/`), each with a lit-window map for night.
3. `python3 citygen.py`: the generator.
   - paints a ring road + street grid around the model and connects the model's own street ends to it
   - extrudes every tall facade wall backwards into a solid building (stops at roads and at other buildings)
   - packs the remaining empty space with lots (4 m alleys), buildings (varied height, taller toward the centre), parks with trees, rooftop clutter
   - FPV structures: open parking garages, arch towers, sky bridges, an elevated highway
   - writes `extruded.json` and `fill.json`
4. `node build.mjs <model.glb> out.glb fill.json`: merges everything into one glTF, scaled to metres.
5. `gltf-transform optimize out.glb ../../public/assets/city.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify false`

The source model is not committed (about 20 MB). The base used is the model with the road-patch texture made transparent (see the git history of `public/assets/city.glb`).
