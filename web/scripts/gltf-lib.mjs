// Resolve @gltf-transform packages installed by pnpm (not hoisted to node_modules root).
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/.pnpm");
const cli = readdirSync(root).find((d) => d.startsWith("@gltf-transform+cli@"));
const require = createRequire(path.join(root, cli, "node_modules/@gltf-transform/cli/package.json"));
export const core = require("@gltf-transform/core");
export const ext = require("@gltf-transform/extensions");
export const fns = require("@gltf-transform/functions");

/** NodeIO that can read Draco-compressed GLBs. */
export async function makeIO() {
  const draco3d = require("draco3d");
  const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });
  return io;
}
