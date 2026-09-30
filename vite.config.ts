import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function normalizeBasePath(input: string | undefined): string {
  if (!input) {
    return "/";
  }

  const trimmed = input.trim();
  if (trimmed === "" || trimmed === "/") {
    return "/";
  }

  const withoutSlashes = trimmed.replace(/^\/+|\/+$/g, "");
  return `/${withoutSlashes}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = normalizeBasePath(env.VITE_APP_BASE_PATH);

  return {
    base,
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "codemirror",
                priority: 20,
                test: /[\\/]node_modules[\\/](?:@codemirror[\\/]|@lezer[\\/]|(?:crelt|style-mod|w3c-keyname)[\\/])/,
              },
              {
                name: "react",
                priority: 20,
                test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              },
              {
                name: "shared",
                priority: 15,
                test: (id) => {
                  const path = id.replace(/\\/g, "/");
                  return (
                    path.includes("/node_modules/") ||
                    /\/src\/(?:domain|hooks|lib|infrastructure|store|i18n)\//.test(
                      path
                    ) ||
                    path.endsWith("/src/config.ts") ||
                    /\/src\/components\/(?!AppHeader)/.test(path) ||
                    /\/src\/features\/(?:resizable-panels|source-selector)\//.test(
                      path
                    ) ||
                    path.includes("vite/preload-helper")
                  );
                },
              },
              {
                name: "app",
                priority: 10,
                tags: ["$initial"],
              },
              {
                name: "workspace",
                priority: 0,
                test: () => true,
              },
            ],
          },
        },
      },
    },
    plugins: [tailwindcss(), react()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port: 5173,
    },
  };
});
