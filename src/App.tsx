import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { Spinner } from "./components/ui/spinner";
import { StatusBadge } from "./components/ui/status-badge";
import { useInitMainBranch } from "./hooks/useGitHub";
import { BankWorkspace } from "./pages/BankWorkspace";
import { Dashboard } from "./pages/Dashboard";
import { useSourceStore } from "./store";

export function App() {
  const { t } = useTranslation();
  const initMain = useInitMainBranch();
  const loading = useSourceStore((s) => s.loading);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const error = useSourceStore((s) => s.error);

  useEffect(() => {
    initMain();
  }, [initMain]); // eslint-disable-line react-hooks/exhaustive-deps

  const workspaceBlocked = loading || !sourceRef;
  const workspaceFallback = error ? (
    <StatusBadge className="text-sm" variant="error">
      {t("app.error")}: {error}
    </StatusBadge>
  ) : (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner />
      <span>{t("app.loading")}</span>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-[9999] hidden items-center justify-center bg-[color:var(--c-bg)] p-8 text-center text-base text-[color:var(--c-text-muted)] max-[1199px]:flex">
        <div>{t("app.desktopOnly")}</div>
      </div>
      <div className="flex h-screen min-w-[1200px] flex-col max-[1199px]:hidden">
        <AppHeader />
        <main className="flex-1 overflow-hidden p-6">
          <Routes>
            <Route
              element={workspaceBlocked ? workspaceFallback : <Dashboard />}
              path="/"
            />
            <Route
              element={workspaceBlocked ? workspaceFallback : <Dashboard />}
              path="/workspace"
            />
            <Route
              element={workspaceBlocked ? workspaceFallback : <BankWorkspace />}
              path="/bank/:bankKey/repo/:repoOwner/branch-or-pr/:branchOrPr/*"
            />
            <Route element={<Navigate replace to="/" />} path="*" />
          </Routes>
        </main>
      </div>
    </>
  );
}
