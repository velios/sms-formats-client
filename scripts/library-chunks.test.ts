import { expect, test } from "bun:test";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputChunk } from "rolldown";
import { build, loadConfigFromFile, type UserConfig } from "vite";

const libraries = [
  "react",
  "codemirror",
  "octokit",
  "zod",
  "router",
  "query",
  "i18n-vendor",
  "ui-vendor",
  "vendor",
  "rolldown-runtime",
];

async function buildOutput(root: string, config: UserConfig) {
  const result = await build({
    ...config,
    root,
    configFile: false,
    logLevel: "silent",
    build: { ...config.build, write: false },
  });
  if (Array.isArray(result) || !("output" in result)) {
    throw new Error("Expected one production build output");
  }
  return result.output;
}

function chunks(output: Awaited<ReturnType<typeof buildOutput>>) {
  return output.filter((item): item is OutputChunk => item.type === "chunk");
}

function dependencies(output: OutputChunk[], name: string, dynamic = false) {
  const found = new Set<string>();
  function visit(chunk: OutputChunk) {
    if (found.has(chunk.name)) {
      return;
    }
    found.add(chunk.name);
    for (const file of [
      ...chunk.imports,
      ...(dynamic ? chunk.dynamicImports : []),
    ]) {
      visit(output.find((item) => item.fileName === file)!);
    }
  }
  visit(output.find((chunk) => chunk.name === name)!);
  return found;
}

test("data and functional changes preserve independent library caches", async () => {
  const root = await mkdtemp(join(tmpdir(), "sms-chunks-"));
  try {
    for (const path of ["src", "tsconfig.json", "index.html", "package.json"]) {
      await cp(path, join(root, path), { recursive: true });
    }
    await symlink(
      join(process.cwd(), "node_modules"),
      join(root, "node_modules")
    );
    const loaded = await loadConfigFromFile({
      command: "build",
      mode: "production",
    });
    const config = loaded!.config;
    const baseline = await buildOutput(root, config);
    const original = chunks(baseline);
    expect(
      baseline.filter(
        (item) => item.type === "asset" && item.fileName.endsWith(".json")
      )
    ).toHaveLength(4);
    for (const name of libraries) {
      const group = original.filter((chunk) => chunk.name === name);
      expect(group).toHaveLength(1);
      expect(
        Object.keys(group[0]!.modules).some((id) =>
          id.startsWith(`${root}/src/`)
        )
      ).toBe(false);
      expect(
        group[0]!.imports.every((file) =>
          libraries.includes(
            original.find((chunk) => chunk.fileName === file)!.name
          )
        )
      ).toBe(true);
    }
    const initial = dependencies(original, "app");
    for (const name of [
      "workspace",
      "codemirror",
      "reference",
      "prompt-package",
      "import-answer",
    ]) {
      expect(initial.has(name)).toBe(false);
    }
    const workspace = dependencies(original, "workspace");
    expect(workspace.has("app")).toBe(false);
    expect(workspace.has("prompt-package")).toBe(false);
    expect(workspace.has("import-answer")).toBe(false);

    const cases = [
      ["src/i18n/ru.json", "Назад к списку PR", "Вернуться к списку PR", "ru"],
      [
        "src/content/cookbook-snippets.generated.json",
        '"html":"',
        '"html":"Updated ',
        "cookbook-snippets",
      ],
      [
        "src/content/cookbook-snippets.generated.json",
        '"desc":"',
        '"desc":"Updated ',
        "cookbook-snippets",
      ],
      [
        "src/pages/Dashboard.tsx",
        "Pull Requests",
        "Pull Requests updated",
        "app",
      ],
      [
        "src/pages/BankWorkspace.tsx",
        "ui-panel-stack h-full",
        "ui-panel-stack h-full cache-probe",
        "workspace",
      ],
      [
        "src/features/prompt-package/PromptPackageModal.tsx",
        "ui-dialog-actions",
        "ui-dialog-actions cache-probe",
        "prompt-package",
      ],
      [
        "src/features/import-answer/ImportAnswerModal.tsx",
        "ui-dialog-actions",
        "ui-dialog-actions cache-probe",
        "import-answer",
      ],
    ] as const;
    for (const [path, from, to, changedName] of cases) {
      const fullPath = join(root, path);
      const source = await readFile(fullPath, "utf8");
      expect(source).toContain(from);
      await writeFile(fullPath, source.replace(from, to));
      const updated = await buildOutput(root, config);
      await writeFile(fullPath, source);
      const changed = chunks(updated)
        .filter(
          (chunk) =>
            original.find((item) => item.name === chunk.name)!.fileName !==
            chunk.fileName
        )
        .map((chunk) => chunk.name);
      expect(changed.some((name) => libraries.includes(name))).toBe(false);
      if (["ru", "cookbook-snippets"].includes(changedName)) {
        expect(changed).toEqual([]);
        const assets = updated.filter(
          (item) =>
            item.type === "asset" &&
            !baseline.some((before) => before.fileName === item.fileName)
        );
        expect(assets.map((item) => item.fileName)).toEqual([
          expect.stringMatching(
            new RegExp(`^assets/${changedName}-[a-f0-9]+\\.json$`)
          ),
        ]);
        expect(
          updated.find((item) => item.fileName === "index.html")
        ).not.toEqual(baseline.find((item) => item.fileName === "index.html"));
      } else {
        expect(changed).toContain(changedName);
        expect(
          changed.every((name) => dependencies(original, "app", true).has(name))
        ).toBe(true);
        expect(changed).not.toContain("shared");
        for (const name of ["prompt-package", "import-answer", "workspace"]) {
          if (
            name !== changedName &&
            !(changedName !== "app" && name === "workspace")
          ) {
            expect(changed).not.toContain(name);
          }
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
