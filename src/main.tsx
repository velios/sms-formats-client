import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { i18nReady } from "./i18n";
import { queryClient } from "./lib/query-client";
import "./styles.css";

i18nReady
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </React.StrictMode>
    );
  })
  .catch(() => {
    document.getElementById("root")!.textContent =
      "Не удалось загрузить данные приложения. Обновите страницу.";
  });
