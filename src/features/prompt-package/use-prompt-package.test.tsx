import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobFetchResult, fetchBlobsByRef } from "@/domain/github";
import { buildBankInventory } from "@/features/bank-inventory/core";
import { PROMPT_PRESETS } from "./core";
import {
  type PromptPackageDraftChange,
  type UsePromptPackageParams,
  usePromptPackage,
} from "./use-prompt-package";

const tokenState = { token: "ghp_user" as string | null };

vi.mock("@/domain/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/github")>();
  return {
    ...actual,
    getGitHubUserToken: () => tokenState.token,
    subscribeGitHubAuthChange: () => () => undefined,
    getGitHubAuthChangeVersion: () => 0,
  };
});

const BANK_PATH = "src/TBank_123";
const SENDERS = `${BANK_PATH}/senders.txt`;
const FORMAT_A = `${BANK_PATH}/formats/a.txt`;
const FORMAT_B = `${BANK_PATH}/formats/b.txt`;
const FORMAT_C = `${BANK_PATH}/formats/c.txt`;
const STICKY_KEY = "sms-formats-prompt-package";

function formatFile(regex: string, examples: string[]): string {
  return [
    regex,
    "",
    "-----COLUMNS-----",
    "comment",
    ...examples.flatMap((example) => ["", "-----EXAMPLE-----", example]),
  ].join("\n");
}

function draftChange(
  overrides: Partial<PromptPackageDraftChange> &
    Pick<PromptPackageDraftChange, "filePath">
): PromptPackageDraftChange {
  return {
    content: "draft body",
    remoteContent: "head body",
    isDeleted: false,
    ...overrides,
  };
}

// A bank whose head-ref holds a.txt, b.txt and senders.txt; c.txt is added in
// the PR; b.txt and c.txt are edited in the browser.
const DRAFT_CHANGES: PromptPackageDraftChange[] = [
  draftChange({
    filePath: FORMAT_B,
    content: "draft b",
    remoteContent: "head b",
  }),
];

function buildInventory() {
  return buildBankInventory({
    bankPath: BANK_PATH,
    sendersPath: SENDERS,
    remoteFormatFiles: [FORMAT_A, FORMAT_B, FORMAT_C],
    draftPaths: [FORMAT_B],
    localChanges: DRAFT_CHANGES,
    sourceChanges: [
      { path: FORMAT_B, kind: "modify" },
      { path: FORMAT_C, kind: "add" },
    ],
  });
}

function loadedBlobs(ref: string, paths: string[]): BlobFetchResult[] {
  return paths.map((path) => ({
    path,
    status: "loaded" as const,
    text: `${ref} body of ${path}`,
  }));
}

function makeParams(
  overrides: Partial<UsePromptPackageParams> = {}
): UsePromptPackageParams {
  return {
    bankName: "Т-Банк",
    bankPath: BANK_PATH,
    repository: { owner: "zenmoney", repo: "sms-formats" },
    sourceRefName: "head-sha",
    inventory: buildInventory(),
    draftStore: { getChangedFiles: () => DRAFT_CHANGES },
    fetchBlobs: vi.fn(async (ref: string, paths: string[]) =>
      loadedBlobs(ref, paths)
    ) as unknown as typeof fetchBlobsByRef,
    ...overrides,
  };
}

let localStorageState: Map<string, string>;

beforeEach(() => {
  localStorageState = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => localStorageState.get(key) ?? null,
    removeItem: (key: string) => {
      localStorageState.delete(key);
    },
    setItem: (key: string, value: string) => {
      localStorageState.set(key, value);
    },
  });
  tokenState.token = "ghp_user";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePromptPackage layers", () => {
  it("fetches main from the default branch and only the unfree part of pr, drafts stay free", async () => {
    const fetchBlobs = vi.fn(async (ref: string, paths: string[]) =>
      loadedBlobs(ref, paths)
    ) as unknown as typeof fetchBlobsByRef;
    const { result } = renderHook(() =>
      usePromptPackage(makeParams({ fetchBlobs }))
    );

    await act(async () => {
      await result.current.build();
    });

    const calls = (fetchBlobs as unknown as ReturnType<typeof vi.fn>).mock
      .calls as unknown[];
    // main: head-ref composition minus files added in the PR.
    // pr: only the changed files, and b.txt is free from `remoteContent`.
    expect(calls).toEqual([
      [
        "main",
        [FORMAT_A, FORMAT_B, SENDERS],
        { owner: "zenmoney", repo: "sms-formats" },
      ],
      ["head-sha", [FORMAT_C], { owner: "zenmoney", repo: "sms-formats" }],
    ]);

    const text = result.current.result?.text ?? "";
    expect(text).toContain(`<files layer="main">`);
    expect(text).toContain(`main body of ${FORMAT_A}`);
    expect(text).toContain("head b");
    expect(text).toContain(`head-sha body of ${FORMAT_C}`);
    expect(text).toContain("draft b");
    expect(result.current.result?.summary.layers).toEqual([
      { layer: "main", fileCount: 3 },
      { layer: "pr", fileCount: 2 },
      { layer: "draft", fileCount: 1 },
    ]);
    expect(result.current.result?.summary.documents).toEqual([
      "cookbook.md",
      "format-rules.md",
      "regex-snippets.toml",
    ]);
  });

  it("counts intersections over the effective versions of the format files", async () => {
    // a.txt is harmless in `main` and reaches over into b.txt in `draft`: the
    // block must judge the version that actually applies.
    const bodies: Record<string, string> = {
      [FORMAT_A]: formatFile("^PAY (\\d+)$", ["PAY 100"]),
      [FORMAT_B]: formatFile("^СБП: Перевод (.+)$", [
        "СБП: Перевод Ольга В. Списано 10000 р.",
      ]),
      [FORMAT_C]: formatFile("^CARD (\\d+)$", ["CARD 1"]),
      [SENDERS]: "900",
    };
    const fetchBlobs = vi.fn(
      async (_ref: string, paths: string[]): Promise<BlobFetchResult[]> =>
        paths.map((path) => ({
          path,
          status: "loaded" as const,
          text: bodies[path] ?? "",
        }))
    ) as unknown as typeof fetchBlobsByRef;
    const draftStore = {
      getChangedFiles: () => [
        draftChange({
          filePath: FORMAT_A,
          content: formatFile("^СБП: (.+)$", ["СБП: Списано 100 р."]),
          remoteContent: bodies[FORMAT_A] ?? "",
        }),
      ],
    };
    const { result } = renderHook(() =>
      usePromptPackage(makeParams({ draftStore, fetchBlobs }))
    );

    await act(async () => {
      await result.current.build();
    });

    const text = result.current.result?.text ?? "";
    expect(text).toContain(
      `${FORMAT_A} → ${FORMAT_B}\n  «СБП: Перевод Ольга В. Списано 10000 р.»`
    );
    // senders.txt is not a format and never takes part in the count.
    expect(text).not.toContain(`${SENDERS} → `);
  });

  it("keeps binary and truncated bodies out of the text and reports them as skipped", async () => {
    const fetchBlobs = vi.fn(
      async (ref: string, paths: string[]): Promise<BlobFetchResult[]> =>
        paths.map((path) => {
          if (path === FORMAT_A) {
            return { path, status: "binary" };
          }
          if (path === SENDERS) {
            return { path, status: "truncated" };
          }
          return { path, status: "loaded", text: `${ref} body of ${path}` };
        })
    ) as unknown as typeof fetchBlobsByRef;
    const { result } = renderHook(() =>
      usePromptPackage(makeParams({ fetchBlobs }))
    );

    await act(async () => {
      await result.current.build();
    });

    expect(result.current.result?.summary.skipped).toEqual([
      { path: FORMAT_A, reason: "binary" },
      { path: SENDERS, reason: "truncated" },
    ]);
    expect(result.current.result?.text).not.toContain(FORMAT_A);
    expect(result.current.result?.summary.layers[0]).toEqual({
      layer: "main",
      fileCount: 1,
    });
  });

  it("does not build without a token", async () => {
    tokenState.token = null;
    const fetchBlobs = vi.fn(async (ref: string, paths: string[]) =>
      loadedBlobs(ref, paths)
    ) as unknown as typeof fetchBlobsByRef;
    const { result } = renderHook(() =>
      usePromptPackage(makeParams({ fetchBlobs }))
    );

    expect(result.current.hasToken).toBe(false);
    await act(async () => {
      await result.current.build();
    });

    expect(fetchBlobs).not.toHaveBeenCalled();
    expect(result.current.error).toBe("no-token");
    expect(result.current.result).toBeNull();
  });
});

describe("usePromptPackage failure", () => {
  it("gives an error and no partial text when a batch fails, and rebuilds on retry", async () => {
    let shouldFail = true;
    const fetchBlobs = vi.fn(async (ref: string, paths: string[]) => {
      if (shouldFail && ref === "head-sha") {
        throw new Error("GraphQL timeout");
      }
      return loadedBlobs(ref, paths);
    }) as unknown as typeof fetchBlobsByRef;
    const { result } = renderHook(() =>
      usePromptPackage(makeParams({ fetchBlobs }))
    );

    await act(async () => {
      await result.current.build();
    });

    // The main layer loaded fine — but nothing of it reaches the caller.
    expect(result.current.error).toBe("load-failed");
    expect(result.current.errorDetail).toBe("GraphQL timeout");
    expect(result.current.result).toBeNull();
    expect(result.current.isBuilding).toBe(false);

    shouldFail = false;
    await act(async () => {
      await result.current.build();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result?.text).toContain(
      `head-sha body of ${FORMAT_C}`
    );
  });
});

describe("usePromptPackage sticky state", () => {
  it("survives remount and a change of bank under a single localStorage key", async () => {
    const first = renderHook(
      (params: UsePromptPackageParams) => usePromptPackage(params),
      { initialProps: makeParams() }
    );

    act(() => {
      first.result.current.setTask("сведи форматы в один");
      first.result.current.toggleDocument("snippets", false);
    });
    await waitFor(() => {
      expect(localStorageState.get(STICKY_KEY)).toContain("сведи");
    });

    // Another bank in the same mount: the key is not scoped to a bank.
    first.rerender(
      makeParams({ bankName: "Ощадбанк", bankPath: "src/Oschad_1" })
    );
    expect(first.result.current.task).toBe("сведи форматы в один");
    expect(first.result.current.documents.snippets).toBe(false);

    first.unmount();
    const second = renderHook(() => usePromptPackage(makeParams()));
    expect(second.result.current.task).toBe("сведи форматы в один");
    expect(second.result.current.documents).toEqual({
      cookbook: true,
      formatRules: true,
      snippets: false,
    });
    expect([...localStorageState.keys()]).toEqual([STICKY_KEY]);

    act(() => {
      second.result.current.reset();
    });
    expect(second.result.current.task).toBe("");
    expect(second.result.current.documents).toEqual({
      cookbook: true,
      formatRules: true,
      snippets: true,
    });
    await waitFor(() => {
      expect(localStorageState.get(STICKY_KEY)).toBe(
        JSON.stringify({
          task: "",
          documents: { cookbook: true, formatRules: true, snippets: true },
        })
      );
    });
    expect([...localStorageState.keys()]).toEqual([STICKY_KEY]);
  });

  it("puts only the checked documents into the package", async () => {
    const { result } = renderHook(() => usePromptPackage(makeParams()));

    act(() => {
      result.current.toggleDocument("cookbook", false);
      result.current.toggleDocument("formatRules", false);
      result.current.setTask("почини регулярку");
    });
    await act(async () => {
      await result.current.build();
    });

    expect(result.current.result?.summary.documents).toEqual([
      "regex-snippets.toml",
    ]);
    expect(result.current.result?.text).toContain("почини регулярку");
  });

  it("takes a preset into the task and lets it be edited afterwards", async () => {
    const preset = PROMPT_PRESETS.find((item) => item.key === "tidyBank");
    const { result } = renderHook(() => usePromptPackage(makeParams()));

    act(() => {
      result.current.setTask("старый текст");
      // The preset overwrites the field: it is a default wording, not a merge.
      result.current.setTask(preset?.task ?? "");
    });
    await act(async () => {
      await result.current.build();
    });
    expect(result.current.task).toBe(preset?.task);
    expect(result.current.result?.text).toContain(preset?.task);
    expect(result.current.result?.text).not.toContain("старый текст");

    // The field stays an ordinary field after the substitution.
    act(() => {
      result.current.setTask(`${preset?.task}\n\n7. И почини senders.txt.`);
    });
    expect(result.current.result?.text).toContain("7. И почини senders.txt.");
  });

  it("re-assembles the package from the fetched bodies without fetching again", async () => {
    const fetchBlobs = vi.fn(async (ref: string, paths: string[]) =>
      loadedBlobs(ref, paths)
    ) as unknown as typeof fetchBlobsByRef;
    const { result } = renderHook(() =>
      usePromptPackage(makeParams({ fetchBlobs }))
    );

    await act(async () => {
      await result.current.build();
    });
    expect(fetchBlobs).toHaveBeenCalledTimes(2);

    // Typing the task letter by letter and toggling a checkbox: the material is
    // already home, so this costs strings, not requests.
    act(() => {
      for (const task of ["с", "св", "сведи форматы"]) {
        result.current.setTask(task);
      }
      result.current.toggleDocument("cookbook", false);
    });

    expect(fetchBlobs).toHaveBeenCalledTimes(2);
    // And the package follows the field: no stale task, no stale documents.
    expect(result.current.result?.text).toContain(
      "<task>\nсведи форматы\n</task>"
    );
    expect(result.current.result?.summary.documents).toEqual([
      "format-rules.md",
      "regex-snippets.toml",
    ]);
    expect(result.current.result?.text).toContain(`main body of ${FORMAT_A}`);
  });
});
