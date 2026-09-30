import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { loadData } from "@/content/load-data";

const savedLang =
  typeof localStorage !== "undefined"
    ? (localStorage.getItem("sms-formats-lang") ?? "ru")
    : "ru";

export const i18nReady = Promise.all([loadData("ru"), loadData("en")]).then(
  ([ru, en]) =>
    i18n.use(initReactI18next).init({
      resources: {
        ru: { translation: ru },
        en: { translation: en },
      },
      lng: savedLang,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    })
);

export default i18n;
