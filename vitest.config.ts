import { defineConfig } from "vitest/config";

const domHooks = [
  "src/features/intersections/use-intersections.test.ts",
  "src/features/regex-lab/use-group-selection.test.ts",
];

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          environment: "node",
          include: ["bot/**/*.test.ts", "src/**/*.test.ts"],
          exclude: domHooks,
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", ...domHooks],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
  },
});
