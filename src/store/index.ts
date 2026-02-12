import { create } from "zustand";
import type {
  BankInfo,
  FileEntry,
  SourceRef,
  ValidationIssue,
} from "@/domain/types";
import { deleteDraft, loadAllDrafts, saveDraft } from "./persistence";

// ─── Source store ───

interface SourceState {
  sourceRef: SourceRef | null;
  tree: FileEntry[];
  banks: BankInfo[];
  loading: boolean;
  error: string | null;
  setSource: (ref: SourceRef) => void;
  setTree: (tree: FileEntry[]) => void;
  setBanks: (banks: BankInfo[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useSourceStore = create<SourceState>((set) => ({
  sourceRef: null,
  tree: [],
  banks: [],
  loading: false,
  error: null,
  setSource: (ref) => set({ sourceRef: ref, error: null }),
  setTree: (tree) => set({ tree }),
  setBanks: (banks) => set({ banks }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
}));

// ─── Draft store ───

interface DraftEntry {
  filePath: string;
  baseSha: string;
  content: string;
  remoteContent: string;
  timestamp: number;
}

interface DraftState {
  drafts: Map<string, DraftEntry>;
  setDraft: (
    filePath: string,
    content: string,
    baseSha: string,
    remoteContent: string
  ) => void;
  getDraft: (filePath: string) => DraftEntry | undefined;
  removeDraft: (filePath: string) => void;
  renameDraft: (oldFilePath: string, newFilePath: string) => void;
  hasDrafts: () => boolean;
  getChangedFiles: () => DraftEntry[];
  clearAll: () => void;
  restoreFromDB: (sourceRef: string) => Promise<void>;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: new Map(),

  setDraft: (filePath, content, baseSha, remoteContent) => {
    const state = get();
    const newDrafts = new Map(state.drafts);
    const entry: DraftEntry = {
      filePath,
      baseSha,
      content,
      remoteContent,
      timestamp: Date.now(),
    };
    newDrafts.set(filePath, entry);
    set({ drafts: newDrafts });

    // Persist to IndexedDB
    const sourceRef = useSourceStore.getState().sourceRef;
    if (sourceRef) {
      const bankPath = filePath.split("/").slice(0, 2).join("/");
      saveDraft({
        sourceRef: `${sourceRef.type}:${sourceRef.name}`,
        bankPath,
        filePath,
        baseSha,
        content,
        timestamp: entry.timestamp,
      });
    }
  },

  getDraft: (filePath) => get().drafts.get(filePath),

  removeDraft: (filePath) => {
    const newDrafts = new Map(get().drafts);
    newDrafts.delete(filePath);
    set({ drafts: newDrafts });

    const sourceRef = useSourceStore.getState().sourceRef;
    if (sourceRef) {
      deleteDraft(`${sourceRef.type}:${sourceRef.name}`, filePath);
    }
  },

  renameDraft: (oldFilePath, newFilePath) => {
    const state = get();
    const oldEntry = state.drafts.get(oldFilePath);
    if (!oldEntry) {
      return;
    }

    const newDrafts = new Map(state.drafts);
    newDrafts.delete(oldFilePath);
    const newEntry: DraftEntry = {
      ...oldEntry,
      filePath: newFilePath,
      timestamp: Date.now(),
    };
    newDrafts.set(newFilePath, newEntry);
    set({ drafts: newDrafts });

    const sourceRef = useSourceStore.getState().sourceRef;
    if (sourceRef) {
      const sourceKey = `${sourceRef.type}:${sourceRef.name}`;
      deleteDraft(sourceKey, oldFilePath);
      const bankPath = newFilePath.split("/").slice(0, 2).join("/");
      saveDraft({
        sourceRef: sourceKey,
        bankPath,
        filePath: newFilePath,
        baseSha: newEntry.baseSha,
        content: newEntry.content,
        timestamp: newEntry.timestamp,
      });
    }
  },

  hasDrafts: () => {
    const drafts = get().drafts;
    for (const [, entry] of drafts) {
      if (entry.content !== entry.remoteContent) {
        return true;
      }
    }
    return false;
  },

  getChangedFiles: () => {
    const result: DraftEntry[] = [];
    for (const [, entry] of get().drafts) {
      if (entry.content !== entry.remoteContent) {
        result.push(entry);
      }
    }
    return result;
  },

  clearAll: () => set({ drafts: new Map() }),

  restoreFromDB: async (sourceRef: string) => {
    const dbDrafts = await loadAllDrafts(sourceRef);
    const newDrafts = new Map(get().drafts);
    for (const d of dbDrafts) {
      if (!newDrafts.has(d.filePath)) {
        newDrafts.set(d.filePath, {
          filePath: d.filePath,
          baseSha: d.baseSha,
          content: d.content,
          remoteContent: "", // will be filled on first load
          timestamp: d.timestamp,
        });
      }
    }
    set({ drafts: newDrafts });
  },
}));

// ─── Publish store ───

export type PublishStep =
  | "idle"
  | "validating"
  | "forking"
  | "branching"
  | "committing"
  | "opening-pr"
  | "done"
  | "error";

interface PublishState {
  step: PublishStep;
  token: string | null;
  forkOwner: string | null;
  prUrl: string | null;
  error: string | null;
  validationIssues: ValidationIssue[];
  setStep: (s: PublishStep) => void;
  setToken: (t: string | null) => void;
  setForkOwner: (o: string | null) => void;
  setPrUrl: (u: string | null) => void;
  setError: (e: string | null) => void;
  setValidationIssues: (issues: ValidationIssue[]) => void;
  reset: () => void;
}

export const usePublishStore = create<PublishState>((set) => ({
  step: "idle",
  token: null,
  forkOwner: null,
  prUrl: null,
  error: null,
  validationIssues: [],
  setStep: (step) => set({ step }),
  setToken: (token) => set({ token }),
  setForkOwner: (forkOwner) => set({ forkOwner }),
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
