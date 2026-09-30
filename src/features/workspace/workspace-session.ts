import { indexBanksFromTree } from "@/domain/bank-index";
import type { PullRequestWorkspaceResolution } from "@/domain/pull-request-workspace";
import type { FileEntry, RepoRef } from "@/domain/types";
import { loadFileContent } from "@/infrastructure/file-content";
import {
  fetchRepoTree,
  resolvePullRequestWorkspace,
} from "@/infrastructure/github";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { waitForDraftPersistence } from "@/store/persistence";
import {
  loadWorkspaceSession,
  type SavedWorkspaceSession,
  saveWorkspaceSession,
  type WorkspaceSession,
  workspaceScope,
} from "@/store/workspace-session";

export type WorkspaceBlock =
  | "stale"
  | "sync-pending"
  | Extract<
      PullRequestWorkspaceResolution,
      { status: "unavailable" | "unsupported" }
    >["reason"];

export interface WorkspaceState {
  session: WorkspaceSession | null;
  nextSession: WorkspaceSession | null;
  block: WorkspaceBlock | null;
  operation:
    | "opening"
    | "checking"
    | "discarding"
    | "publishing"
    | "syncing"
    | null;
  error: string | null;
}

export interface PublicationTicket {
  generation: number;
  session: WorkspaceSession;
  scopeKey: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function revisionChanges(
  bankPath: string,
  baseTree: FileEntry[],
  tree: FileEntry[]
): WorkspaceSession["changedFiles"] {
  const before = new Map(
    baseTree
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, entry.sha])
  );
  const after = new Map(
    tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, entry.sha])
  );
  const changedFiles: WorkspaceSession["changedFiles"] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (
      !path.startsWith(`${bankPath}/`) ||
      before.get(path) === after.get(path)
    ) {
      continue;
    }
    changedFiles.push({
      path,
      kind: !after.has(path) ? "delete" : before.has(path) ? "modify" : "add",
    });
  }
  return changedFiles;
}

export class WorkspaceSessionController {
  private generation = 0;
  private unsubscribeDraftStore?: () => void;
  private readonly listeners = new Set<() => void>();
  private selectedFile: string | null = null;
  private readonly scopeKey: string;
  private state: WorkspaceState;

  private readonly repository: RepoRef;
  private readonly prNumber: number;

  constructor(repository: RepoRef, prNumber: number) {
    this.repository = repository;
    this.prNumber = prNumber;
    this.scopeKey = workspaceScope(repository, prNumber);
    const saved = loadWorkspaceSession(repository, prNumber);
    const source = useSourceStore.getState();
    const reusable =
      saved &&
      source.repository.owner === repository.owner &&
      source.repository.repo === repository.repo &&
      source.sourceRef?.prNumber === prNumber &&
      source.sourceRef.sha === saved.session.headSha &&
      source.tree.length > 0;
    this.state = {
      session: reusable ? saved.session : null,
      nextSession: null,
      block: saved?.pendingPublishedHeadSha ? "sync-pending" : null,
      operation: "opening",
      error: null,
    };
  }

  getSnapshot = (): WorkspaceState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  selectFile(filePath: string | null): void {
    this.selectedFile = filePath;
  }

  private update(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  deactivate(): void {
    this.unsubscribeDraftStore?.();
    this.unsubscribeDraftStore = undefined;
    this.generation += 1;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
  isTicketCurrent(ticket: PublicationTicket): boolean {
    return this.isCurrent(ticket.generation);
  }
  isPublicationCurrent(ticket: PublicationTicket): boolean {
    return (
      this.isCurrent(ticket.generation) && this.state.operation === "publishing"
    );
  }

  private hasDrafts(): boolean {
    const drafts = useDraftStore.getState();
    return (
      (drafts.draftScopeKey === this.scopeKey
        ? drafts.getChangedFiles()
        : drafts.getStoredDraftsForScope(this.scopeKey)
      ).length > 0
    );
  }

  private async prepare(
    session: WorkspaceSession,
    generation: number
  ): Promise<FileEntry[] | null> {
    const source = useSourceStore.getState();
    const canReuse =
      source.repository.owner === this.repository.owner &&
      source.repository.repo === this.repository.repo &&
      source.sourceRef?.prNumber === this.prNumber &&
      source.sourceRef.sha === session.headSha &&
      source.tree.length > 0;
    const tree = canReuse
      ? source.tree
      : await fetchRepoTree(session.headSha, this.repository);
    if (!this.isCurrent(generation)) {
      return null;
    }
    // Selection can change during a read without reopening the session.
    let selected: string | null;
    do {
      selected = this.selectedFile;
      if (
        selected &&
        tree.some((entry) => entry.type === "blob" && entry.path === selected)
      ) {
        await loadFileContent({
          repository: this.repository,
          commitSha: session.headSha,
          filePath: selected,
        });
      }
      if (!this.isCurrent(generation)) {
        return null;
      }
    } while (selected !== this.selectedFile);
    return tree;
  }

  private apply(
    session: WorkspaceSession,
    tree: FileEntry[],
    options: {
      discard?: boolean;
      pendingPublishedHeadSha?: string;
      completedPublicationSha?: string;
    } = {}
  ): boolean {
    const { discard, pendingPublishedHeadSha, completedPublicationSha } =
      options;
    const pending = loadWorkspaceSession(
      this.repository,
      this.prNumber
    )?.pendingPublishedHeadSha;
    if (
      pending &&
      pending !== session.headSha &&
      pending !== pendingPublishedHeadSha &&
      pending !== completedPublicationSha
    ) {
      this.update({ block: "sync-pending", nextSession: null });
      return false;
    }
    const drafts = useDraftStore.getState();
    if (drafts.draftScopeKey !== this.scopeKey) {
      drafts.activateScope(this.scopeKey, true);
    }
    if (discard) {
      useDraftStore.getState().discardAll();
    }
    const activeDrafts = useDraftStore.getState();
    const changedPaths = new Set(
      activeDrafts.getChangedFiles().map((draft) => draft.filePath)
    );
    for (const draft of activeDrafts.drafts.values()) {
      if (
        draft.baselineHeadSha !== session.headSha &&
        !changedPaths.has(draft.filePath)
      ) {
        activeDrafts.removeDraft(draft.filePath);
      }
    }
    const source = useSourceStore.getState();
    source.setRepository(this.repository);
    source.setSource({
      type: "pr",
      name: `pr-${this.prNumber}`,
      prNumber: this.prNumber,
      sha: session.headSha,
    });
    source.setTree(tree);
    source.setBanks(indexBanksFromTree(tree));
    source.setLoading(false);
    source.setError(null);
    saveWorkspaceSession({ session, pendingPublishedHeadSha });
    this.update({
      session,
      nextSession: null,
      block: pendingPublishedHeadSha ? "sync-pending" : null,
      error: null,
    });
    return true;
  }

  observeResolution(
    ticket: PublicationTicket,
    resolution: PullRequestWorkspaceResolution
  ): void {
    if (!this.isPublicationCurrent(ticket)) {
      return;
    }
    this.observe(resolution);
  }

  private observe(resolution: PullRequestWorkspaceResolution): void {
    if (resolution.status === "transient-error") {
      this.update({ error: resolution.reason });
    } else if (resolution.status !== "supported") {
      this.update({ block: resolution.reason, error: null });
    } else if (
      this.state.session &&
      resolution.headSha !== this.state.session.headSha
    ) {
      this.update({ nextSession: resolution, block: "stale", error: null });
    } else if (this.state.session) {
      const session = {
        ...this.state.session,
        writable: resolution.writable,
        readOnlyReason: resolution.readOnlyReason,
      };
      saveWorkspaceSession({ session });
      this.update({ session, block: null, nextSession: null, error: null });
    }
  }

  open = async (): Promise<void> => {
    const generation = ++this.generation;
    this.unsubscribeDraftStore?.();
    this.update({ operation: "opening", error: null });
    try {
      await waitForDraftStoreHydration();
      if (!this.isCurrent(generation)) {
        return;
      }
      this.unsubscribeDraftStore = useDraftStore.subscribe(
        (state, previous) => {
          const pending =
            state.workspaceSessionsByScope[this.scopeKey]
              ?.pendingPublishedHeadSha;
          if (
            pending &&
            pending !==
              previous.workspaceSessionsByScope[this.scopeKey]
                ?.pendingPublishedHeadSha
          ) {
            const reading =
              this.state.operation === "opening" ||
              this.state.operation === "checking" ||
              this.state.operation === "discarding";
            if (reading) {
              this.generation += 1;
            }
            this.update({
              block: "sync-pending",
              nextSession: null,
              ...(reading ? { operation: null } : {}),
            });
          }
        }
      );
      const saved = loadWorkspaceSession(this.repository, this.prNumber);
      if (saved?.pendingPublishedHeadSha && !this.state.session) {
        const tree = await this.prepare(saved.session, generation);
        if (!tree) {
          return;
        }
        this.apply(saved.session, tree, {
          pendingPublishedHeadSha: saved.pendingPublishedHeadSha,
        });
      }
      const resolution = await resolvePullRequestWorkspace(
        this.prNumber,
        this.repository,
        { forceFresh: true }
      );
      if (!this.isCurrent(generation)) {
        return;
      }
      await this.openResolved(resolution, saved, generation);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.update({ error: errorMessage(error) });
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.update({ operation: null });
      }
    }
  };

  private async openResolved(
    resolution: PullRequestWorkspaceResolution,
    saved: SavedWorkspaceSession | null,
    generation: number
  ): Promise<void> {
    if (saved?.pendingPublishedHeadSha && resolution.status === "supported") {
      await this.syncResolved(
        resolution,
        generation,
        saved.pendingPublishedHeadSha
      );
      return;
    }
    const drafts = useDraftStore
      .getState()
      .getStoredDraftsForScope(this.scopeKey);
    const latest = resolution.status === "supported" ? resolution : null;
    const stale =
      latest &&
      drafts.some((draft) => draft.baselineHeadSha !== latest.headSha);
    const session = latest && !stale ? latest : saved?.session;
    if (!session) {
      this.observe(resolution);
      if (stale) {
        this.update({
          nextSession: latest,
          block: "stale",
          error: "recovery-unavailable",
        });
      }
      return;
    }
    if (
      !saved?.pendingPublishedHeadSha &&
      drafts.some((draft) => draft.baselineHeadSha !== session.headSha)
    ) {
      this.update({
        session: null,
        nextSession: latest,
        block: "stale",
        error: "recovery-unavailable",
      });
      return;
    }
    this.update({
      nextSession: stale ? latest : null,
      block: stale ? "stale" : this.state.block,
    });
    const tree = await this.prepare(session, generation);
    if (!tree) {
      return;
    }
    const applied = this.apply(session, tree, {
      pendingPublishedHeadSha: saved?.pendingPublishedHeadSha,
    });
    if (applied && !saved?.pendingPublishedHeadSha) {
      this.observe(resolution);
    }
  }

  checkUpdates = (): Promise<void> => this.refresh(false);

  discardAndRefresh = (): Promise<void> =>
    this.state.block === "stale" ? this.refresh(true) : Promise.resolve();

  private async refresh(discard: boolean): Promise<void> {
    if (
      loadWorkspaceSession(this.repository, this.prNumber)
        ?.pendingPublishedHeadSha
    ) {
      if (!this.state.operation) {
        await this.syncPublication();
      }
      return;
    }
    if (this.state.operation || this.state.block === "sync-pending") {
      return;
    }
    const generation = ++this.generation;
    this.update({
      operation: discard ? "discarding" : "checking",
      error: null,
    });
    try {
      const resolution = await resolvePullRequestWorkspace(
        this.prNumber,
        this.repository,
        { forceFresh: true }
      );
      if (!this.isCurrent(generation)) {
        return;
      }
      if (resolution.status !== "supported") {
        this.observe(resolution);
        return;
      }
      if (
        !discard &&
        (resolution.headSha === this.state.session?.headSha || this.hasDrafts())
      ) {
        this.observe(resolution);
        return;
      }
      const tree = await this.prepare(resolution, generation);
      if (!tree) {
        return;
      }
      if (!discard && this.hasDrafts()) {
        this.observe(resolution);
      } else {
        this.apply(resolution, tree, { discard: true });
      }
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.update({ error: errorMessage(error) });
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.update({ operation: null });
      }
    }
  }

  beginPublication(): PublicationTicket | null {
    if (
      loadWorkspaceSession(this.repository, this.prNumber)
        ?.pendingPublishedHeadSha
    ) {
      this.update({ block: "sync-pending" });
      return null;
    }
    const { session, block, operation } = this.state;
    if (!session?.writable || block || operation) {
      return null;
    }
    const generation = ++this.generation;
    this.update({ operation: "publishing", error: null });
    return { generation, session, scopeKey: this.scopeKey };
  }

  finishPublication(ticket: PublicationTicket): void {
    if (this.isCurrent(ticket.generation)) {
      this.update({ operation: null });
    }
  }

  recordPublication(ticket: PublicationTicket, headSha: string): void {
    saveWorkspaceSession({
      session: ticket.session,
      pendingPublishedHeadSha: headSha,
    });
    if (this.isCurrent(ticket.generation)) {
      this.update({ block: "sync-pending", operation: "syncing" });
    }
  }

  private async syncResolved(
    resolution: WorkspaceSession,
    generation: number,
    publishedSha: string
  ): Promise<boolean> {
    const saved = loadWorkspaceSession(this.repository, this.prNumber);
    if (resolution.headSha !== publishedSha && this.hasDrafts()) {
      if (!saved) {
        return false;
      }
      const published = {
        ...saved.session,
        headSha: publishedSha,
        writable: resolution.writable,
        readOnlyReason: resolution.readOnlyReason,
      };
      const baseTree = await fetchRepoTree(published.baseSha, this.repository);
      if (!this.isCurrent(generation)) {
        return false;
      }
      const tree = await this.prepare(published, generation);
      if (!tree) {
        return false;
      }
      const changedFiles = revisionChanges(published.bankPath, baseTree, tree);
      const applied = this.apply({ ...published, changedFiles }, tree, {
        completedPublicationSha: publishedSha,
      });
      if (applied) {
        this.update({ block: "stale", nextSession: resolution });
      }
      return applied;
    }
    const tree = await this.prepare(resolution, generation);
    return Boolean(
      tree &&
        this.apply(resolution, tree, { completedPublicationSha: publishedSha })
    );
  }

  syncPublication = async (ticket?: PublicationTicket): Promise<boolean> => {
    if (ticket && !this.isCurrent(ticket.generation)) {
      return false;
    }
    if (!ticket && this.state.operation) {
      return false;
    }
    const saved = loadWorkspaceSession(this.repository, this.prNumber);
    if (!saved?.pendingPublishedHeadSha) {
      return true;
    }
    const generation = ticket?.generation ?? ++this.generation;
    this.update({ operation: "syncing", block: "sync-pending", error: null });
    try {
      const resolution = await resolvePullRequestWorkspace(
        this.prNumber,
        this.repository,
        { forceFresh: true }
      );
      if (!this.isCurrent(generation)) {
        return false;
      }
      if (resolution.status !== "supported") {
        this.update({ error: resolution.reason });
        return false;
      }
      const applied = await this.syncResolved(
        resolution,
        generation,
        saved.pendingPublishedHeadSha
      );
      await waitForDraftPersistence();
      return applied;
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.update({ error: errorMessage(error) });
      }
      return false;
    } finally {
      if (this.isCurrent(generation)) {
        this.update({ operation: null });
      }
    }
  };
}
