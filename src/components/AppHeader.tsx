import { Settings } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { PanelResizeToggle } from "@/features/resizable-panels/ResizablePanels";
import { SourceSelector } from "@/features/source-selector/SourceSelector";
import {
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  refreshPullRequestApprovalPermission,
  setGitHubUserToken,
  subscribeGitHubAuthChange,
  validateToken,
} from "@/infrastructure/github";
import { useSourceStore, useUIStore } from "@/store";
import { hardResetAppState } from "@/store/hard-reset";

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const githubTokenInputId = useId();
  const repository = useSourceStore((s) => s.repository);
  const setLocale = useUIStore((s) => s.setLocale);
  const locale = useUIStore((s) => s.locale);
  const authChangeVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const [githubTokenModalOpen, setGithubTokenModalOpen] = useState(false);
  const [githubTokenInput, setGithubTokenInput] = useState(
    getGitHubUserToken() ?? ""
  );
  const [savedGitHubToken, setSavedGitHubToken] = useState(
    getGitHubUserToken() ?? ""
  );
  const [hasMaintainerPermission, setHasMaintainerPermission] = useState(() =>
    getCachedPullRequestApprovalPermission(repository)
  );
  const [isSavingGitHubToken, setIsSavingGitHubToken] = useState(false);
  const [isHardResetting, setIsHardResetting] = useState(false);
  const [githubTokenError, setGithubTokenError] = useState<string | null>(null);
  const isDeveloperMode =
    location.pathname === "/" || location.pathname.startsWith("/repo/");
  const hasSavedGitHubToken = savedGitHubToken.trim().length > 0;
  const hasPersonalToken = Boolean(getGitHubUserToken()?.trim());
  const permissionBadgeLabel = hasPersonalToken
    ? hasMaintainerPermission
      ? t("githubAuth.maintainer")
      : t("githubAuth.personalKey")
    : t("githubAuth.sharedKey");
  const permissionBadgeClassName = hasPersonalToken
    ? hasMaintainerPermission
      ? "success"
      : "warning"
    : "info";

  useEffect(() => {
    let cancelled = false;
    if (!getGitHubUserToken()?.trim()) {
      setHasMaintainerPermission(false);
      return;
    }

    setHasMaintainerPermission(
      getCachedPullRequestApprovalPermission(repository)
    );
    void refreshPullRequestApprovalPermission(repository)
      .then((canApprove) => {
        if (!cancelled) {
          setHasMaintainerPermission(canApprove);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasMaintainerPermission(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authChangeVersion, repository.owner, repository.repo]);

  const toggleLocale = () => {
    const next = locale === "ru" ? "en" : "ru";
    setLocale(next);
    i18n.changeLanguage(next);
  };

  const openGitHubTokenModal = () => {
    setGithubTokenInput(savedGitHubToken);
    setGithubTokenError(null);
    setGithubTokenModalOpen(true);
  };

  const handleSaveGitHubToken = async () => {
    const token = githubTokenInput.trim();
    if (!token) {
      setGithubTokenError(t("githubAuth.emptyToken"));
      return;
    }

    setIsSavingGitHubToken(true);
    setGithubTokenError(null);
    try {
      await validateToken(token);
      setGitHubUserToken(token);
      setSavedGitHubToken(token);
      setGithubTokenModalOpen(false);
    } catch (error) {
      setGithubTokenError(
        error instanceof Error ? error.message : t("githubAuth.invalidToken")
      );
    } finally {
      setIsSavingGitHubToken(false);
    }
  };

  const handleResetGitHubToken = () => {
    setGitHubUserToken(null);
    setSavedGitHubToken("");
    setGithubTokenInput("");
    setGithubTokenError(null);
  };

  const handleHardReset = async () => {
    setIsHardResetting(true);
    setGithubTokenError(null);
    await hardResetAppState();
  };

  return (
    <>
      <header className="ui-panel-inset flex h-[52px] shrink-0 items-center gap-3 border-border border-b bg-card py-2">
        <button
          className="cursor-pointer whitespace-nowrap font-semibold text-base"
          onClick={() => navigate("/")}
          type="button"
        >
          Zenmoney SMS Formats
        </button>

        {isDeveloperMode && (
          <>
            <span className="mr-0.5 text-muted-foreground">/</span>
            <SourceSelector allowRepoSwitch />
          </>
        )}

        <div className="flex-1" />

        <StatusBadge
          title={t("githubAuth.permissionStatus")}
          variant={permissionBadgeClassName}
        >
          {permissionBadgeLabel}
        </StatusBadge>
        <Button onClick={toggleLocale} size="sm" variant="ghost">
          {locale === "ru" ? "EN" : "RU"}
        </Button>
        <PanelResizeToggle />
        <Button
          aria-label={t("githubAuth.openSettings")}
          className="rounded-md"
          onClick={openGitHubTokenModal}
          size="icon"
          title={
            hasSavedGitHubToken
              ? t("githubAuth.tokenConfigured")
              : t("githubAuth.openSettings")
          }
          type="button"
          variant="ghost"
        >
          <Settings className="size-4" />
        </Button>
      </header>

      {githubTokenModalOpen && (
        <ModalDialog
          className="sm:max-w-[520px]"
          onClose={() => setGithubTokenModalOpen(false)}
          title={t("githubAuth.title")}
        >
          <div className="ui-field">
            <label className="ui-field-label" htmlFor={githubTokenInputId}>
              {t("githubAuth.tokenLabel")}
            </label>
            <Input
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono"
              id={githubTokenInputId}
              onChange={(e) => setGithubTokenInput(e.target.value)}
              placeholder="ghp_..."
              spellCheck={false}
              type="password"
              value={githubTokenInput}
            />
            <div className="ui-field-hint">{t("githubAuth.tokenHint")}</div>
            {hasSavedGitHubToken && (
              <StatusBadge variant="success">
                {t("githubAuth.tokenSaved")}
              </StatusBadge>
            )}
            {githubTokenError && (
              <StatusBadge variant="error">{githubTokenError}</StatusBadge>
            )}
          </div>
          <div className="ui-dialog-actions justify-end">
            <Button
              className="mr-auto"
              disabled={isSavingGitHubToken || isHardResetting}
              onClick={() => void handleHardReset()}
              type="button"
              variant="destructive"
            >
              {t("githubAuth.hardReset")}
            </Button>
            <Button
              disabled={
                !hasSavedGitHubToken || isSavingGitHubToken || isHardResetting
              }
              onClick={() => void handleResetGitHubToken()}
              type="button"
              variant="destructive"
            >
              {t("githubAuth.resetToken")}
            </Button>
            <Button
              disabled={isSavingGitHubToken || isHardResetting}
              onClick={() => setGithubTokenModalOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("app.cancel")}
            </Button>
            <Button
              disabled={
                isSavingGitHubToken ||
                isHardResetting ||
                githubTokenInput.trim().length === 0
              }
              onClick={() => void handleSaveGitHubToken()}
              type="button"
              variant="primary"
            >
              {isSavingGitHubToken ? t("githubAuth.saving") : t("app.save")}
            </Button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
