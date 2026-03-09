import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { useSwitchRepository, useSwitchSource } from "@/hooks/useGitHub";
import {
  getPullRequestGitHubUrl,
  getPullRequestShortcutConflict,
  getPullRequestWorkspacePath,
  getUpstreamRepository,
  isSameRepository,
  type PullRequestShortcutNotice,
} from "@/lib/pull-request-navigation";
import { useDraftStore, useSourceStore } from "@/store";

interface DashboardLocationState {
  pullRequestShortcutNotice?: PullRequestShortcutNotice;
}

function buildShortcutNotice(
  prNumber: number,
  reason: PullRequestShortcutNotice["reason"]
): DashboardLocationState {
  const targetRepository = getUpstreamRepository();
  return {
    pullRequestShortcutNotice: {
      prNumber,
      githubUrl: getPullRequestGitHubUrl(prNumber, targetRepository),
      reason,
    },
  };
}

export function PullRequestShortcut() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const routeParams = useParams();
  const repository = useSourceStore((state) => state.repository);
  const sourceRef = useSourceStore((state) => state.sourceRef);
  const draftStore = useDraftStore();
  const switchRepository = useSwitchRepository();
  const switchSource = useSwitchSource();
  const hasDrafts = useMemo(
    () => draftStore.hasDrafts(),
    [draftStore, draftStore.drafts]
  );
  const prNumber = useMemo(() => {
    const rawValue = routeParams.prNumber?.trim();
    if (!rawValue || !/^\d+$/.test(rawValue)) {
      return null;
    }
    const nextValue = Number.parseInt(rawValue, 10);
    return Number.isSafeInteger(nextValue) && nextValue > 0 ? nextValue : null;
  }, [routeParams.prNumber]);
  const activeRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!prNumber) {
      navigate("/", { replace: true });
      return;
    }

    const targetRepository = getUpstreamRepository();
    const draftConflict = getPullRequestShortcutConflict({
      currentRepository: repository,
      currentSource: sourceRef,
      hasDrafts,
      prNumber,
      targetRepository,
    });
    if (draftConflict) {
      navigate("/", {
        replace: true,
        state: buildShortcutNotice(prNumber, draftConflict),
      });
      return;
    }

    const requestKey = [
      targetRepository.owner,
      targetRepository.repo,
      prNumber,
      repository.owner,
      repository.repo,
      sourceRef?.type ?? "none",
      sourceRef?.prNumber ?? "none",
      sourceRef?.sha ?? "none",
    ].join(":");
    if (activeRequestKeyRef.current === requestKey) {
      return;
    }
    activeRequestKeyRef.current = requestKey;

    if (!isSameRepository(repository, targetRepository)) {
      void switchRepository(targetRepository)
        .then(() => {
          const nextRepository = useSourceStore.getState().repository;
          if (!isSameRepository(nextRepository, targetRepository)) {
            navigate("/", {
              replace: true,
              state: buildShortcutNotice(prNumber, "open-failed"),
            });
          }
        })
        .finally(() => {
          activeRequestKeyRef.current = null;
        });
      return;
    }

    void switchSource("pr", `pr-${prNumber}`, prNumber)
      .then(() => {
        const nextState = useSourceStore.getState();
        const nextSource = nextState.sourceRef;
        if (
          !(
            nextSource?.type === "pr" &&
            nextSource.prNumber === prNumber &&
            nextSource.sha
          )
        ) {
          navigate("/", {
            replace: true,
            state: buildShortcutNotice(prNumber, "open-failed"),
          });
          return;
        }
        navigate(
          getPullRequestWorkspacePath({
            changedPaths: nextState.sourceChangedFiles,
            prNumber,
            repository: nextState.repository,
            sourceSha: nextSource.sha,
          }),
          { replace: true }
        );
      })
      .finally(() => {
        activeRequestKeyRef.current = null;
      });
  }, [
    hasDrafts,
    navigate,
    prNumber,
    repository,
    sourceRef,
    switchRepository,
    switchSource,
  ]);

  return (
    <div className="flex items-center gap-2 text-sm text-[color:var(--c-text-muted)]">
      <Spinner />
      <span>{t("prShortcut.opening", { defaultValue: "Открываем PR…" })}</span>
    </div>
  );
}
