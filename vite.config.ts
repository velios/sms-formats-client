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
                test: /[\\/]node_modules[\\/](?:@codemirror[\\/]|@lezer[\\/]|(?:crelt|style-mod|w3c-keyname)[\\/])/,
              },
              {
                name: "react",
                test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
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
