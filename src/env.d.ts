/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_OWNER: string;
  readonly VITE_GITHUB_REPO: string;
  readonly VITE_DEFAULT_BRANCH: string;
  readonly VITE_GITHUB_ISSUE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
