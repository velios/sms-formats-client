import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchBranchSha,
  fetchFileContent,
  fetchPullRequestFiles,
  fetchPullRequestHead,
  fetchRepoTree,
  indexBanksFromTree,
} from "@/domain/github";
import { threeWayMerge } from "@/domain/merge";
import type { MergeResult } from "@/domain/types";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
}

export function RefreshButton({ bankPath }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mergeResults, setMergeResults] = useState<MergeResult[]>([]);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const setSourceChangedFiles = useSourceStore((s) => s.setSourceChangedFiles);
  const draftStore = useDraftStore();
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    const hasDirtyDrafts = draftStore.hasDrafts();

    if (hasDirtyDrafts) {
      setShowConfirm(true);
      return;
    }

    await doRefresh();
  };

  const doRefresh = async () => {
    if (!sourceRef) {
      return;
    }
    setLoading(true);
    setShowConfirm(false);
    setMergeResults([]);

    try {
      // Fetch fresh SHA
      let newRefName = sourceRef.name;
      let newSha = sourceRef.sha;
      let newChangedFiles: string[] = [];

      if (sourceRef.type === "pr" && sourceRef.prNumber) {
        const prHead = await fetchPullRequestHead(
          sourceRef.prNumber,
          repository
        );
        newRefName = prHead.headRef;
        newSha = prHead.headSha;
        newChangedFiles = await fetchPullRequestFiles(
          sourceRef.prNumber,
          repository
        );
      } else {
        newSha = await fetchBranchSha(sourceRef.name, repository);
      }

      const newTree = await fetchRepoTree(newSha, repository);
      const newBanks = indexBanksFromTree(newTree);

      // Get changed files
      const changedFiles = draftStore.getChangedFiles();

      if (changedFiles.length > 0) {
        // Attempt 3-way merge for each changed file
        const results: MergeResult[] = [];
        for (const draft of changedFiles) {
          try {
            const newRemote = await fetchFileContent(
              draft.filePath,
              newSha,
              repository
            );
            const result = threeWayMerge(
              draft.remoteContent,
              draft.content,
              newRemote,
              draft.filePath
            );
            results.push(result);

            // Apply merge result
            if (result.status === "clean" || result.status === "unchanged") {
              draftStore.setDraft(
                draft.filePath,
                result.content,
                newSha,
                newRemote
              );
            } else {
              // Conflict — keep conflict markers in content for manual resolution
              draftStore.setDraft(
                draft.filePath,
                result.content,
                newSha,
                newRemote
              );
            }
          } catch {
            // File may have been removed or is new
            results.push({
              path: draft.filePath,
              status: "clean",
              content: draft.content,
            });
          }
        }
        setMergeResults(results);
      }

      // Update stores
      useSourceStore.getState().setSource({
        ...sourceRef,
        name: newRefName,
        sha: newSha,
      });
      setSourceChangedFiles(newChangedFiles);
      useSourceStore.getState().setTree(newTree);
      useSourceStore.getState().setBanks(newBanks);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["tree"] });
      queryClient.invalidateQueries({ queryKey: ["file"] });
    } catch (e) {
      useSourceStore
        .getState()
        .setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        className="btn btn--sm w-full"
        disabled={loading}
        onClick={handleRefresh}
      >
        {loading ? <span className="spinner" /> : null}
        {t("refresh.action")}
      </button>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__title">{t("refresh.confirmTitle")}</div>
            <p className="text-muted text-sm">{t("refresh.confirmMessage")}</p>
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowConfirm(false)}>
                {t("app.cancel")}
              </button>
              <button className="btn btn--primary" onClick={doRefresh}>
                {t("app.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge results */}
      {mergeResults.length > 0 && (
        <div className="mt-sm flex-col gap-xs">
          {mergeResults.map((r) => (
            <div
              className={`issue-item ${r.status === "conflict" ? "issue-item--error" : "issue-item--warning"}`}
              key={r.path}
            >
              <span className="text-sm">
                {r.path.split("/").pop()}:{" "}
                {r.status === "conflict"
                  ? t("refresh.conflict")
                  : t("refresh.mergeOk")}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
