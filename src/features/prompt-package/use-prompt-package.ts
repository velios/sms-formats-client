// Fetching boundary of the prompt package: token gate, bodies of the three
// layers, sticky task/documents, assembly through the pure `buildPromptPackage`
// (ADR-0016). The package goes around the file content cache — every build is a
// clean request.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { config } from "@/config";
import { COOKBOOK_MARKDOWN } from "@/content/cookbook.generated";
import { FORMAT_RULES_MARKDOWN } from "@/content/format-rules.generated";
import { SNIPPETS_TOML } from "@/content/snippets.generated";
import {
  type BlobFetchResult,
  fetchBlobsByRef,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  subscribeGitHubAuthChange,
} from "@/domain/github";
import type { RepoRef } from "@/domain/types";
import type {
  BankFileRecord,
  BankInventory,
} from "@/features/bank-inventory/core";
import {
  buildPromptPackage,
  type PromptPackage,
  type PromptPackageDocument,
  type PromptPackageFile,
  type PromptPackageLayer,
  type PromptPackageSkippedFile,
} from "./core";

export type PromptPackageDocumentKey = "cookbook" | "formatRules" | "snippets";

export type PromptPackageDocumentSelection = Record<
  PromptPackageDocumentKey,
  boolean
>;

// Documents as the human edits them: source file name plus raw source, in the
// order they are printed in the package.
const DOCUMENTS: Array<{
  key: PromptPackageDocumentKey;
  name: string;
  content: string;
}> = [
  { key: "cookbook", name: "cookbook.md", content: COOKBOOK_MARKDOWN },
  {
    key: "formatRules",
    name: "format-rules.md",
    content: FORMAT_RULES_MARKDOWN,
  },
  { key: "snippets", name: "regex-snippets.toml", content: SNIPPETS_TOML },
];

// One key for the whole application, not per bank: the main scenario is running
// one wording across several similar banks (ADR-0016).
const STICKY_STORAGE_KEY = "sms-formats-prompt-package";

const DEFAULT_DOCUMENT_SELECTION: PromptPackageDocumentSelection = {
  cookbook: true,
  formatRules: true,
  snippets: true,
};

export interface PromptPackageStickyState {
  task: string;
  documents: PromptPackageDocumentSelection;
}

const DEFAULT_STICKY_STATE: PromptPackageStickyState = {
  task: "",
  documents: DEFAULT_DOCUMENT_SELECTION,
};

function readStickyState(): PromptPackageStickyState {
  const raw = localStorage.getItem(STICKY_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_STICKY_STATE;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PromptPackageStickyState> | null;
    const documents: Partial<PromptPackageDocumentSelection> =
      parsed?.documents ?? {};
    return {
      task: typeof parsed?.task === "string" ? parsed.task : "",
      documents: {
        cookbook: documents.cookbook !== false,
        formatRules: documents.formatRules !== false,
        snippets: documents.snippets !== false,
      },
    };
  } catch {
    return DEFAULT_STICKY_STATE;
  }
}

function writeStickyState(state: PromptPackageStickyState): void {
  localStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(state));
}

// Only what the draft store already holds: `content` is the draft layer,
// `remoteContent` is the head-ref body of a changed file — both free.
export interface PromptPackageDraftChange {
  filePath: string;
  content: string;
  remoteContent: string;
  isDeleted: boolean;
}

export interface PromptPackageDraftStore {
  getChangedFiles: () => PromptPackageDraftChange[];
}

export type PromptPackageErrorCode = "no-token" | "no-source" | "load-failed";

// What one fetch brought home: the bodies of the three layers plus the files
// that could not be put into the package. The task and the document checkboxes
// do not belong here — they change the assembled string, not the material, so
// changing them must never cost a request.
interface PromptPackageMaterials {
  layers: Record<PromptPackageLayer, PromptPackageFile[]>;
  skipped: PromptPackageSkippedFile[];
}

export interface UsePromptPackageParams {
  bankName: string;
  bankPath: string;
  repository: RepoRef;
  // head-ref of the source (sha or branch name) — the ref of the `pr` layer.
  sourceRefName: string | undefined;
  // Bank composition: `mainLayerPaths` and `prLayerPaths` for the two fetched
  // layers, `recordsByPath` for what changed in the browser.
  inventory: Pick<
    BankInventory,
    "mainLayerPaths" | "prLayerPaths" | "recordsByPath"
  >;
  draftStore: PromptPackageDraftStore;
  // Seam for tests; production always goes to GitHub GraphQL.
  fetchBlobs?: typeof fetchBlobsByRef;
}

export interface UsePromptPackageResult {
  // Token gate: the feature is unusable anonymously (GraphQL answers 403).
  hasToken: boolean;
  task: string;
  setTask: (task: string) => void;
  documents: PromptPackageDocumentSelection;
  toggleDocument: (key: PromptPackageDocumentKey, enabled: boolean) => void;
  // Back to the default: empty task, all documents on.
  reset: () => void;
  isBuilding: boolean;
  error: PromptPackageErrorCode | null;
  // Message of the failed GraphQL call, for the retry prompt.
  errorDetail: string | null;
  // Assembled from the fetched materials on every render: editing the task or
  // a checkbox re-renders the string, never re-fetches. Never partial — on any
  // failure this stays null (ADR-0016).
  result: PromptPackage | null;
  // Fetches the bodies of the layers and keeps them. Called when the subject of
  // the fetch appears or changes and on an explicit retry — not on typing.
  build: () => Promise<void>;
}

function isPackagedFile(record: BankFileRecord): boolean {
  // Bank content upstream: format files and senders.txt, no unsupported files.
  return record.fileClass === "format" || record.fileClass === "senders";
}

function resolveDraftLayerFiles(params: {
  bankPath: string;
  inventory: UsePromptPackageParams["inventory"];
  draftStore: PromptPackageDraftStore;
}): PromptPackageFile[] {
  const { bankPath, inventory, draftStore } = params;
  return draftStore
    .getChangedFiles()
    .filter((change) => {
      if (change.isDeleted || !change.filePath.startsWith(`${bankPath}/`)) {
        return false;
      }
      const record = inventory.recordsByPath.get(change.filePath);
      return record ? isPackagedFile(record) : false;
    })
    .map((change) => ({ path: change.filePath, content: change.content }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

interface CollectedLayer {
  files: PromptPackageFile[];
  skipped: PromptPackageSkippedFile[];
}

function collectFetchedLayer(
  paths: string[],
  results: BlobFetchResult[]
): CollectedLayer {
  const byPath = new Map(results.map((result) => [result.path, result]));
  const files: PromptPackageFile[] = [];
  const skipped: PromptPackageSkippedFile[] = [];
  for (const path of paths) {
    const result = byPath.get(path);
    // `missing` and an absent result mean the same thing: no record in the
    // layer. `binary` and `truncated` are skipped and never printed, otherwise
    // the legend would lie.
    if (!result || result.status === "missing") {
      continue;
    }
    if (result.status === "loaded") {
      files.push({ path, content: result.text });
      continue;
    }
    skipped.push({ path, reason: result.status });
  }
  return { files, skipped };
}

export function usePromptPackage(
  params: UsePromptPackageParams
): UsePromptPackageResult {
  const {
    bankName,
    bankPath,
    repository,
    sourceRefName,
    inventory,
    draftStore,
    fetchBlobs = fetchBlobsByRef,
  } = params;

  useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const hasToken = Boolean(getGitHubUserToken()?.trim());

  const [sticky, setSticky] =
    useState<PromptPackageStickyState>(readStickyState);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState<PromptPackageErrorCode | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [materials, setMaterials] = useState<PromptPackageMaterials | null>(
    null
  );
  const buildIdRef = useRef(0);

  useEffect(() => {
    writeStickyState(sticky);
  }, [sticky]);

  const setTask = useCallback((task: string) => {
    setSticky((current) => ({ ...current, task }));
  }, []);

  const toggleDocument = useCallback(
    (key: PromptPackageDocumentKey, enabled: boolean) => {
      setSticky((current) => ({
        ...current,
        documents: { ...current.documents, [key]: enabled },
      }));
    },
    []
  );

  const reset = useCallback(() => {
    setSticky(DEFAULT_STICKY_STATE);
  }, []);

  const selectedDocuments = useMemo<PromptPackageDocument[]>(
    () =>
      DOCUMENTS.filter((document) => sticky.documents[document.key]).map(
        (document) => ({ name: document.name, content: document.content })
      ),
    [sticky.documents]
  );

  const build = useCallback(async () => {
    const buildId = buildIdRef.current + 1;
    buildIdRef.current = buildId;

    if (!hasToken) {
      setMaterials(null);
      setErrorDetail(null);
      setError("no-token");
      setIsBuilding(false);
      return;
    }
    if (!sourceRefName) {
      setMaterials(null);
      setErrorDetail(null);
      setError("no-source");
      setIsBuilding(false);
      return;
    }

    setIsBuilding(true);
    setError(null);
    setErrorDetail(null);

    const mainPaths = inventory.mainLayerPaths;
    const prPaths = inventory.prLayerPaths;
    const draftFiles = resolveDraftLayerFiles({
      bankPath,
      inventory,
      draftStore,
    });
    // Head-ref bodies of files changed in the browser are free; the rest of the
    // `pr` layer goes to the network.
    const freePrContents = new Map(
      draftStore
        .getChangedFiles()
        .filter((change) => change.remoteContent !== "")
        .map((change) => [change.filePath, change.remoteContent])
    );
    const prPathsToFetch = prPaths.filter((path) => !freePrContents.has(path));

    try {
      // Both refs in one pass: any rejection loses the whole build, and that is
      // the point — a half package is more dangerous than none.
      const [mainResults, prResults] = await Promise.all([
        mainPaths.length > 0
          ? fetchBlobs(config.defaultBranch, mainPaths, repository)
          : Promise.resolve<BlobFetchResult[]>([]),
        prPathsToFetch.length > 0
          ? fetchBlobs(sourceRefName, prPathsToFetch, repository)
          : Promise.resolve<BlobFetchResult[]>([]),
      ]);
      if (buildIdRef.current !== buildId) {
        return;
      }

      const mainLayer = collectFetchedLayer(mainPaths, mainResults);
      const fetchedPrLayer = collectFetchedLayer(prPathsToFetch, prResults);
      const prFiles = [
        ...fetchedPrLayer.files,
        ...prPaths
          .filter((path) => freePrContents.has(path))
          .map((path) => ({
            path,
            content: freePrContents.get(path) ?? "",
          })),
      ].sort((a, b) => a.path.localeCompare(b.path));

      setMaterials({
        layers: { main: mainLayer.files, pr: prFiles, draft: draftFiles },
        skipped: [...mainLayer.skipped, ...fetchedPrLayer.skipped],
      });
      setIsBuilding(false);
    } catch (caught) {
      if (buildIdRef.current !== buildId) {
        return;
      }
      // Nothing is assembled from a failed load: the caller shows the error and
      // offers a retry.
      setMaterials(null);
      setError("load-failed");
      setErrorDetail(
        caught instanceof Error ? caught.message : String(caught ?? "")
      );
      setIsBuilding(false);
    }
    // Deliberately not the task and not the document selection: they are the
    // subject of the assembly below, not of the fetch.
  }, [
    bankPath,
    draftStore,
    fetchBlobs,
    hasToken,
    inventory,
    repository,
    sourceRefName,
  ]);

  // The assembly is a pure function of already fetched facts (ADR-0016), so it
  // runs on render: typing in the task field costs a string, not a request.
  const result = useMemo<PromptPackage | null>(
    () =>
      materials === null
        ? null
        : buildPromptPackage({
            bankName,
            layers: materials.layers,
            documents: selectedDocuments,
            task: sticky.task,
            skipped: materials.skipped,
          }),
    [bankName, materials, selectedDocuments, sticky.task]
  );

  return {
    hasToken,
    task: sticky.task,
    setTask,
    documents: sticky.documents,
    toggleDocument,
    reset,
    isBuilding,
    error,
    errorDetail,
    result,
    build,
  };
}
