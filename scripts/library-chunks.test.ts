import { expect, test } from "bun:test";
import type { OutputChunk } from "rolldown";
import { build } from "vite";

async function buildChunks(changeText = false) {
  const result = await build({
    logLevel: "silent",
    build: { write: false },
    plugins: changeText
      ? [
          {
            name: "change-dashboard-text",
            transform(code, id) {
              if (id.endsWith("/src/pages/Dashboard.tsx")) {
                return code.replace("Pull Requests", "Pull Requests updated");
              }
            },
          },
        ]
      : [],
  });
  if (Array.isArray(result) || !("output" in result)) {
    throw new Error("Expected one production build output");
  }
  return result.output.filter(
    (item): item is OutputChunk => item.type === "chunk"
  );
}

test("three application groups stay isolated and stable across UI text changes", async () => {
  const chunks = await buildChunks();
  const updated = await buildChunks(true);
  const entry = chunks.find((chunk) => chunk.isEntry);
  expect(entry).toBeDefined();
  expect(updated.find((chunk) => chunk.isEntry)?.fileName).not.toBe(
    entry?.fileName
  );

  for (const name of ["codemirror", "react"]) {
    const group = chunks.filter((chunk) => chunk.name === name);
    expect(group).toHaveLength(1);
    expect(updated.find((chunk) => chunk.name === name)?.fileName).toBe(
      group[0]?.fileName
    );
    expect(
      Object.keys(group[0]?.modules ?? {}).some((id) =>
        id.startsWith(`${process.cwd()}/src/`)
      )
    ).toBe(false);
  }
  for (const pattern of [
    /\/node_modules\/@codemirror\//,
    /\/node_modules\/react\//,
  ]) {
    expect(
      chunks.filter((chunk) =>
        Object.keys(chunk.modules).some((id) => pattern.test(id))
      )
    ).toHaveLength(1);
  }

  expect(chunks.map((chunk) => chunk.name).sort()).toEqual([
    "codemirror",
    "index",
    "react",
    "rolldown-runtime",
  ]);
  expect(
    chunks.find((chunk) => chunk.name === "rolldown-runtime")!.code.length
  ).toBeLessThan(1000);
}, 30_000);
