import { afterEach, mock } from "bun:test";
import { restoreTestGlobals } from "./test-globals";

mock.module("./content/load-data", () => ({
  loadData: async (name: string) => {
    const path =
      name === "ru" || name === "en"
        ? `i18n/${name}.json`
        : `content/${name}.generated.json`;
    return await Bun.file(`${import.meta.dir}/${path}`).json();
  },
}));

const domHooks = [
  "/src/features/intersections/use-intersections.test.ts",
  "/src/features/regex-lab/use-group-selection.test.ts",
];

// With --isolate, Bun.main identifies the test file being loaded.
if (
  Bun.main.endsWith(".test.tsx") ||
  domHooks.some((path) => Bun.main.endsWith(path))
) {
  await import("./test-dom");
}

afterEach(() => {
  mock.restore();
  restoreTestGlobals();
});
