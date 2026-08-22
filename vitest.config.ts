import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@/alchemy.run.ts",
        replacement: new URL("alchemy.run.ts", import.meta.url).pathname,
      },
      { find: "@", replacement: new URL("src", import.meta.url).pathname },
    ],
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
