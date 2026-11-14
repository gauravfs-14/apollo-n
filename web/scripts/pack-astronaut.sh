# Rebuild web/public/models/crew/astronaut.glb (+ accent_mask.webp). Needs assets-src/downloads/p3/z2.glb (NASA-3D-Resources).
set -e
cd "$(dirname "$0")/.."
T=/tmp/p3-suit; mkdir -p $T/src $T/out
node --input-type=module -e '
import { makeIO } from "./scripts/gltf-lib.mjs"; import fs from "node:fs";
const doc = await (await makeIO()).read("../assets-src/downloads/p3/z2.glb");
for (const t of doc.getRoot().listTextures()) if (t.getMimeType()==="image/jpeg") fs.writeFileSync(`'$T'/src/${t.getName()}.jpeg`, t.getImage());'
(cd ../api && uv run python ../web/scripts/prep_suit_textures.py $T/src $T/out)
node scripts/rig-astronaut.mjs ../assets-src/downloads/p3/z2.glb $T/out $T/rigged.glb
npx gltf-transform optimize $T/rigged.glb public/models/crew/astronaut.glb --compress meshopt --simplify false --texture-compress false --join false --flatten false 2>&1 | tail -2
cp $T/out/accent_mask.webp public/models/crew/accent_mask.webp
