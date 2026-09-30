import { useQuery } from "@tanstack/react-query";
import { fileContentOptions } from "@/infrastructure/file-content";
import { queryClient } from "@/lib/query-client";
import { useSourceStore } from "@/store";

export function useWorkspaceFileContent(params: {
  filePath: string;
  contentRefName?: string;
  enabled?: boolean;
}) {
  const repository = useSourceStore((state) => state.repository);
  const headSha = useSourceStore((state) => state.sourceRef?.sha);
  const refName = params.contentRefName ?? headSha;
  const query = useQuery(
    {
      ...fileContentOptions({
        repository,
        filePath: params.filePath,
        commitSha: refName ?? "",
      }),
      enabled: Boolean(refName) && params.enabled !== false,
    },
    queryClient
  );
  return { ...query, error: query.error?.message ?? null };
}
