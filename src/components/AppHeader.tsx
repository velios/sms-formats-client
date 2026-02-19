import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getGitHubUserToken,
  setGitHubUserToken,
  validateToken,
} from "@/domain/github";
import { SourceSelector } from "@/features/source-selector/SourceSelector";
import { useUIStore } from "@/store";

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const githubTokenInputId = useId();
  const githubTokenDialogTitleId = useId();
  const setLocale = useUIStore((s) => s.setLocale);
  const locale = useUIStore((s) => s.locale);
  const [githubTokenModalOpen, setGithubTokenModalOpen] = useState(false);
  const [githubTokenInput, setGithubTokenInput] = useState(
    getGitHubUserToken() ?? ""
  );
  const [savedGitHubToken, setSavedGitHubToken] = useState(
    getGitHubUserToken() ?? ""
  );
  const [isSavingGitHubToken, setIsSavingGitHubToken] = useState(false);
  const [githubTokenError, setGithubTokenError] = useState<string | null>(null);
  const isDeveloperMode =
    location.pathname === "/" ||
    location.pathname.startsWith("/workspace") ||
    location.pathname.startsWith("/bank/");
  const hasSavedGitHubToken = savedGitHubToken.trim().length > 0;

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
      await queryClient.invalidateQueries();
      setGithubTokenModalOpen(false);
    } catch (error) {
      setGithubTokenError(
        error instanceof Error ? error.message : t("githubAuth.invalidToken")
      );
    } finally {
      setIsSavingGitHubToken(false);
    }
  };

  const handleResetGitHubToken = async () => {
    setGitHubUserToken(null);
    setSavedGitHubToken("");
    setGithubTokenInput("");
    setGithubTokenError(null);
    await queryClient.invalidateQueries();
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

        <button className="btn btn--ghost btn--sm" onClick={toggleLocale}>
          {locale === "ru" ? "EN" : "RU"}
        </button>
        <button
          aria-label={t("githubAuth.openSettings")}
          className="app-header__settings-btn"
          onClick={openGitHubTokenModal}
          title={
            hasSavedGitHubToken
              ? t("githubAuth.tokenConfigured")
              : t("githubAuth.openSettings")
          }
          type="button"
        >
          ⚙
        </button>
      </header>

      {githubTokenModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => setGithubTokenModalOpen(false)}
        >
          <div
            aria-labelledby={githubTokenDialogTitleId}
            aria-modal="true"
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            style={{ minWidth: 520 }}
          >
            <div className="modal__title" id={githubTokenDialogTitleId}>
              {t("githubAuth.title")}
            </div>
            <div className="mb-md flex-col gap-sm">
              <label
                className="text-muted text-sm"
                htmlFor={githubTokenInputId}
              >
                {t("githubAuth.tokenLabel")}
              </label>
              <input
                autoCapitalize="off"
                autoComplete="off"
                className="input input--mono"
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
                <div className="badge badge--success">
                  {t("githubAuth.tokenSaved")}
                </div>
              )}
              {githubTokenError && (
                <div className="badge badge--error">{githubTokenError}</div>
              )}
            </div>
            <div className="modal__actions">
              <button
                className="btn btn--danger"
                disabled={!hasSavedGitHubToken || isSavingGitHubToken}
                onClick={() => void handleResetGitHubToken()}
                type="button"
              >
                {t("githubAuth.resetToken")}
              </button>
              <button
                className="btn btn--ghost"
                disabled={isSavingGitHubToken}
                onClick={() => setGithubTokenModalOpen(false)}
                type="button"
              >
                {t("app.cancel")}
              </button>
              <button
                className="btn btn--primary"
                disabled={
                  isSavingGitHubToken || githubTokenInput.trim().length === 0
                }
                onClick={() => void handleSaveGitHubToken()}
                type="button"
              >
                {isSavingGitHubToken ? t("githubAuth.saving") : t("app.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
