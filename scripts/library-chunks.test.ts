import { expect, test } from "bun:test";
import type { OutputChunk } from "rolldown";
import { build } from "vite";

async function buildChunks(change?: "dashboard" | "workspace") {
  const result = await build({
    logLevel: "silent",
    build: { write: false },
    plugins: change
      ? [
          {
            name: "change-ui",
            transform(code, id) {
              if (
                change === "dashboard" &&
                id.endsWith("/src/pages/Dashboard.tsx")
              ) {
                return code.replace("Pull Requests", "Pull Requests updated");
              }
              if (
                change === "workspace" &&
                id.endsWith("/src/pages/BankWorkspace.tsx")
              ) {
                return code.replace(
                  "ui-panel-stack h-full",
                  "ui-panel-stack h-full cache-probe"
                );
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

test("shared code prevents workspace cache invalidation after dashboard changes", async () => {
  const chunks = await buildChunks();
  const updated = await buildChunks("dashboard");
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
    "shared",
    "workspace",
  ]);
  const workspace = chunks.find((chunk) => chunk.name === "workspace")!;
  expect(workspace.imports).not.toContain(entry!.fileName);
  for (const name of [
    "workspace",
    "shared",
    "react",
    "codemirror",
    "rolldown-runtime",
  ]) {
    const original = chunks.find((chunk) => chunk.name === name)!;
    expect(updated.find((chunk) => chunk.name === name)).toMatchObject({
      fileName: original.fileName,
      code: original.code,
    });
  }

  const workspaceUpdated = await buildChunks("workspace");
  expect(
    workspaceUpdated.find((chunk) => chunk.name === "workspace")!.fileName
  ).not.toBe(workspace.fileName);
  for (const name of ["shared", "react", "codemirror", "rolldown-runtime"]) {
    const original = chunks.find((chunk) => chunk.name === name)!;
    expect(workspaceUpdated.find((chunk) => chunk.name === name)).toMatchObject(
      {
        fileName: original.fileName,
        code: original.code,
      }
    );
  }

  const initial = new Set<string>();
  function visit(fileName: string) {
    if (initial.has(fileName)) {
      return;
    }
    initial.add(fileName);
    for (const dependency of chunks.find(
      (chunk) => chunk.fileName === fileName
    )!.imports) {
      visit(dependency);
    }
  }
  visit(entry!.fileName);
  expect(initial.size).toBe(4);
  expect(initial.has(workspace.fileName)).toBe(false);
  expect(
    initial.has(chunks.find((chunk) => chunk.name === "codemirror")!.fileName)
  ).toBe(false);
}, 30_000);
