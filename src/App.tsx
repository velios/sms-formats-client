import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { useInitMainBranch } from "./hooks/useGitHub";
import { BankWorkspace } from "./pages/BankWorkspace";
import { Dashboard } from "./pages/Dashboard";
import { HomeHub } from "./pages/HomeHub";
import { SmsMarkupGame } from "./pages/SmsMarkupGame";
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
    <div className="badge badge--error">
      {t("app.error")}: {error}
    </div>
  ) : (
    <div className="flex items-center gap-sm">
      <span className="spinner" />
      <span>{t("app.loading")}</span>
    </div>
  );

  return (
    <>
      <div className="desktop-guard">
        <div>{t("app.desktopOnly")}</div>
      </div>
      <div className="app-shell">
        <AppHeader />
        <main className="app-main">
          <Routes>
            <Route element={<HomeHub />} path="/" />
            <Route element={<SmsMarkupGame />} path="/share-your-sms" />
            <Route
              element={workspaceBlocked ? workspaceFallback : <Dashboard />}
              path="/workspace"
            />
            <Route
              element={workspaceBlocked ? workspaceFallback : <BankWorkspace />}
              path="/bank/:bankPath/*"
            />
            <Route element={<Navigate replace to="/" />} path="*" />
          </Routes>
        </main>
      </div>
    </>
  );
}
