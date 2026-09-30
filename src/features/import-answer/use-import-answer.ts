import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isBankFormatFilePath } from "@/domain/format";
import type { RepoRef } from "@/domain/types";
import { loadFileContents } from "@/infrastructure/file-content";
import {
  type AnswerChange,
  classifyPathViolation,
  isImportablePath,
  type ParsedAnswer,
  type PathViolation,
  parseAnswer,
} from "./core";

export interface ImportAnswerDraftEntry {
  content: string;
  baselineHeadSha: string;
  headContent: string | null;
  isDeleted: boolean;
}

export interface ImportAnswerDraftStore {
  getDraft: (filePath: string) => ImportAnswerDraftEntry | undefined;
  ensureDraft: (
    filePath: string,
    content: string,
    baseSha: string,
    headContent: string | null
  ) => void;
  applyUserEdit: (
    filePath: string,
    content: string,
    baseSha: string,
    headContent: string | null
  ) => void;
  markDeleted: (filePath: string) => void;
}

export interface ImportAnswerRow {
  change: AnswerChange;
  currentContent: string;
  headContent: string | null;
  existsAtHead: boolean;
  overwritesManualEdit: boolean;
  supersededBelow: boolean;
  violation: PathViolation | null;
}

export interface ImportAnswerSummary {
  written: number;
  deleted: number;
  intersectionsRecalculated: boolean;
}

export type ImportAnswerLoadError = "no-source" | "load-failed";

interface LoadBodiesParams {
  paths: string[];
  repository: RepoRef;
  prNumber: number;
  refName: string;
  headSha: string;
}

async function loadBodiesFromCache(
  params: LoadBodiesParams
): Promise<Map<string, string>> {
  const { paths, repository, refName } = params;
  return (
    await loadFileContents({ repository, commitSha: refName, filePaths: paths })
  ).contents;
}

export interface UseImportAnswerParams {
  bankPath: string;
  repository: RepoRef;
  prNumber: number | null;
  sourceRefName: string | undefined;
  headSha: string | undefined;
  existingPaths: ReadonlySet<string>;
  draftStore: ImportAnswerDraftStore;
  calculateIntersections: (filePaths?: string[]) => Promise<boolean>;
  loadBodies?: typeof loadBodiesFromCache;
}

export interface UseImportAnswerResult {
  text: string;
  setText: (text: string) => void;
  parsed: ParsedAnswer | null;
  rows: ImportAnswerRow[];
  violatedRows: ImportAnswerRow[];
  overwriteCount: number;
  isLoadingBodies: boolean;
  loadError: ImportAnswerLoadError | null;
  retry: () => void;
  canImport: boolean;
  recalculateIntersections: boolean;
  setRecalculateIntersections: (enabled: boolean) => void;
  isWriting: boolean;
  summary: ImportAnswerSummary | null;
  write: () => Promise<void>;
}

const NO_CHANGES: AnswerChange[] = [];
const NO_BODIES: ReadonlyMap<string, string> = new Map();

function collectImportBaselines(
  paths: string[],
  draftStore: ImportAnswerDraftStore,
  existingPaths: ReadonlySet<string>
) {
  const known = new Map<string, string>();
  const toFetch: string[] = [];
  for (const path of paths) {
    const draft = draftStore.getDraft(path);
    if (draft) {
      if (draft.headContent !== null) {
        known.set(path, draft.headContent);
      }
    } else if (existingPaths.has(path)) {
      toFetch.push(path);
    }
  }

  return { known, toFetch };
}

export function useImportAnswer(
  params: UseImportAnswerParams
): UseImportAnswerResult {
  const {
    bankPath,
    repository,
    prNumber,
    sourceRefName,
    headSha,
    existingPaths,
    draftStore,
    calculateIntersections,
    loadBodies = loadBodiesFromCache,
  } = params;

  const [text, setTextState] = useState("");
  const [recalculateIntersections, setRecalculateIntersections] =
    useState(true);
  const [remoteBodies, setRemoteBodies] =
    useState<ReadonlyMap<string, string>>(NO_BODIES);
  const [isLoadingBodies, setIsLoadingBodies] = useState(false);
  const [loadError, setLoadError] = useState<ImportAnswerLoadError | null>(
    null
  );
  const [isWriting, setIsWriting] = useState(false);
  const [summary, setSummary] = useState<ImportAnswerSummary | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const loadIdRef = useRef(0);

  const draftStoreRef = useRef(draftStore);
  draftStoreRef.current = draftStore;
  const existingPathsRef = useRef(existingPaths);
  existingPathsRef.current = existingPaths;
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  const parsed = useMemo(
    () => (text.trim() === "" ? null : parseAnswer(text)),
    [text]
  );
  const changes = parsed?.status === "parsed" ? parsed.changes : NO_CHANGES;

  const violationByPath = useMemo(() => {
    const result = new Map<string, PathViolation | null>();
    for (const change of changes) {
      if (!result.has(change.path)) {
        result.set(
          change.path,
          isImportablePath(change.path, bankPath)
            ? null
            : classifyPathViolation(change.path, bankPath)
        );
      }
    }
    return result;
  }, [bankPath, changes]);

  const hasViolations = useMemo(
    () => [...violationByPath.values()].some((violation) => violation !== null),
    [violationByPath]
  );

  const affectedPaths = useMemo(
    () => [...new Set(changes.map((change) => change.path))],
    [changes]
  );
  const affectedPathsKey = affectedPaths.join("\n");

  const setText = useCallback((next: string) => {
    setTextState(next);
    setSummary(null);
  }, []);

  const retry = useCallback(() => {
    setRetryTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;

    const paths = affectedPathsKey === "" ? [] : affectedPathsKey.split("\n");
    if (paths.length === 0 || hasViolations) {
      setRemoteBodies(NO_BODIES);
      setLoadError(null);
      setIsLoadingBodies(false);
      return;
    }

    const { known, toFetch } = collectImportBaselines(
      paths,
      draftStoreRef.current,
      existingPathsRef.current
    );

    if (toFetch.length === 0) {
      setRemoteBodies(known);
      setLoadError(null);
      setIsLoadingBodies(false);
      return;
    }
    if (!(prNumber && sourceRefName && headSha)) {
      setRemoteBodies(NO_BODIES);
      setLoadError("no-source");
      setIsLoadingBodies(false);
      return;
    }

    setIsLoadingBodies(true);
    setLoadError(null);
    loadBodies({
      paths: toFetch,
      repository: repositoryRef.current,
      prNumber,
      refName: sourceRefName,
      headSha,
    })
      .then((fetched) => {
        if (loadIdRef.current !== loadId) {
          return;
        }
        setRemoteBodies(new Map([...known, ...fetched]));
        setIsLoadingBodies(false);
      })
      .catch(() => {
        if (loadIdRef.current !== loadId) {
          return;
        }
        setRemoteBodies(NO_BODIES);
        setLoadError("load-failed");
        setIsLoadingBodies(false);
      });
  }, [
    affectedPathsKey,
    hasViolations,
    headSha,
    loadBodies,
    prNumber,
    retryTick,
    sourceRefName,
  ]);

  const rows = useMemo<ImportAnswerRow[]>(() => {
    const lastIndexByPath = new Map<string, number>();
    changes.forEach((change, index) => lastIndexByPath.set(change.path, index));
    return changes.map((change, index) => {
      const draft = draftStore.getDraft(change.path);
      const headContent = draft
        ? draft.headContent
        : (remoteBodies.get(change.path) ?? null);
      return {
        change,
        currentContent: draft?.content ?? headContent ?? "",
        headContent,
        existsAtHead: existingPaths.has(change.path),
        overwritesManualEdit: Boolean(
          draft && (draft.content !== draft.headContent || draft.isDeleted)
        ),
        supersededBelow: lastIndexByPath.get(change.path) !== index,
        violation: violationByPath.get(change.path) ?? null,
      };
    });
  }, [changes, draftStore, existingPaths, remoteBodies, violationByPath]);

  const violatedRows = useMemo(
    () => rows.filter((row) => row.violation !== null),
    [rows]
  );

  const overwriteCount = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => row.overwritesManualEdit)
          .map((row) => row.change.path)
      ).size,
    [rows]
  );

  const canImport =
    parsed?.status === "parsed" &&
    changes.length > 0 &&
    !(hasViolations || isLoadingBodies || isWriting) &&
    loadError === null &&
    summary === null;

  const write = useCallback(async () => {
    if (!canImport) {
      return;
    }
    setIsWriting(true);

    // The last block wins for each path.
    const finalKind = new Map<string, AnswerChange["kind"]>();
    for (const row of rows) {
      const { change, headContent } = row;
      const baseSha =
        draftStore.getDraft(change.path)?.baselineHeadSha ?? headSha ?? "";
      if (change.kind === "write") {
        draftStore.applyUserEdit(
          change.path,
          change.content,
          baseSha,
          headContent
        );
      } else {
        draftStore.ensureDraft(
          change.path,
          headContent ?? "",
          baseSha,
          headContent
        );
        draftStore.markDeleted(change.path);
      }
      finalKind.set(change.path, change.kind);
    }

    let intersectionsRecalculated = false;
    if (recalculateIntersections) {
      intersectionsRecalculated = await calculateIntersections(
        [
          ...new Set([...existingPaths, ...rows.map((row) => row.change.path)]),
        ].filter(
          (path) =>
            isBankFormatFilePath(path, bankPath) &&
            !draftStore.getDraft(path)?.isDeleted
        )
      );
    }

    const kinds = [...finalKind.values()];
    setSummary({
      written: kinds.filter((kind) => kind === "write").length,
      deleted: kinds.filter((kind) => kind === "delete").length,
      intersectionsRecalculated,
    });
    setIsWriting(false);
  }, [
    calculateIntersections,
    existingPaths,
    bankPath,
    canImport,
    draftStore,
    headSha,
    recalculateIntersections,
    rows,
  ]);

  return {
    text,
    setText,
    parsed,
    rows,
    violatedRows,
    overwriteCount,
    isLoadingBodies,
    loadError,
    retry,
    canImport,
    recalculateIntersections,
    setRecalculateIntersections,
    isWriting,
    summary,
    write,
  };
}
