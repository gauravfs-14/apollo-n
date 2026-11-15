# Interior assets (spacecraft cabin)

## Apollo 11 Command Module "Columbia" interior scan
- Shipped: `web/public/models/interior/cm_interior.glb` (2.9 MB, ~100k tris, one 2K webp texture set, meshopt)
- Source: Smithsonian National Air and Space Museum, "Command Module, Apollo 11" 3D scan, https://3d.si.edu/object/3d/command-module-apollo-11:d8c63e8a-4ebc-11ea-b77f-2e728ce88125
  (download used: `x3d-cm-interior_combined-100k-2048_std_draco.glb` from the 3d-api.si.edu package d8c63e8a-4ebc-11ea-b77f-2e728ce88125)
- Credit: Smithsonian Institution, National Air and Space Museum (Apollo 11 Command Module, A19700102000)
- License: CC0 (Smithsonian Open Access). The 3d.si.edu object page could not be fetched from this environment (HTTP 403); CC0 status taken from the Smithsonian Open Access record for this object and the Smithsonian-hosted CC0 copy on Sketchfab. Re-check on the object page before release.
- Processing: `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 2048`; scaled x1.7 at load (real size is too tight for four suited astronauts).

## Equipment bay (built in code)
Octagonal bay, plating textures, racks, switches, valve manifold, tanks and all stations are generated in code
(`web/game/three/interior/`, `web/game/phases/cruise/cabin/`). No external assets.
