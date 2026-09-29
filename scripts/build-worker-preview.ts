import path from "node:path";

import { build } from "vite";

const root = process.cwd();
const artifactDirectory = process.env.PREVIEW_ARTIFACT_DIRECTORY;

if (!artifactDirectory) {
  throw new Error("PREVIEW_ARTIFACT_DIRECTORY is required");
}

await build({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    outDir: path.resolve(artifactDirectory, "worker"),
    rollupOptions: {
      output: {
        codeSplitting: false,
        entryFileNames: "index.js",
        format: "es",
      },
    },
    ssr: path.resolve(root, "src/worker.ts"),
  },
  configFile: false,
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  root,
  ssr: { noExternal: true },
});
