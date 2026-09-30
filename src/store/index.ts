import { createTravels, type Travels } from "travels";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { config } from "@/config";
import type { BankInfo, FileEntry, RepoRef, SourceRef } from "@/domain/types";
import { isExperimentScope } from "./draft-scope";
import { DRAFT_STORE_STORAGE_KEY, draftStoreStateStorage } from "./persistence";
import type { SavedWorkspaceSession } from "./workspace-session";

interface SourceState {
  repository: RepoRef;
  sourceRef: SourceRef | null;
  tree: FileEntry[];
  banks: BankInfo[];
  loading: boolean;
  error: string | null;
  setRepository: (repository: RepoRef) => void;
  setSource: (ref: SourceRef | null) => void;
  setTree: (tree: FileEntry[]) => void;
  setBanks: (banks: BankInfo[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useSourceStore = create<SourceState>((set) => ({
  repository: {
    owner: config.defaultSourceOwner,
    repo: config.defaultSourceRepo,
  },
  sourceRef: null,
  tree: [],
  banks: [],
  loading: false,
  error: null,
  setRepository: (repository) => set({ repository }),
  setSource: (ref) => set({ sourceRef: ref, error: null }),
  setTree: (tree) => set({ tree }),
  setBanks: (banks) => set({ banks }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
}));

interface DraftEntry {
  filePath: string;
  baselineHeadSha: string;
  content: string;
  headContent: string | null;
  isDeleted: boolean;
  timestamp: number;
}

interface DraftHistoryState {
  content: string;
  isDeleted: boolean;
}

interface DraftState {
  drafts: Map<string, DraftEntry>;
  storedDraftsByScope: Record<string, Record<string, DraftEntry>>;
  workspaceSessionsByScope: Record<string, SavedWorkspaceSession>;
  saveWorkspaceSession: (
    scopeKey: string,
    saved: SavedWorkspaceSession
  ) => void;
  draftScopeKey: string | null;
  hasHydrated: boolean;
  activateScope: (scopeKey: string | null, restore?: boolean) => void;
  getStoredDraftsForScope: (scopeKey: string) => DraftEntry[];
  ensureDraft: (
    filePath: string,
    content: string,
    baselineHeadSha: string,
    headContent: string | null
  ) => void;
  applyUserEdit: (
    filePath: string,
    content: string,
    baselineHeadSha: string,
    headContent: string | null
  ) => void;
  setDraft: (
    filePath: string,
    content: string,
    baselineHeadSha: string,
    headContent: string | null
  ) => void;
  getDraft: (filePath: string) => DraftEntry | undefined;
  removeDraft: (filePath: string) => void;
  renameDraft: (oldFilePath: string, newFilePath: string) => void;
  markDeleted: (filePath: string) => void;
  undo: (filePath: string) => void;
  redo: (filePath: string) => void;
  canUndo: (filePath: string) => boolean;
  canRedo: (filePath: string) => boolean;
  getDeletedFiles: () => DraftEntry[];
  resetFileToRemote: (filePath: string) => void;
  resetBankToRemote: (bankPath: string) => void;
  hasDrafts: () => boolean;
  getChangedFiles: () => DraftEntry[];
  acknowledgePublished: (
    files: DraftEntry[],
    headSha: string,
    scopeKey: string | null
  ) => void;
  clearAll: () => void;
  discardAll: () => void;
}

const draftHistoryByPath = new Map<string, Travels<DraftHistoryState>>();
const draftStoreJsonStorage = createJSONStorage(() => draftStoreStateStorage);

function createDraftEntry(params: {
  filePath: string;
  content: string;
  baselineHeadSha: string;
  headContent: string | null;
  isDeleted?: boolean;
}): DraftEntry {
  const {
    filePath,
    content,
    baselineHeadSha,
    headContent,
    isDeleted = false,
  } = params;
  return {
    filePath,
    baselineHeadSha,
    content,
    headContent,
    isDeleted,
    timestamp: Date.now(),
  };
}

function getDraftHistory(filePath: string) {
  return draftHistoryByPath.get(filePath);
}

function ensureDraftHistory(
  filePath: string,
  content: string,
  isDeleted = false
) {
  const existing = draftHistoryByPath.get(filePath);
  if (existing) {
    return existing;
  }
  const history = createTravels<DraftHistoryState>(
    { content, isDeleted },
    { maxHistory: 200 }
  );
  draftHistoryByPath.set(filePath, history);
  return history;
}

function resetDraftHistory(
  filePath: string,
  content: string,
  isDeleted = false
) {
  draftHistoryByPath.set(
    filePath,
    createTravels<DraftHistoryState>(
      { content, isDeleted },
      { maxHistory: 200 }
    )
  );
}

function syncEntryContentFromHistory(entry: DraftEntry, filePath: string) {
  const history = getDraftHistory(filePath);
  if (!history) {
    return entry;
  }
  return createDraftEntry({
    filePath: entry.filePath,
    content: history.getState().content,
    baselineHeadSha: entry.baselineHeadSha,
    headContent: entry.headContent,
    isDeleted: history.getState().isDeleted,
  });
}

function hasPersistedDraftChanges(entry: DraftEntry): boolean {
  return entry.content !== entry.headContent || entry.isDeleted;
}

function mapStoredDrafts(
  entries?: Record<string, DraftEntry>
): Map<string, DraftEntry> {
  return new Map(Object.entries(entries ?? {}));
}

function toStoredDraftRecord(
  drafts: Map<string, DraftEntry>,
  keepBaseline = false
): Record<string, DraftEntry> {
  return Object.fromEntries(
    Array.from(drafts.entries()).filter(
      ([, entry]) => keepBaseline || hasPersistedDraftChanges(entry)
    )
  );
}

function rebasePublishedDrafts(
  drafts: Map<string, DraftEntry>,
  files: DraftEntry[],
  headSha: string
): string[] {
  const removed: string[] = [];
  for (const published of files) {
    const current = drafts.get(published.filePath);
    if (!current) {
      // Removing a captured change means reverting it after the commit.
      drafts.set(
        published.filePath,
        createDraftEntry({
          filePath: published.filePath,
          content: published.headContent ?? published.content,
          baselineHeadSha: headSha,
          headContent: published.isDeleted ? null : published.content,
          isDeleted: published.headContent === null,
        })
      );
      continue;
    }
    // Clear only the captured draft; keep later edits.
    if (current === published) {
      drafts.delete(published.filePath);
      removed.push(published.filePath);
    } else {
      drafts.set(
        published.filePath,
        createDraftEntry({
          ...current,
          baselineHeadSha: headSha,
          headContent: published.isDeleted ? null : published.content,
        })
      );
    }
  }
  for (const [filePath, current] of drafts) {
    if (current.baselineHeadSha !== headSha) {
      drafts.set(
        filePath,
        createDraftEntry({ ...current, baselineHeadSha: headSha })
      );
    }
  }
  return removed;
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => {
      const setCurrentScopeDrafts = (nextDrafts: Map<string, DraftEntry>) => {
        const state = get();
        const scopeKey = state.draftScopeKey;
        if (!scopeKey) {
          set({ drafts: nextDrafts });
          return;
        }

        const nextStoredDraftsByScope = { ...state.storedDraftsByScope };
        const nextStoredDrafts = toStoredDraftRecord(
          nextDrafts,
          isExperimentScope(scopeKey)
        );
        if (Object.keys(nextStoredDrafts).length === 0) {
          delete nextStoredDraftsByScope[scopeKey];
        } else {
          nextStoredDraftsByScope[scopeKey] = nextStoredDrafts;
        }

        set({
          drafts: nextDrafts,
          storedDraftsByScope: nextStoredDraftsByScope,
        });
      };

      return {
        drafts: new Map(),
        storedDraftsByScope: {},
        workspaceSessionsByScope: {},
        saveWorkspaceSession: (scopeKey, saved) => {
          set({
            workspaceSessionsByScope: {
              ...get().workspaceSessionsByScope,
              [scopeKey]: saved,
            },
          });
        },
        draftScopeKey: null,
        hasHydrated: false,

        activateScope: (scopeKey, restore = true) => {
          draftHistoryByPath.clear();
          set({
            draftScopeKey: scopeKey,
            drafts:
              restore && scopeKey
                ? mapStoredDrafts(get().storedDraftsByScope[scopeKey])
                : new Map(),
          });
        },

        getStoredDraftsForScope: (scopeKey) =>
          Object.values(get().storedDraftsByScope[scopeKey] ?? {}),

        ensureDraft: (filePath, content, baselineHeadSha, headContent) => {
          const state = get();
          const existing = state.drafts.get(filePath);
          if (existing) {
            if (
              existing.baselineHeadSha === baselineHeadSha &&
              existing.headContent === headContent
            ) {
              ensureDraftHistory(
                filePath,
                existing.content,
                existing.isDeleted
              );
              return;
            }
            const nextDrafts = new Map(state.drafts);
            const nextEntry = createDraftEntry({
              filePath,
              content: existing.content,
              baselineHeadSha,
              headContent,
              isDeleted: existing.isDeleted,
            });
            nextDrafts.set(filePath, nextEntry);
            setCurrentScopeDrafts(nextDrafts);
            ensureDraftHistory(
              filePath,
              nextEntry.content,
              nextEntry.isDeleted
            );
            return;
          }

          const entry = createDraftEntry({
            filePath,
            content,
            baselineHeadSha,
            headContent,
          });
          const nextDrafts = new Map(state.drafts);
          nextDrafts.set(filePath, entry);
          setCurrentScopeDrafts(nextDrafts);
          resetDraftHistory(filePath, content);
        },

        applyUserEdit: (filePath, content, baselineHeadSha, headContent) => {
          const state = get();
          const existing: DraftEntry | undefined = state.drafts.get(filePath);
          const currentEntry =
            existing ??
            createDraftEntry({
              filePath,
              content: headContent ?? "",
              baselineHeadSha,
              headContent,
              isDeleted: false,
            });
          const history = ensureDraftHistory(
            filePath,
            currentEntry.content,
            currentEntry.isDeleted
          );
          const currentState = history.getState();
          if (
            currentState.content === content &&
            currentState.isDeleted === false
          ) {
            if (existing) {
              return;
            }
          } else {
            history.setState((draft) => {
              draft.content = content;
              draft.isDeleted = false;
            });
          }

          const nextEntry = createDraftEntry({
            filePath,
            content: history.getState().content,
            baselineHeadSha,
            headContent,
            isDeleted: history.getState().isDeleted,
          });
          const nextDrafts = new Map(state.drafts);
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
        },

        setDraft: (filePath, content, baselineHeadSha, headContent) => {
          const state = get();
          const newDrafts = new Map(state.drafts);
          const entry = createDraftEntry({
            filePath,
            content,
            baselineHeadSha,
            headContent,
          });
          newDrafts.set(filePath, entry);
          setCurrentScopeDrafts(newDrafts);
          resetDraftHistory(filePath, content, false);
        },

        getDraft: (filePath) => get().drafts.get(filePath),

        removeDraft: (filePath) => {
          const newDrafts = new Map(get().drafts);
          newDrafts.delete(filePath);
          setCurrentScopeDrafts(newDrafts);
          draftHistoryByPath.delete(filePath);
        },

        renameDraft: (oldFilePath, newFilePath) => {
          const state = get();
          const oldEntry = state.drafts.get(oldFilePath);
          if (!oldEntry) {
            return;
          }

          const newDrafts = new Map(state.drafts);
          newDrafts.delete(oldFilePath);
          const newEntry = createDraftEntry({
            filePath: newFilePath,
            content: oldEntry.content,
            baselineHeadSha: oldEntry.baselineHeadSha,
            headContent: oldEntry.headContent,
            isDeleted: oldEntry.isDeleted,
          });
          newDrafts.set(newFilePath, newEntry);
          setCurrentScopeDrafts(newDrafts);
          const history = draftHistoryByPath.get(oldFilePath);
          if (history) {
            draftHistoryByPath.set(newFilePath, history);
            draftHistoryByPath.delete(oldFilePath);
          } else {
            resetDraftHistory(
              newFilePath,
              newEntry.content,
              newEntry.isDeleted
            );
          }
        },

        markDeleted: (filePath) => {
          const entry = get().drafts.get(filePath);
          if (!entry) {
            return;
          }
          if (entry.headContent === null) {
            get().removeDraft(filePath);
            return;
          }
          const history = ensureDraftHistory(
            filePath,
            entry.content,
            entry.isDeleted
          );
          if (
            history.getState().isDeleted &&
            history.getState().content === entry.headContent
          ) {
            return;
          }
          if (
            !history.getState().isDeleted ||
            history.getState().content !== entry.headContent
          ) {
            history.setState((draft) => {
              draft.content = entry.headContent ?? "";
              draft.isDeleted = true;
            });
          }
          const nextDrafts = new Map(get().drafts);
          const nextEntry = syncEntryContentFromHistory(entry, filePath);
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
        },

        undo: (filePath) => {
          const entry = get().drafts.get(filePath);
          const history = getDraftHistory(filePath);
          if (!(entry && history?.canBack())) {
            return;
          }
          history.back();
          const nextDrafts = new Map(get().drafts);
          const nextEntry = syncEntryContentFromHistory(entry, filePath);
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
        },

        redo: (filePath) => {
          const entry = get().drafts.get(filePath);
          const history = getDraftHistory(filePath);
          if (!(entry && history?.canForward())) {
            return;
          }
          history.forward();
          const nextDrafts = new Map(get().drafts);
          const nextEntry = syncEntryContentFromHistory(entry, filePath);
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
        },

        canUndo: (filePath) => getDraftHistory(filePath)?.canBack() ?? false,

        canRedo: (filePath) => getDraftHistory(filePath)?.canForward() ?? false,

        getDeletedFiles: () => {
          const result: DraftEntry[] = [];
          for (const [, entry] of get().drafts) {
            if (entry.isDeleted) {
              result.push(entry);
            }
          }
          return result;
        },

        resetFileToRemote: (filePath) => {
          const entry = get().drafts.get(filePath);
          if (!entry) {
            return;
          }
          if (entry.headContent === null) {
            get().removeDraft(filePath);
            return;
          }
          const nextDrafts = new Map(get().drafts);
          const nextEntry = createDraftEntry({
            filePath,
            content: entry.headContent,
            baselineHeadSha: entry.baselineHeadSha,
            headContent: entry.headContent,
            isDeleted: false,
          });
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
          resetDraftHistory(filePath, entry.headContent, false);
        },

        resetBankToRemote: (bankPath) => {
          const filePaths = Array.from(get().drafts.keys()).filter((filePath) =>
            filePath.startsWith(`${bankPath}/`)
          );
          for (const filePath of filePaths) {
            get().resetFileToRemote(filePath);
          }
        },

        hasDrafts: () => {
          const drafts = get().drafts;
          for (const [, entry] of drafts) {
            if (entry.content !== entry.headContent) {
              return true;
            }
            if (entry.isDeleted) {
              return true;
            }
          }
          return false;
        },

        getChangedFiles: () => {
          const result: DraftEntry[] = [];
          for (const [, entry] of get().drafts) {
            if (hasPersistedDraftChanges(entry)) {
              result.push(entry);
            }
          }
          return result;
        },

        acknowledgePublished: (files, headSha, scopeKey) => {
          const isActiveScope = get().draftScopeKey === scopeKey;
          const drafts = isActiveScope
            ? new Map(get().drafts)
            : mapStoredDrafts(
                scopeKey ? get().storedDraftsByScope[scopeKey] : undefined
              );
          const removed = rebasePublishedDrafts(drafts, files, headSha);
          if (isActiveScope) {
            for (const path of removed) {
              draftHistoryByPath.delete(path);
            }
          }
          if (isActiveScope) {
            setCurrentScopeDrafts(drafts);
          } else if (scopeKey) {
            set({
              storedDraftsByScope: {
                ...get().storedDraftsByScope,
                [scopeKey]: toStoredDraftRecord(drafts),
              },
            });
          }
        },

        clearAll: () => {
          draftHistoryByPath.clear();
          set({ drafts: new Map() });
        },

        discardAll: () => {
          const scopeKey = get().draftScopeKey;
          draftHistoryByPath.clear();
          if (!scopeKey) {
            set({ drafts: new Map() });
            return;
          }
          const nextStoredDraftsByScope = { ...get().storedDraftsByScope };
          delete nextStoredDraftsByScope[scopeKey];
          set({
            drafts: new Map(),
            storedDraftsByScope: nextStoredDraftsByScope,
          });
        },
      };
    },
    {
      name: DRAFT_STORE_STORAGE_KEY,
      version: 1,
      migrate: (persisted) => {
        const stored = persisted as {
          storedDraftsByScope?: Record<
            string,
            Record<string, Record<string, unknown>>
          >;
        };
        return {
          storedDraftsByScope: Object.fromEntries(
            Object.entries(stored.storedDraftsByScope ?? {}).map(
              ([scope, entries]) => [
                scope,
                Object.fromEntries(
                  Object.entries(entries).map(([path, entry]) => [
                    path,
                    {
                      filePath: path,
                      content: entry.content,
                      headContent:
                        entry.remoteContent === "" ? null : entry.remoteContent,
                      baselineHeadSha: entry.baseHeadSha || entry.baseSha,
                      isDeleted: entry.isDeleted,
                      timestamp: entry.timestamp,
                    },
                  ])
                ),
              ]
            )
          ),
        };
      },
      onRehydrateStorage: () => () => {
        useDraftStore.setState({ hasHydrated: true });
      },
      partialize: (state) => ({
        storedDraftsByScope: state.storedDraftsByScope,
        workspaceSessionsByScope: state.workspaceSessionsByScope,
      }),
      storage: draftStoreJsonStorage,
    }
  )
);

export async function waitForDraftStoreHydration(): Promise<void> {
  if (useDraftStore.persist.hasHydrated()) {
    if (!useDraftStore.getState().hasHydrated) {
      useDraftStore.setState({ hasHydrated: true });
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const unsubscribe = useDraftStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
    void useDraftStore.persist.rehydrate();
  });
}

export type HighlightMode = "parts" | "groups";
export type RightPaneTab = "explanation" | "quickref" | "snippets";

function readHighlightMode(): HighlightMode {
  return localStorage.getItem("sms-formats-highlight-mode") === "parts"
    ? "parts"
    : "groups";
}

function readRightPaneTab(): RightPaneTab {
  const stored = localStorage.getItem("sms-formats-right-pane-tab");
  return stored === "explanation" ||
    stored === "quickref" ||
    stored === "snippets"
    ? stored
    : "snippets";
}

function readWhitespacePlusMode(): boolean {
  return localStorage.getItem("sms-formats-whitespace-plus-mode") === "1";
}

interface UIState {
  locale: string;
  setLocale: (l: string) => void;
  highlightMode: HighlightMode;
  setHighlightMode: (mode: HighlightMode) => void;
  rightPaneTab: RightPaneTab;
  setRightPaneTab: (tab: RightPaneTab) => void;
  whitespacePlusMode: boolean;
  setWhitespacePlusMode: (on: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  locale: localStorage.getItem("sms-formats-lang") ?? "ru",
  setLocale: (locale) => {
    localStorage.setItem("sms-formats-lang", locale);
    set({ locale });
  },
  highlightMode: readHighlightMode(),
  setHighlightMode: (highlightMode) => {
    localStorage.setItem("sms-formats-highlight-mode", highlightMode);
    set({ highlightMode });
  },
  rightPaneTab: readRightPaneTab(),
  setRightPaneTab: (rightPaneTab) => {
    localStorage.setItem("sms-formats-right-pane-tab", rightPaneTab);
    set({ rightPaneTab });
  },
  whitespacePlusMode: readWhitespacePlusMode(),
  setWhitespacePlusMode: (whitespacePlusMode) => {
    localStorage.setItem(
      "sms-formats-whitespace-plus-mode",
      whitespacePlusMode ? "1" : "0"
    );
    set({ whitespacePlusMode });
  },
}));
