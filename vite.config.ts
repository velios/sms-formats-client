import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const dataFiles = {
  ru: "src/i18n/ru.json",
  en: "src/i18n/en.json",
  "cookbook-snippets": "src/content/cookbook-snippets.generated.json",
  "format-rules": "src/content/format-rules.generated.json",
};

function externalData(): Plugin {
  let base = "/";
  let root = "";
  let command = "";
  let urls: Record<string, string> = {};
  return {
    name: "external-data",
    configResolved(config) {
      root = config.root;
      base = config.base;
      command = config.command;
    },
    buildStart() {
      if (command !== "build") {
        return;
      }
      urls = {};
      for (const [name, path] of Object.entries(dataFiles)) {
        const source = readFileSync(resolve(root, path), "utf8");
        const hash = createHash("sha256")
          .update(source)
          .digest("hex")
          .slice(0, 16);
        const fileName = `assets/${name}-${hash}.json`;
        this.emitFile({ type: "asset", fileName, source });
        urls[name] = `${base}${fileName}`;
      }
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const manifest = context.server
          ? Object.fromEntries(
              Object.entries(dataFiles).map(([name, path]) => [
                name,
                `${base}${path}`,
              ])
            )
          : urls;
        return [
          {
            tag: "script",
            attrs: { id: "app-data", type: "application/json" },
            children: JSON.stringify(manifest),
            injectTo: "head",
          },
        ];
      },
    },
  };
}

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
              ...(
                [
                  ["octokit", /[\\/]node_modules[\\/]@octokit[\\/]/],
                  ["zod", /[\\/]node_modules[\\/]zod[\\/]/],
                  [
                    "router",
                    /[\\/]node_modules[\\/](?:react-router|react-router-dom)[\\/]/,
                  ],
                  ["query", /[\\/]node_modules[\\/]@tanstack[\\/]/],
                  [
                    "i18n-vendor",
                    /[\\/]node_modules[\\/](?:i18next|react-i18next)[\\/]/,
                  ],
                  [
                    "ui-vendor",
                    /[\\/]node_modules[\\/](?:@radix-ui|@floating-ui)[\\/]/,
                  ],
                ] as const
              ).map(([name, test]) => ({
                name,
                test,
                priority: 19,
              })),
              { name: "vendor", priority: 18, test: /[\\/]node_modules[\\/]/ },
              {
                name: "reference",
                priority: 16,
                includeDependenciesRecursively: false,
                test: /[\\/]src[\\/]content[\\/].*\.generated\.ts$/,
              },
              {
                name: "prompt-package",
                priority: 16,
                includeDependenciesRecursively: false,
                test: /[\\/]src[\\/]features[\\/]prompt-package[\\/]/,
              },
              {
                name: "import-answer",
                priority: 16,
                includeDependenciesRecursively: false,
                test: /[\\/]src[\\/]features[\\/]import-answer[\\/]/,
              },
              {
                name: "shared",
                priority: 15,
                test: (id) => {
                  const path = id.replace(/\\/g, "/");
                  return (
                    /\/src\/(?:domain|hooks|lib|infrastructure|store|i18n)\//.test(
                      path
                    ) ||
                    path.endsWith("/src/config.ts") ||
                    path.endsWith("/src/content/load-data.ts") ||
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
    plugins: [externalData(), tailwindcss(), react()],
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port: 5173,
    },
  };
});
