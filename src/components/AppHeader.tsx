import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { SourceSelector } from "@/features/source-selector/SourceSelector";
import { useSourceStore, useUIStore } from "@/store";

export function AppHeader() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const setLocale = useUIStore((s) => s.setLocale);
  const locale = useUIStore((s) => s.locale);
  const isHome = location.pathname === "/";

  const toggleLocale = () => {
    const next = locale === "ru" ? "en" : "ru";
    setLocale(next);
    i18n.changeLanguage(next);
  };

  return (
    <header className="app-header">
      <div
        className="app-header__title"
        onClick={() => navigate("/")}
        style={{ cursor: "pointer" }}
      >
        {t("app.title")}
      </div>

      {!isHome && sourceRef && (
        <div className="flex items-center gap-sm">
          <span className="badge badge--info text-sm">
            {sourceRef.type === "pr" ? `PR #${sourceRef.prNumber}` : ""}{" "}
            {sourceRef.name}
          </span>
        </div>
      )}

      <div className="app-header__spacer" />

      {!isHome && <SourceSelector />}

      <button className="btn btn--ghost btn--sm" onClick={toggleLocale}>
        {locale === "ru" ? "EN" : "RU"}
      </button>
    </header>
  );
}
