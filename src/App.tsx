import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { Dashboard } from "./pages/Dashboard";
import { PullRequestShortcut } from "./pages/PullRequestShortcut";

const BankWorkspace = lazy(() =>
  import("./pages/BankWorkspace").then((module) => ({
    default: module.BankWorkspace,
  }))
);

export function App() {
  const { t } = useTranslation();

  return (
    <>
      <div className="fixed inset-0 z-[9999] hidden items-center justify-center bg-background p-8 text-center text-base text-muted-foreground max-[1199px]:flex">
        <div>{t("app.desktopOnly")}</div>
      </div>
      <div className="flex h-screen min-w-[1200px] flex-col max-[1199px]:hidden">
        <AppHeader />
        <main className="ui-panel-body flex-1 overflow-hidden">
          <Suspense fallback={<div>{t("app.loading")}</div>}>
            <Routes>
              <Route element={<Dashboard />} path="/" />
              <Route element={<Navigate replace to="/" />} path="/workspace" />
              <Route
                element={<BankWorkspace />}
                path="/repo/:owner/:repo/pr/:prNumber/*"
              />
              <Route element={<PullRequestShortcut />} path="/pr/:prNumber" />
              <Route element={<Navigate replace to="/" />} path="*" />
            </Routes>
          </Suspense>
        </main>
      </div>
    </>
  );
}
