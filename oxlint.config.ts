import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, vitest, antiSlop, selectJsPlugins(["github", "sonarjs"])],
  ignorePatterns: core.ignorePatterns,
  overrides: [
    {
      // Domain modules co-locate their tagged error families with their
      // parsers (project coding standards), so one error class per file
      // would fragment cohesive modules.
      files: ["src/lib/**/*.{ts,tsx}"],
      rules: {
        "max-classes-per-file": "off",
      },
    },
  ],
});
