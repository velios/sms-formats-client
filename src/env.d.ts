/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_SOURCE_REPO: string;
  readonly VITE_GITHUB_DEFAULT_SOURCE_REPO?: string;
  readonly VITE_DEFAULT_BRANCH: string;
  readonly VITE_GITHUB_ISSUE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.toml" {
  const value: unknown;
  export default value;
}
