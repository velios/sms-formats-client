import { useQuery } from "@tanstack/react-query";
import { fileContentOptions } from "@/infrastructure/file-content";
import { queryClient } from "@/lib/query-client";
import { useDraftStore, useSourceStore } from "@/store";

export function useWorkspaceFileContent(params: {
  filePath: string;
  contentRefName?: string;
  enabled?: boolean;
}) {
  const repository = useSourceStore((state) => state.repository);
  const headSha = useSourceStore((state) => state.sourceRef?.sha);
  const draft = useDraftStore((state) =>
    params.contentRefName ? undefined : state.drafts.get(params.filePath)
  );
  const refName = params.contentRefName ?? draft?.baselineHeadSha ?? headSha;
  const query = useQuery(
    {
      ...fileContentOptions({
        repository,
        filePath: params.filePath,
        commitSha: refName ?? "",
      }),
      enabled: Boolean(refName) && params.enabled !== false && !draft,
    },
    queryClient
  );
  return {
    ...query,
    data: draft ? (draft.headContent ?? undefined) : query.data,
    isLoading: !draft && query.isLoading,
    error: query.error?.message ?? null,
  };
}
