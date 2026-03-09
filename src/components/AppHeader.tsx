import { Settings } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  refreshPullRequestApprovalPermission,
  setGitHubUserToken,
  subscribeGitHubAuthChange,
  validateToken,
} from "@/domain/github";
import { SourceSelector } from "@/features/source-selector/SourceSelector";
import { useSourceStore, useUIStore } from "@/store";

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const githubTokenInputId = useId();
  const githubTokenDialogTitleId = useId();
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
  const [githubTokenError, setGithubTokenError] = useState<string | null>(null);
  const isDeveloperMode =
    location.pathname === "/" ||
    location.pathname.startsWith("/workspace") ||
    location.pathname.startsWith("/bank/");
  const hasSavedGitHubToken = savedGitHubToken.trim().length > 0;
  const hasPersonalToken = Boolean(getGitHubUserToken()?.trim());
  const permissionBadgeLabel = hasPersonalToken
    ? hasMaintainerPermission
      ? "мейнтейнер"
      : "личный ключ"
    : "общий ключ";
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
    void refreshPullRequestApprovalPermission(repository).then((canApprove) => {
      if (!cancelled) {
        setHasMaintainerPermission(canApprove);
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

  return (
    <>
      <header className="app-header">
        <div
          className="app-header__title"
          onClick={() => navigate("/")}
          style={{ cursor: "pointer" }}
        >
          Zenmoney SMS Formats
        </div>

        {isDeveloperMode && (
          <>
            <span className="app-header__separator">/</span>
            <SourceSelector allowRepoSwitch />
          </>
        )}

        <div className="app-header__spacer" />

        <StatusBadge
          title="Статус прав в репозитории"
          variant={permissionBadgeClassName}
        >
          {permissionBadgeLabel}
        </StatusBadge>
        <Button onClick={toggleLocale} size="sm" variant="ghost">
          {locale === "ru" ? "EN" : "RU"}
        </Button>
        <Button
          aria-label={t("githubAuth.openSettings")}
          className="size-9 rounded-full"
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
          onClose={() => setGithubTokenModalOpen(false)}
          style={{ minWidth: 520 }}
          title={t("githubAuth.title")}
          titleId={githubTokenDialogTitleId}
        >
          <div className="mb-md flex-col gap-sm">
            <label className="text-muted text-sm" htmlFor={githubTokenInputId}>
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
            <div className="text-muted text-sm">
              {t("githubAuth.tokenHint")}
            </div>
            {hasSavedGitHubToken && (
              <StatusBadge variant="success">
                {t("githubAuth.tokenSaved")}
              </StatusBadge>
            )}
            {githubTokenError && (
              <StatusBadge variant="error">{githubTokenError}</StatusBadge>
            )}
          </div>
          <div className="modal__actions">
            <Button
              disabled={!hasSavedGitHubToken || isSavingGitHubToken}
              onClick={() => void handleResetGitHubToken()}
              type="button"
              variant="destructive"
            >
              {t("githubAuth.resetToken")}
            </Button>
            <Button
              disabled={isSavingGitHubToken}
              onClick={() => setGithubTokenModalOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("app.cancel")}
            </Button>
            <Button
              disabled={
                isSavingGitHubToken || githubTokenInput.trim().length === 0
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
