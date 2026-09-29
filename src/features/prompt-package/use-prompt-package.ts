import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { COOKBOOK_MARKDOWN } from "@/content/cookbook.generated";
import { FORMAT_RULES_MARKDOWN } from "@/content/format-rules.generated";
import { SNIPPETS_TOML } from "@/content/snippets.generated";
import type { RepoRef } from "@/domain/types";
import type {
  BankFileRecord,
  BankInventory,
} from "@/features/bank-inventory/core";
import { loadRevisionBlobs } from "@/infrastructure/file-content";
import {
  type BlobFetchResult,
  fetchBlobsByRef,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
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

export interface PromptPackageDraftChange {
  filePath: string;
  content: string;
  headContent: string | null;
  isDeleted: boolean;
}

export interface PromptPackageDraftStore {
  getChangedFiles: () => PromptPackageDraftChange[];
}

export type PromptPackageErrorCode = "no-token" | "no-source" | "load-failed";

interface PromptPackageMaterials {
  layers: Record<PromptPackageLayer, PromptPackageFile[]>;
  skipped: PromptPackageSkippedFile[];
}

export interface UsePromptPackageParams {
  bankName: string;
  bankPath: string;
  repository: RepoRef;
  sourceRefName: string | undefined;
  mainRefName: string | undefined;
  inventory: Pick<
    BankInventory,
    "mainLayerPaths" | "prLayerPaths" | "recordsByPath"
  >;
  draftStore: PromptPackageDraftStore;
  fetchBlobs?: typeof fetchBlobsByRef;
}

export interface UsePromptPackageResult {
  hasToken: boolean;
  task: string;
  setTask: (task: string) => void;
  documents: PromptPackageDocumentSelection;
  toggleDocument: (key: PromptPackageDocumentKey, enabled: boolean) => void;
  reset: () => void;
  isBuilding: boolean;
  error: PromptPackageErrorCode | null;
  errorDetail: string | null;
  result: PromptPackage | null;
  build: () => Promise<void>;
}

function isPackagedFile(record: BankFileRecord): boolean {
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
      if (!change.filePath.startsWith(`${bankPath}/`)) {
        return false;
      }
      const record = inventory.recordsByPath.get(change.filePath);
      return record ? isPackagedFile(record) : false;
    })
    .map((change) => ({
      path: change.filePath,
      content: change.isDeleted ? null : change.content,
    }))
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
    mainRefName,
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
    if (!(sourceRefName && mainRefName)) {
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
    const freePrContents = new Map(
      draftStore
        .getChangedFiles()
        .filter((change) => change.headContent !== null)
        .map((change) => [change.filePath, change.headContent])
    );
    const prPathsToFetch = prPaths.filter((path) => !freePrContents.has(path));

    try {
      const [mainResults, prResults] = await Promise.all([
        mainPaths.length > 0
          ? loadRevisionBlobs(mainRefName, mainPaths, repository, fetchBlobs)
          : Promise.resolve<BlobFetchResult[]>([]),
        prPathsToFetch.length > 0
          ? loadRevisionBlobs(
              sourceRefName,
              prPathsToFetch,
              repository,
              fetchBlobs
            )
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
        layers: {
          main: mainLayer.files,
          pr: [
            ...prFiles,
            ...[...inventory.recordsByPath.values()]
              .filter(
                (record) =>
                  isPackagedFile(record) && record.source === "deleted"
              )
              .map((record) => ({ path: record.path, content: null })),
            ...inventory.mainLayerPaths
              .filter((path) => !inventory.recordsByPath.has(path))
              .map((path) => ({ path, content: null })),
          ],
          draft: draftFiles,
        },
        skipped: [...mainLayer.skipped, ...fetchedPrLayer.skipped],
      });
      setIsBuilding(false);
    } catch (caught) {
      if (buildIdRef.current !== buildId) {
        return;
      }
      setMaterials(null);
      setError("load-failed");
      setErrorDetail(
        caught instanceof Error ? caught.message : String(caught ?? "")
      );
      setIsBuilding(false);
    }
  }, [
    bankPath,
    draftStore,
    fetchBlobs,
    hasToken,
    inventory,
    repository,
    sourceRefName,
    mainRefName,
  ]);

  const result = useMemo<PromptPackage | null>(
    () =>
      materials === null
        ? null
        : buildPromptPackage({
            bankName,
            bankPath,
            layers: materials.layers,
            documents: selectedDocuments,
            task: sticky.task,
            skipped: materials.skipped,
          }),
    [bankName, bankPath, materials, selectedDocuments, sticky.task]
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
