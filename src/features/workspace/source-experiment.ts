import { indexBanksFromTree } from "@/domain/bank-index";
import type {
  CheckedSourceHead,
  FileEntry,
  RepoRef,
  SourceTarget,
} from "@/domain/types";
import { loadFileContent } from "@/infrastructure/file-content";
import {
  fetchRepoTree,
  getGitHubAuthChangeVersion,
} from "@/infrastructure/github";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { experimentScope } from "@/store/draft-scope";
import { resolveSourceHead } from "./source-file";

export interface ExperimentState {
  head: CheckedSourceHead | null;
  nextHead: CheckedSourceHead | null;
  tree: FileEntry[];
  filePath: string | null;
  missing: boolean;
  operation: "opening" | "selecting" | "checking" | "refreshing" | null;
  error: string | null;
}

export class SourceExperimentController {
  private generation = 0;
  private fileGeneration = 0;
  private readonly listeners = new Set<() => void>();
  private state: ExperimentState = {
    head: null,
    nextHead: null,
    tree: [],
    filePath: null,
    missing: false,
    operation: "opening",
    error: null,
  };
  readonly scope: string;
  readonly repository: RepoRef;
  readonly source: SourceTarget;
  readonly fullBank: boolean;
  private selectedFile: string | null = null;
  constructor(repository: RepoRef, source: SourceTarget, fullBank: boolean) {
    this.scope = experimentScope(repository, source);
    this.repository = repository;
    this.source = source;
    this.fullBank = fullBank;
  }
  getSnapshot = (): ExperimentState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ExperimentState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
  deactivate() {
    this.generation += 1;
    this.fileGeneration += 1;
  }
  private current(generation: number, auth: number) {
    return (
      generation === this.generation && auth === getGitHubAuthChangeVersion()
    );
  }
  private applySource(head: CheckedSourceHead, tree: FileEntry[]) {
    const store = useSourceStore.getState();
    store.setRepository(this.repository);
    store.setSource(head.sourceRef);
    store.setTree(tree);
    store.setBanks(indexBanksFromTree(tree));
  }
  private async content(
    head: CheckedSourceHead,
    filePath: string
  ): Promise<string | null> {
    try {
      return await loadFileContent({
        repository: this.repository,
        filePath,
        commitSha: head.sourceRef.sha,
      });
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restoring and preparing must guard every asynchronous boundary.
  open = async (filePath: string | null): Promise<void> => {
    this.selectedFile = filePath;
    const generation = ++this.generation;
    const auth = getGitHubAuthChangeVersion();
    this.fileGeneration += 1;
    this.update({ operation: "opening", filePath, error: null });
    try {
      await waitForDraftStoreHydration();
      if (!this.current(generation, auth)) {
        return;
      }
      useDraftStore.getState().activateScope(this.scope);
      const head = await resolveSourceHead({
        repository: this.repository,
        source: this.source,
      });
      if (!this.current(generation, auth)) {
        return;
      }
      const tree = this.fullBank
        ? await fetchRepoTree(head.sourceRef.sha, this.repository)
        : [];
      if (!this.current(generation, auth)) {
        return;
      }
      let selected: string | null;
      let draft: ReturnType<
        ReturnType<typeof useDraftStore.getState>["getDraft"]
      >;
      let body: string | null;
      do {
        selected =
          this.selectedFile ??
          (this.fullBank
            ? (indexBanksFromTree(tree)[0]?.formatFiles[0] ?? null)
            : null);
        draft = selected
          ? useDraftStore.getState().getDraft(selected)
          : undefined;
        body =
          selected && (!draft || draft.baselineHeadSha !== head.sourceRef.sha)
            ? await this.content(head, selected)
            : (draft?.headContent ?? null);
        if (!this.current(generation, auth)) {
          return;
        }
      } while (this.selectedFile && selected !== this.selectedFile);
      if (selected && !draft && body !== null) {
        useDraftStore
          .getState()
          .ensureDraft(selected, body, head.sourceRef.sha, body);
      }
      this.applySource(head, tree);
      const stale = draft && draft.baselineHeadSha !== head.sourceRef.sha;
      this.update({
        head,
        nextHead: stale ? head : null,
        tree,
        filePath: selected,
        missing: Boolean(selected && body === null),
      });
    } catch (error) {
      if (this.current(generation, auth)) {
        // Restored documents remain usable even when freshness cannot be checked.
        const draft = filePath
          ? useDraftStore.getState().getDraft(filePath)
          : undefined;
        if (draft) {
          const head: CheckedSourceHead = {
            sourceRef:
              this.source.type === "main"
                ? { type: "main", name: "main", sha: draft.baselineHeadSha }
                : {
                    ...this.source,
                    name: `pr-${this.source.prNumber}`,
                    sha: draft.baselineHeadSha,
                  },
            checkedAt: 0,
          };
          this.applySource(head, []);
          this.update({ head });
        }
        this.update({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (this.current(generation, auth)) {
        this.update({ operation: null });
      }
    }
  };
  select = async (filePath: string, force = false): Promise<void> => {
    this.selectedFile = filePath;
    if (
      this.state.operation === "refreshing" &&
      filePath !== this.state.filePath
    ) {
      this.deactivate();
      this.update({ operation: null });
    }
    if (
      (!force && this.state.filePath === filePath) ||
      !this.state.head ||
      this.state.operation === "refreshing"
    ) {
      return;
    }
    const generation = this.generation;
    const auth = getGitHubAuthChangeVersion();
    const fileGeneration = ++this.fileGeneration;
    this.update({
      filePath,
      missing: false,
      operation: "selecting",
      error: null,
    });
    try {
      const draft = useDraftStore.getState().getDraft(filePath);
      const body =
        draft && draft.baselineHeadSha === this.state.head.sourceRef.sha
          ? draft.headContent
          : await this.content(this.state.head, filePath);
      if (
        !this.current(generation, auth) ||
        fileGeneration !== this.fileGeneration
      ) {
        return;
      }
      if (!draft && body !== null) {
        useDraftStore
          .getState()
          .ensureDraft(filePath, body, this.state.head.sourceRef.sha, body);
      }
      this.update({
        missing: body === null,
        nextHead:
          draft && draft.baselineHeadSha !== this.state.head.sourceRef.sha
            ? this.state.head
            : null,
      });
    } catch (error) {
      if (
        this.current(generation, auth) &&
        fileGeneration === this.fileGeneration
      ) {
        this.update({ error: String(error) });
      }
    } finally {
      if (
        this.current(generation, auth) &&
        fileGeneration === this.fileGeneration
      ) {
        this.update({ operation: null });
      }
    }
  };
  checkUpdates = async (): Promise<void> => {
    if (this.state.operation) {
      return;
    }
    const generation = this.generation;
    const auth = getGitHubAuthChangeVersion();
    this.update({ operation: "checking", error: null });
    try {
      const head = await resolveSourceHead({
        repository: this.repository,
        source: this.source,
        forceFresh: true,
      });
      if (!this.current(generation, auth)) {
        return;
      }
      const changed =
        head.sourceRef.sha !== this.state.head?.sourceRef.sha ||
        [...useDraftStore.getState().drafts.values()].some(
          (draft) => draft.baselineHeadSha !== head.sourceRef.sha
        );
      this.update({
        nextHead: changed ? head : null,
        ...(changed ? {} : { head }),
      });
    } catch (error) {
      if (this.current(generation, auth)) {
        this.update({ error: String(error) });
      }
    } finally {
      if (this.current(generation, auth)) {
        this.update({ operation: null });
      }
    }
  };
  refresh = async (): Promise<void> => {
    if (this.state.operation) {
      return;
    }
    const generation = ++this.generation;
    const auth = getGitHubAuthChangeVersion();
    const filePath = this.state.filePath;
    this.fileGeneration += 1;
    this.update({ operation: "refreshing", error: null });
    try {
      const head = await resolveSourceHead({
        repository: this.repository,
        source: this.source,
        forceFresh: true,
      });
      const tree = this.fullBank
        ? await fetchRepoTree(head.sourceRef.sha, this.repository)
        : [];
      const selected = this.selectedFile;
      const content = selected ? await this.content(head, selected) : null;
      if (!this.current(generation, auth)) {
        return;
      }
      const store = useDraftStore.getState();
      const bankPath = filePath?.split("/").slice(0, 2).join("/");
      for (const path of store.drafts.keys()) {
        const reset = !this.fullBank
          ? path === filePath
          : this.source.type === "pr" ||
            Boolean(bankPath && path.startsWith(`${bankPath}/`));
        if (reset) {
          store.removeDraft(path);
        }
      }
      if (selected && content !== null && !store.getDraft(selected)) {
        store.ensureDraft(selected, content, head.sourceRef.sha, content);
      }
      this.applySource(head, tree);
      this.update({
        head,
        nextHead: null,
        tree,
        filePath: selected,
        missing: Boolean(selected && content === null),
      });
    } catch (error) {
      if (this.current(generation, auth)) {
        this.update({ error: String(error) });
      }
    } finally {
      if (this.current(generation, auth)) {
        this.update({ operation: null });
      }
    }
  };
}
