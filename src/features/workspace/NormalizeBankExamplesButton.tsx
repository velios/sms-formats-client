import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { initialExamplePositions } from "@/domain/format";
import { normalizeExampleSections } from "@/domain/format/normalize-examples";
import type { RepoRef } from "@/domain/types";
import { loadFileContents } from "@/infrastructure/file-content";
import { useDraftStore } from "@/store";

export function NormalizeBankExamplesButton({
  filePaths,
  repository,
  headSha,
  readOnly,
}: {
  filePaths: string[];
  repository: RepoRef;
  headSha?: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const drafts = useDraftStore((store) => store.drafts);
  const scope = useDraftStore((store) => store.draftScopeKey);
  const remotePaths = filePaths.filter(
    (path) => drafts.get(path)?.headContent !== null
  );
  const { data, isPending, error, refetch } = useQuery({
    queryKey: [
      "nfc-bank-examples",
      repository.owner,
      repository.repo,
      headSha,
      scope,
      remotePaths,
    ],
    queryFn: () =>
      loadFileContents({
        repository,
        commitSha: headSha!,
        filePaths: remotePaths,
      }),
    enabled: Boolean(headSha) && !readOnly,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const canNormalize = filePaths.some((path) => {
    const draft = drafts.get(path);
    const content = draft?.content ?? data?.contents.get(path);
    return (
      !draft?.isDeleted &&
      content !== undefined &&
      normalizeExampleSections(content) !== content
    );
  });
  const normalizeAll = () => {
    if (readOnly || isPending || error || !headSha) {
      return;
    }
    for (const path of filePaths) {
      const store = useDraftStore.getState();
      const draft = store.getDraft(path);
      const content = draft?.content ?? data?.contents.get(path);
      if (draft?.isDeleted || content === undefined) {
        continue;
      }
      const normalized = normalizeExampleSections(content);
      if (normalized !== content) {
        store.applyUserEdit(
          path,
          normalized,
          draft?.baselineHeadSha ?? headSha,
          draft ? draft.headContent : content,
          draft?.examplePositions ?? initialExamplePositions(content)
        );
      }
    }
  };
  return (
    <>
      <Button
        className="w-full justify-start whitespace-normal text-left leading-[1.3]"
        disabled={
          readOnly || !headSha || isPending || Boolean(error) || !canNormalize
        }
        onClick={normalizeAll}
        type="button"
        variant="ghost"
      >
        {!readOnly && isPending && headSha ? <Spinner /> : null}
        {t("editor.normalizeAllExamples")}
      </Button>
      {error && (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge variant="error">
            {t("app.error")}: {error.message}
          </StatusBadge>
          <Button onClick={() => void refetch()} size="sm" variant="ghost">
            {t("app.retry")}
          </Button>
        </div>
      )}
    </>
  );
}
