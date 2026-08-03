import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
// ПРОТОТИП (#27) — маршрут живёт только на ветке prototype/import-screen.
import { ImportPrototypeRoute } from "./features/import-answer/prototype/ImportPrototypeRoute";
import { BankWorkspace } from "./pages/BankWorkspace";
import { Dashboard } from "./pages/Dashboard";
import { PullRequestShortcut } from "./pages/PullRequestShortcut";

export function App() {
  const { t } = useTranslation();

  return (
    <>
      <div className="fixed inset-0 z-[9999] hidden items-center justify-center bg-[color:var(--c-bg)] p-8 text-center text-[color:var(--c-text-muted)] text-base max-[1199px]:flex">
        <div>{t("app.desktopOnly")}</div>
      </div>
      <div className="flex h-screen min-w-[1200px] flex-col max-[1199px]:hidden">
        <AppHeader />
        <main className="flex-1 overflow-hidden p-6">
          <Routes>
            <Route element={<Dashboard />} path="/" />
            <Route element={<Navigate replace to="/" />} path="/workspace" />
            <Route
              element={<BankWorkspace />}
              path="/repo/:owner/:repo/pr/:prNumber/*"
            />
            <Route element={<PullRequestShortcut />} path="/pr/:prNumber" />
            <Route
              element={<ImportPrototypeRoute />}
              path="/prototype/import-screen"
            />
            <Route element={<Navigate replace to="/" />} path="*" />
          </Routes>
        </main>
      </div>
    </>
  );
}
