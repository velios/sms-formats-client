import { createTravels, type Travels } from "travels";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { config } from "@/config";
import type {
  BankInfo,
  FileEntry,
  RepoRef,
  SourceRef,
  ValidationIssue,
} from "@/domain/types";
import { DRAFT_STORE_STORAGE_KEY, draftStoreStateStorage } from "./persistence";

// ─── Source store ───

interface SourceState {
  repository: RepoRef;
  sourceRef: SourceRef | null;
  sourceChangedFiles: string[];
  tree: FileEntry[];
  banks: BankInfo[];
  loading: boolean;
  error: string | null;
  setRepository: (repository: RepoRef) => void;
  setSource: (ref: SourceRef | null) => void;
  setSourceChangedFiles: (files: string[]) => void;
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
  sourceChangedFiles: [],
  tree: [],
  banks: [],
  loading: false,
  error: null,
  setRepository: (repository) => set({ repository }),
  setSource: (ref) => set({ sourceRef: ref, error: null }),
  setSourceChangedFiles: (sourceChangedFiles) => set({ sourceChangedFiles }),
  setTree: (tree) => set({ tree }),
  setBanks: (banks) => set({ banks }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
}));

// ─── Draft store ───

interface DraftEntry {
  filePath: string;
  baseSha: string;
  baseHeadSha: string;
  content: string;
  remoteContent: string;
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
  draftScopeKey: string | null;
  hasHydrated: boolean;
  activateScope: (scopeKey: string | null, restore?: boolean) => void;
  getStoredDraftsForScope: (scopeKey: string) => DraftEntry[];
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
  setDraft: (
    filePath: string,
    content: string,
    baseSha: string,
    remoteContent: string
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
  clearAll: () => void;
  discardAll: () => void;
}

const draftHistoryByPath = new Map<string, Travels<DraftHistoryState>>();
const draftStoreJsonStorage = createJSONStorage(() => draftStoreStateStorage);

function createDraftEntry(params: {
  filePath: string;
  content: string;
  baseSha: string;
  baseHeadSha?: string;
  remoteContent: string;
  isDeleted?: boolean;
}): DraftEntry {
  const {
    filePath,
    content,
    baseSha,
    baseHeadSha = useSourceStore.getState().sourceRef?.sha ?? "",
    remoteContent,
    isDeleted = false,
  } = params;
  return {
    filePath,
    baseSha,
    baseHeadSha,
    content,
    remoteContent,
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
    baseSha: entry.baseSha,
    baseHeadSha: entry.baseHeadSha,
    remoteContent: entry.remoteContent,
    isDeleted: history.getState().isDeleted,
  });
}

function hasPersistedDraftChanges(entry: DraftEntry): boolean {
  return entry.content !== entry.remoteContent || entry.isDeleted;
}

function mapStoredDrafts(
  entries?: Record<string, DraftEntry>
): Map<string, DraftEntry> {
  return new Map(Object.entries(entries ?? {}));
}

function toStoredDraftRecord(
  drafts: Map<string, DraftEntry>
): Record<string, DraftEntry> {
  return Object.fromEntries(
    Array.from(drafts.entries()).filter(([, entry]) =>
      hasPersistedDraftChanges(entry)
    )
  );
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
        const nextStoredDrafts = toStoredDraftRecord(nextDrafts);
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

        ensureDraft: (filePath, content, baseSha, remoteContent) => {
          const state = get();
          const existing = state.drafts.get(filePath);
          if (existing) {
            if (
              existing.baseSha === baseSha &&
              existing.remoteContent === remoteContent
            ) {
              ensureDraftHistory(filePath, existing.content, existing.isDeleted);
              return;
            }
            const nextDrafts = new Map(state.drafts);
            const nextEntry = createDraftEntry({
              filePath,
              content: existing.content,
              baseSha,
              baseHeadSha: existing.baseHeadSha,
              remoteContent,
              isDeleted: existing.isDeleted,
            });
            nextDrafts.set(filePath, nextEntry);
            setCurrentScopeDrafts(nextDrafts);
            ensureDraftHistory(filePath, nextEntry.content, nextEntry.isDeleted);
            return;
          }

          const entry = createDraftEntry({
            filePath,
            content,
            baseSha,
            remoteContent,
          });
          const nextDrafts = new Map(state.drafts);
          nextDrafts.set(filePath, entry);
          setCurrentScopeDrafts(nextDrafts);
          resetDraftHistory(filePath, content);
        },

        applyUserEdit: (filePath, content, baseSha, remoteContent) => {
          const state = get();
          const existing: DraftEntry | undefined = state.drafts.get(filePath);
          const currentEntry =
            existing ??
            createDraftEntry({
              filePath,
              content: remoteContent,
              baseSha,
              baseHeadSha: undefined,
              remoteContent,
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
            baseSha,
            remoteContent,
            isDeleted: history.getState().isDeleted,
          });
          const nextDrafts = new Map(state.drafts);
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
        },

        setDraft: (filePath, content, baseSha, remoteContent) => {
          const state = get();
          const newDrafts = new Map(state.drafts);
          const entry = createDraftEntry({
            filePath,
            content,
            baseSha,
            remoteContent,
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
            baseSha: oldEntry.baseSha,
            baseHeadSha: oldEntry.baseHeadSha,
            remoteContent: oldEntry.remoteContent,
            isDeleted: oldEntry.isDeleted,
          });
          newDrafts.set(newFilePath, newEntry);
          setCurrentScopeDrafts(newDrafts);
          const history = draftHistoryByPath.get(oldFilePath);
          if (history) {
            draftHistoryByPath.set(newFilePath, history);
            draftHistoryByPath.delete(oldFilePath);
          } else {
            resetDraftHistory(newFilePath, newEntry.content, newEntry.isDeleted);
          }
        },

        markDeleted: (filePath) => {
          const entry = get().drafts.get(filePath);
          if (!entry) {
            return;
          }
          if (entry.remoteContent === "") {
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
            history.getState().content === entry.remoteContent
          ) {
            return;
          }
          if (
            !history.getState().isDeleted ||
            history.getState().content !== entry.remoteContent
          ) {
            history.setState((draft) => {
              draft.content = entry.remoteContent;
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
          if (entry.remoteContent === "") {
            get().removeDraft(filePath);
            return;
          }
          const nextDrafts = new Map(get().drafts);
          const nextEntry = createDraftEntry({
            filePath,
            content: entry.remoteContent,
            baseSha: entry.baseSha,
            baseHeadSha: entry.baseHeadSha,
            remoteContent: entry.remoteContent,
            isDeleted: false,
          });
          nextDrafts.set(filePath, nextEntry);
          setCurrentScopeDrafts(nextDrafts);
          resetDraftHistory(filePath, entry.remoteContent, false);
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
            if (entry.content !== entry.remoteContent) {
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
      onRehydrateStorage: () => () => {
        useDraftStore.setState({ hasHydrated: true });
      },
      partialize: (state) => ({
        storedDraftsByScope: state.storedDraftsByScope,
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

// ─── Publish store ───

export type PublishStep =
  | "idle"
  | "validating"
  | "committing"
  | "syncing"
  | "done"
  | "error";

interface PublishState {
  step: PublishStep;
  token: string | null;
  prUrl: string | null;
  error: string | null;
  validationIssues: ValidationIssue[];
  setStep: (s: PublishStep) => void;
  setToken: (t: string | null) => void;
  setPrUrl: (u: string | null) => void;
  setError: (e: string | null) => void;
  setValidationIssues: (issues: ValidationIssue[]) => void;
  reset: () => void;
}

export const usePublishStore = create<PublishState>((set) => ({
  step: "idle",
  token: null,
  prUrl: null,
  error: null,
  validationIssues: [],
  setStep: (step) => set({ step }),
  setToken: (token) => set({ token }),
  setPrUrl: (prUrl) => set({ prUrl }),
  setError: (error) => set({ error, step: "error" }),
  setValidationIssues: (validationIssues) => set({ validationIssues }),
  reset: () =>
    set({
      step: "idle",
      prUrl: null,
      error: null,
      validationIssues: [],
    }),
}));

// ─── UI store ───

interface UIState {
  locale: string;
  setLocale: (l: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  locale: localStorage.getItem("sms-formats-lang") ?? "ru",
  setLocale: (locale) => {
    localStorage.setItem("sms-formats-lang", locale);
    set({ locale });
  },
}));
