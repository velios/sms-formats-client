// ─── Core domain types ───

export interface ValidationIssue {
  code: string;
  level: "error" | "warning";
  filePath: string;
  message: string;
}

export interface ParsedFormat {
  regex: string;
  columns: string[];
  examples: string[];
  raw: string;
  parseIssues: ValidationIssue[];
}

export interface BankInfo {
  displayName: string;
  folderPath: string;
  bankId: string | null;
  formatFiles: string[];
  hasSenders: boolean;
}

export interface SourceRef {
  type: "branch" | "pr";
  name: string;
  sha: string;
  prNumber?: number;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface FileEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
}

export interface DraftFile {
  sourceRef: string;
  bankPath: string;
  filePath: string;
  baseSha: string;
  content: string;
  timestamp: number;
}

export interface PublishPreflight {
  canPublish: boolean;
  changedBanks: string[];
  blockingIssues: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface MergeResult {
  path: string;
  status: "clean" | "conflict" | "unchanged";
  content: string;
}

// ─── Column reference ───

export interface ColumnDef {
  name: string;
  description: { ru: string; en: string };
  parameterized?: boolean;
  paramHint?: string;
}

export const ALLOWED_COLUMNS: ColumnDef[] = [
  {
    name: "payee",
    description: { ru: "Получатель платежа", en: "Payee / merchant" },
  },
  { name: "income", description: { ru: "Сумма прихода", en: "Income amount" } },
  {
    name: "outcome",
    description: { ru: "Сумма расхода", en: "Outcome amount" },
  },
  {
    name: "fee",
    description: { ru: "Комиссия", en: "Fee amount" },
  },
  {
    name: "cashback",
    description: { ru: "Кешбэк", en: "Cashback amount" },
  },
  {
    name: "op_income",
    description: {
      ru: "Доход в исходной сумме",
      en: "Income in original amount",
    },
  },
  {
    name: "op_outcome",
    description: {
      ru: "Расход в исходной сумме",
      en: "Outcome in original amount",
    },
  },
  { name: "balance", description: { ru: "Баланс", en: "Balance" } },
  {
    name: "av_balance",
    description: { ru: "Доступный баланс", en: "Available balance" },
  },
  { name: "comment", description: { ru: "Комментарий", en: "Comment" } },
  {
    name: "instrument",
    description: {
      ru: "Валюта операции",
      en: "Transaction instrument/currency",
    },
  },
  {
    name: "op_instrument",
    description: { ru: "Исходная валюта", en: "Original instrument/currency" },
  },
  {
    name: "acc_instrument",
    description: { ru: "Валюта счёта", en: "Account instrument/currency" },
  },
  {
    name: "date",
    description: { ru: "Дата операции", en: "Transaction date" },
    parameterized: true,
    paramHint: "dd.MM.yyyy",
  },
  {
    name: "syncid",
    description: {
      ru: "Идентификатор счёта/карты",
      en: "Account/card sync ID",
    },
    parameterized: true,
    paramHint: "ccard / checking / deposit",
  },
  { name: "mcc", description: { ru: "MCC-код", en: "MCC code" } },
];

export const ALLOWED_COLUMNS_SORTED = [...ALLOWED_COLUMNS].sort((a, b) =>
  a.name.localeCompare(b.name)
);

export const ALLOWED_COLUMN_NAMES = new Set(ALLOWED_COLUMNS.map((c) => c.name));
