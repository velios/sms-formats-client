// Fetching and writing boundary of the answer import: the pure verdict comes
// from `core`, this hook adds the bodies in force and the drafts (ADR-0017).
// The draft store gets no new methods — writing is a loop over the same calls
// a manual edit makes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepoRef } from "@/domain/types";
import { useFileContentStore } from "@/store/file-content-store";
import {
  type AnswerChange,
  classifyPathViolation,
  isImportablePath,
  type ParsedAnswer,
  type PathViolation,
  parseAnswer,
} from "./core";

// Only what the draft store already holds. Structurally satisfied by
// `useDraftStore()`, so production passes the store itself.
export interface ImportAnswerDraftEntry {
  content: string;
  baseSha: string;
  remoteContent: string;
  isDeleted: boolean;
}

export interface ImportAnswerDraftStore {
  getDraft: (filePath: string) => ImportAnswerDraftEntry | undefined;
  ensureDraft: (
    filePath: string,
    content: string,
    baseSha: string,
    remoteContent: string
  ) => void;
  applyUserEdit: (
    filePath: string,
    content: string,
    baseSha: string,
    remoteContent: string
  ) => void;
  markDeleted: (filePath: string) => void;
}

export interface ImportAnswerRow {
  change: AnswerChange;
  /** The body in force: the draft if there is one, otherwise the head ref. */
  currentContent: string;
  /** The head-ref body; empty when the answer creates the file. */
  remoteContent: string;
  existsAtHead: boolean;
  /** A draft here already differs from the head ref — the import overwrites it. */
  overwritesManualEdit: boolean;
  /** A later block in the answer writes the same path and wins. */
  supersededBelow: boolean;
  /** Out of bounds; one violated row refuses the whole import. */
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

// Bodies of the affected paths through the existing lazy cache. Rejects if any
// one of them fails: a half "before" lies exactly the way a half package does.
async function loadBodiesFromCache(
  params: LoadBodiesParams
): Promise<Map<string, string>> {
  const { paths, repository, prNumber, refName, headSha } = params;
  const store = useFileContentStore.getState();
  const bodies = await Promise.all(
    paths.map((filePath) =>
      store.primeFileContent({
        repository,
        prNumber,
        filePath,
        refName,
        headSha,
        loadedFrom: "editor",
      })
    )
  );
  const result = new Map<string, string>();
  for (const [index, path] of paths.entries()) {
    const body = bodies[index];
    if (typeof body !== "string") {
      throw new Error(`failed to load ${path}`);
    }
    result.set(path, body);
  }
  return result;
}

export interface UseImportAnswerParams {
  bankPath: string;
  repository: RepoRef;
  prNumber: number | null;
  // head-ref of the source (sha or branch name) and its sha — the ref the
  // bodies in force are read from.
  sourceRefName: string | undefined;
  headSha: string | undefined;
  /**
   * Bank paths present at the head ref. Anything else the answer names is a
   * file it creates — asking GitHub for it would answer 404 and be mistaken
   * for a failed load.
   */
  existingPaths: ReadonlySet<string>;
  draftStore: ImportAnswerDraftStore;
  /** The existing full recount; the checkbox only decides whether to run it. */
  calculateIntersections: () => Promise<void>;
  // Seam for tests; production goes to the file content cache.
  loadBodies?: typeof loadBodiesFromCache;
}

export interface UseImportAnswerResult {
  text: string;
  setText: (text: string) => void;
  /** null while the field is empty — there is nothing to judge yet. */
  parsed: ParsedAnswer | null;
  rows: ImportAnswerRow[];
  /** Rows out of bounds; a non-empty list refuses the import whole. */
  violatedRows: ImportAnswerRow[];
  /** How many rows overwrite a manual edit — the counter in the header. */
  overwriteCount: number;
  isLoadingBodies: boolean;
  loadError: ImportAnswerLoadError | null;
  retry: () => void;
  canImport: boolean;
  recalculateIntersections: boolean;
  setRecalculateIntersections: (enabled: boolean) => void;
  isWriting: boolean;
  /** Filled once the drafts are written; the right pane becomes the summary. */
  summary: ImportAnswerSummary | null;
  write: () => Promise<void>;
}

const NO_CHANGES: AnswerChange[] = [];
// One instance, so "nothing to show" never counts as a state change and the
// load effect cannot re-trigger itself.
const NO_BODIES: ReadonlyMap<string, string> = new Map();

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
  // Not sticky by design: this is a setting of one run, and a silent "off
  // forever" is exactly what stickiness would buy (ADR-0017).
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

  // Read inside the load effect only: their identity changes on every draft
  // edit, and re-fetching the same bodies on every keystroke elsewhere in the
  // app is not what "the draft is free" means.
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
  // Stable dependency for the load effect: the same set of paths must not
  // restart a load just because the answer was re-parsed.
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

    const known = new Map<string, string>();
    const toFetch: string[] = [];
    for (const path of paths) {
      const draft = draftStoreRef.current.getDraft(path);
      if (draft) {
        // The draft carries the head-ref body it was based on — free.
        known.set(path, draft.remoteContent);
      } else if (existingPathsRef.current.has(path)) {
        toFetch.push(path);
      } else {
        known.set(path, "");
      }
    }

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
        // Nothing is shown from a failed load: the caller offers a retry.
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
      const remoteContent =
        draft?.remoteContent ?? remoteBodies.get(change.path) ?? "";
      return {
        change,
        currentContent: draft?.content ?? remoteContent,
        remoteContent,
        existsAtHead: existingPaths.has(change.path),
        // A draft that only mirrors the head ref is not a manual edit: opening
        // a file in the editor creates one, and warning about it would cry
        // wolf on every file the human merely looked at.
        overwritesManualEdit: Boolean(
          draft && (draft.content !== draft.remoteContent || draft.isDeleted)
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

    // Answer order is apply order, so the last block on a path wins by simply
    // being written last.
    const finalKind = new Map<string, AnswerChange["kind"]>();
    for (const row of rows) {
      const { change, remoteContent } = row;
      const baseSha =
        draftStore.getDraft(change.path)?.baseSha ?? headSha ?? "";
      if (change.kind === "write") {
        // The same call a manual edit makes, so per-path history exists and
        // undo steps back to what stood here before the import.
        draftStore.applyUserEdit(
          change.path,
          change.content,
          baseSha,
          remoteContent
        );
      } else {
        // `markDeleted` is a no-op without a draft, and the editor creates one
        // by opening the file; here the import has to create it itself.
        draftStore.ensureDraft(
          change.path,
          remoteContent,
          baseSha,
          remoteContent
        );
        draftStore.markDeleted(change.path);
      }
      finalKind.set(change.path, change.kind);
    }

    let intersectionsRecalculated = false;
    if (recalculateIntersections) {
      // ponytail: `useIntersections` drops a run started before React commits
      // the draft change (its reset effect bumps the run id), so let that
      // commit flush first. Upgrade path — a run id the caller can pin.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await calculateIntersections();
      intersectionsRecalculated = true;
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
