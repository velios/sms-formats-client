import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function HomeHub() {
  const { t } = useTranslation();

  return (
    <section className="home-hub">
      <Link className="home-card home-card--user" to="/share-your-sms">
        <span className="home-card__badge">{t("home.userBadge")}</span>
        <h2 className="home-card__title">{t("home.userTitle")}</h2>
        <p className="home-card__description">{t("home.userDescription")}</p>
        <span className="home-card__action">{t("home.userAction")}</span>
      </Link>

      <Link className="home-card home-card--developer" to="/">
        <span className="home-card__badge">{t("home.developerBadge")}</span>
        <h2 className="home-card__title">{t("home.developerTitle")}</h2>
        <p className="home-card__description">
          {t("home.developerDescription")}
        </p>
        <span className="home-card__action">{t("home.developerAction")}</span>
      </Link>
    </section>
  );
}
