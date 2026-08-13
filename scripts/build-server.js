const path = require("node:path");
const esbuild = require("esbuild");

async function main() {
  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), "server", "index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    splitting: true,
    outdir: path.resolve(process.cwd(), "server_dist"),
    logLevel: "info",
  });
}

main().catch((error) => {
  console.error("Server build failed:", error);
  process.exit(1);
});
