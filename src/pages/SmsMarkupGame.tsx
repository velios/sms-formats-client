import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { config } from "@/config";
import {
  buildBankWorkspacePath,
  sourceRefToRouteSource,
} from "@/domain/bank-route";
import { serializeFormat } from "@/domain/format";
import {
  createAuthenticatedOctokit,
  createIssue,
  fetchBranchSha,
  fetchIssue,
  fetchRepoTree,
  indexBanksFromTree,
} from "@/domain/github";
import {
  ensureSmsGameIssueTitleMarker,
  parseIssueIdentifier,
  parseSmsGameIssueBody,
} from "@/domain/sms-game/issue-import";
import type { BankInfo, RepoRef, SourceRef } from "@/domain/types";
import { ALLOWED_COLUMNS_SORTED } from "@/domain/types";
import { useDraftStore, useSourceStore } from "@/store";

type GameStage = "paste" | "markup" | "bank" | "issue";
type MarkupNode = TextNode | SlotNode;

interface TextNode {
  id: string;
  type: "text";
  text: string;
}

interface SlotNode {
  id: string;
  type: "slot";
  placeholder: string | null;
  selectedText: string;
}

interface PendingSelection {
  nodeId: string;
  start: number;
  end: number;
  text: string;
}

interface PickerState {
  mode: "selection" | "slot";
  selection?: PendingSelection;
  slotId?: string;
}

interface SelectionActionHint {
  selection: PendingSelection;
  top: number;
  left: number;
}

interface SavedFormatDraft {
  id: string;
  sourceSms: string;
  template: string;
  placeholders: string[];
  similarExamples: string[];
}

interface TemplatePart {
  type: "text" | "placeholder";
  value: string;
}

interface ImportedIssueData {
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  bankName: string;
  senders: string;
  formats: SavedFormatDraft[];
}

interface CachedSelectedIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

type ImportTarget =
  | { mode: "existing"; bankPath: string }
  | { mode: "new"; bankName: string };

interface DraftStoreLike {
  drafts: Map<string, unknown>;
  setDraft: (
    filePath: string,
    content: string,
    baseSha: string,
    remoteContent: string
  ) => void;
}

const SELECTED_ISSUE_CACHE_KEY = "sms-game-selected-issue";

const SPECIAL_PLACEHOLDERS = new Map<string, string>([
  ["syncid", "syncId"],
  ["date", "date"],
]);

function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeTextNode(text: string): TextNode {
  return { id: createId(), type: "text", text };
}

function makeSlotNode(
  placeholder: string | null,
  selectedText: string
): SlotNode {
  return { id: createId(), type: "slot", placeholder, selectedText };
}

function normalizePlaceholderValue(rawValue: string): string {
  const [base, param] = rawValue.split("#");
  if (!base) {
    return rawValue;
  }
  const special = SPECIAL_PLACEHOLDERS.get(base.toLowerCase());
  if (special) {
    return special;
  }
  return param ? `${base}#${param}` : base;
}

function toComparableBase(value: string): string {
  const base = value.split("#")[0] ?? "";
  const lower = base.toLowerCase();
  if (lower === "syncid") {
    return "syncid";
  }
  return lower;
}

function splitTemplate(template: string): TemplatePart[] {
  const pattern = /\$\{([^}]+)\}/g;
  const parts: TemplatePart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        value: template.slice(lastIndex, match.index),
      });
    }
    parts.push({ type: "placeholder", value: match[1] ?? "" });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < template.length) {
    parts.push({ type: "text", value: template.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: template }];
}

function normalizeNodes(nodes: MarkupNode[]): MarkupNode[] {
  const normalized: MarkupNode[] = [];

  for (const node of nodes) {
    if (node.type === "text" && node.text.length === 0) {
      continue;
    }

    const prev = normalized.at(-1);
    if (node.type === "text" && prev?.type === "text") {
      prev.text += node.text;
      continue;
    }

    normalized.push(node);
  }

  return normalized.length > 0 ? normalized : [makeTextNode("")];
}

function buildTemplate(nodes: MarkupNode[], emptySlotToken = ""): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.text;
      }
      if (!node.placeholder) {
        return emptySlotToken;
      }
      return `\${${node.placeholder}}`;
    })
    .join("");
}

function extractPlaceholders(nodes: MarkupNode[]): string[] {
  const placeholders = nodes
    .filter((node): node is SlotNode => node.type === "slot")
    .map((node) => node.placeholder)
    .filter((value): value is string => !!value);
  return Array.from(new Set(placeholders));
}

function getSlotOrder(nodes: MarkupNode[]): string[] {
  return nodes
    .filter((node): node is SlotNode => node.type === "slot")
    .map((node) => node.id);
}

function normalizeCodeBlockText(text: string): string {
  return text.replace(/```/g, "``` ");
}

function readGitHubErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function buildIssueBody(
  bankName: string,
  formats: SavedFormatDraft[],
  sendersTemplate: string
): string {
  const normalizedSenders = sendersTemplate.trim() || "SENDER_NAME";
  const header = [
    "# SMS Markup Game Export",
    "",
    `- Bank: \`${bankName}\``,
    `- Formats: ${formats.length}`,
    "",
    "Generated from interactive SMS markup page.",
    "",
    "### Senders",
    "```text",
    normalizeCodeBlockText(normalizedSenders),
    "```",
    "",
  ];

  const sections = formats.flatMap((format, index) => {
    const examples = format.similarExamples.filter((item) => item.trim());
    return [
      `## Format ${index + 1}`,
      "",
      "### Source SMS",
      "```text",
      normalizeCodeBlockText(format.sourceSms),
      "```",
      "",
      "### Template",
      "```text",
      normalizeCodeBlockText(format.template),
      "```",
      "",
      "### Placeholders",
      "```text",
      normalizeCodeBlockText(format.placeholders.join("\n") || "(none)"),
      "```",
      "",
      "### Similar SMS",
      "```text",
      normalizeCodeBlockText(examples.join("\n\n") || "(none)"),
      "```",
      "",
    ];
  });

  return [...header, ...sections].join("\n");
}

function normalizeBankFolderPart(value: string): string {
  return value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}_ .()-]+/gu, "")
    .trim();
}

function normalizeBankLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getContainerElement(container: Node): HTMLElement | null {
  if (container.nodeType === Node.TEXT_NODE) {
    return container.parentElement;
  }
  return container as HTMLElement;
}

function resolvePendingSelection(
  range: Range,
  nodes: MarkupNode[]
): PendingSelection | null {
  if (range.startContainer !== range.endContainer) {
    return null;
  }

  const startElement = getContainerElement(range.startContainer);
  const endElement = getContainerElement(range.endContainer);
  const startTextNode = startElement?.closest<HTMLElement>(
    '[data-node-type="text"][data-node-id]'
  );
  const endTextNode = endElement?.closest<HTMLElement>(
    '[data-node-type="text"][data-node-id]'
  );
  if (!(startTextNode && endTextNode) || startTextNode !== endTextNode) {
    return null;
  }

  const nodeId = startTextNode.dataset.nodeId;
  if (!nodeId) {
    return null;
  }

  const start = Math.min(range.startOffset, range.endOffset);
  const end = Math.max(range.startOffset, range.endOffset);
  if (start === end) {
    return null;
  }

  const textNode = nodes.find(
    (node): node is TextNode => node.type === "text" && node.id === nodeId
  );
  if (!textNode) {
    return null;
  }

  const selectedText = textNode.text.slice(start, end);
  if (!selectedText) {
    return null;
  }

  return { nodeId, start, end, text: selectedText };
}

function resolveSelectionHint(nodes: MarkupNode[]): SelectionActionHint | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const pendingSelection = resolvePendingSelection(range, nodes);
  if (!pendingSelection) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, 64),
    window.innerWidth - 64
  );
  const top = Math.max(rect.top - 40, 8);

  return {
    selection: pendingSelection,
    top,
    left,
  };
}

type Translator = (key: string, options?: Record<string, unknown>) => string;

function resolveIssuePublishErrorMessage(
  error: unknown,
  t: Translator
): string {
  const status = readGitHubErrorStatus(error);
  if (status === 404) {
    return t("smsGame.issueErrorNotFound", {
      owner: config.defaultSourceOwner,
      repo: config.defaultSourceRepo,
    });
  }
  if (status === 403) {
    return t("smsGame.issueErrorForbidden");
  }
  if (status === 410) {
    return t("smsGame.issueErrorDisabled");
  }
  return error instanceof Error ? error.message : String(error);
}

function resolveBankTargetFromImport(params: {
  issueData: ImportedIssueData;
  baseBanks: BankInfo[];
  target: ImportTarget;
  draftStore: DraftStoreLike;
  sourceSha: string;
}): {
  bankPath: string;
  existingBank: BankInfo | null;
  createdNewBank: boolean;
  createdBankDisplayName: string;
} {
  const { issueData, baseBanks, target, draftStore, sourceSha } = params;
  if (target.mode === "existing") {
    const existingBank =
      baseBanks.find((bank) => bank.folderPath === target.bankPath) ?? null;
    if (!existingBank) {
      throw new Error("Target bank not found");
    }
    return {
      bankPath: existingBank.folderPath,
      existingBank,
      createdNewBank: false,
      createdBankDisplayName: "",
    };
  }

  const finalBankName =
    target.bankName.trim() || issueData.bankName.trim() || "new-bank";
  const folderBase = normalizeBankFolderPart(finalBankName) || "new-bank";
  const usedBankPaths = new Set(baseBanks.map((bank) => bank.folderPath));
  for (const [path] of draftStore.drafts) {
    if (path.startsWith("src/")) {
      usedBankPaths.add(path.split("/").slice(0, 2).join("/"));
    }
  }

  let bankPath = `src/${folderBase}`;
  let counter = 2;
  while (usedBankPaths.has(bankPath)) {
    bankPath = `src/${folderBase}_${counter}`;
    counter += 1;
  }

  const normalizedSenders = issueData.senders.trim() || "SENDER_NAME";
  draftStore.setDraft(
    `${bankPath}/senders.txt`,
    `${normalizedSenders}\n`,
    sourceSha,
    ""
  );

  return {
    bankPath,
    existingBank: null,
    createdNewBank: true,
    createdBankDisplayName: finalBankName,
  };
}

function collectExistingFormatPaths(
  existingBank: BankInfo | null,
  bankPath: string,
  draftStore: DraftStoreLike
): Set<string> {
  const paths = new Set<string>();
  if (existingBank) {
    existingBank.formatFiles.forEach((filePath) => paths.add(filePath));
  }
  for (const [path] of draftStore.drafts) {
    if (path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")) {
      paths.add(path);
    }
  }
  return paths;
}

function buildUniqueImportedFormatPath(params: {
  bankPath: string;
  issueNumber: number;
  formatIndex: number;
  existingFormatPaths: Set<string>;
}): string {
  const { bankPath, issueNumber, formatIndex, existingFormatPaths } = params;
  const fileBase = `issue_${issueNumber}_format_${formatIndex + 1}`;
  let filePath = `${bankPath}/formats/${fileBase}.txt`;
  let suffix = 2;
  while (existingFormatPaths.has(filePath)) {
    filePath = `${bankPath}/formats/${fileBase}_${suffix}.txt`;
    suffix += 1;
  }
  return filePath;
}

function buildIssueFormatContent(format: SavedFormatDraft): string {
  const columns = format.placeholders
    .map(normalizePlaceholderValue)
    .filter((column) => column.trim().length > 0);
  const examples = format.similarExamples
    .map((example) => example.trim())
    .filter((example) => example.length > 0);

  if (examples.length === 0 && format.sourceSms.trim()) {
    examples.push(format.sourceSms.trim());
  }
  if (examples.length === 0) {
    examples.push("Sample SMS text");
  }

  return serializeFormat(
    format.template,
    columns.length > 0 ? columns : ["comment"],
    examples
  );
}

function createImportedFormatDrafts(params: {
  issueData: ImportedIssueData;
  bankPath: string;
  sourceSha: string;
  existingFormatPaths: Set<string>;
  draftStore: DraftStoreLike;
}): string[] {
  const { issueData, bankPath, sourceSha, existingFormatPaths, draftStore } =
    params;
  const createdFiles: string[] = [];

  issueData.formats.forEach((format, index) => {
    const filePath = buildUniqueImportedFormatPath({
      bankPath,
      issueNumber: issueData.issueNumber,
      formatIndex: index,
      existingFormatPaths,
    });
    existingFormatPaths.add(filePath);
    draftStore.setDraft(
      filePath,
      buildIssueFormatContent(format),
      sourceSha,
      ""
    );
    createdFiles.push(filePath);
  });

  return createdFiles;
}

function applyImportedFormatsToBanks(params: {
  baseBanks: BankInfo[];
  bankPath: string;
  createdFiles: string[];
  createdNewBank: boolean;
  createdBankDisplayName: string;
}): void {
  const {
    baseBanks,
    bankPath,
    createdFiles,
    createdNewBank,
    createdBankDisplayName,
  } = params;
  if (createdNewBank) {
    useSourceStore.getState().setBanks([
      ...baseBanks,
      {
        displayName: createdBankDisplayName,
        folderPath: bankPath,
        bankId: null,
        formatFiles: createdFiles,
        hasSenders: true,
      },
    ]);
    return;
  }

  useSourceStore.getState().setBanks(
    baseBanks.map((bank) => {
      if (bank.folderPath !== bankPath) {
        return bank;
      }
      const merged = Array.from(
        new Set([...bank.formatFiles, ...createdFiles])
      ).sort();
      return { ...bank, formatFiles: merged };
    })
  );
}

function navigateToImportedWorkspace(
  navigate: (path: string) => void,
  bankPath: string,
  createdFiles: string[],
  repository: RepoRef,
  sourceRef: SourceRef | null
): void {
  const firstFile = createdFiles[0];
  navigate(
    buildBankWorkspacePath({
      bankPath,
      repository,
      source: sourceRefToRouteSource(sourceRef, config.defaultBranch),
      filePath: firstFile,
    })
  );
}

function loadCachedSelectedIssueFromSession(
  issueNumber: number
): CachedSelectedIssue | null {
  try {
    const raw = sessionStorage.getItem(SELECTED_ISSUE_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CachedSelectedIssue>;
    const { number, title, body, url } = parsed;
    if (
      typeof number !== "number" ||
      number !== issueNumber ||
      typeof title !== "string" ||
      typeof body !== "string" ||
      typeof url !== "string"
    ) {
      return null;
    }
    return {
      number,
      title,
      body,
      url,
    };
  } catch {
    return null;
  }
}

function buildImportedIssueFromRaw(
  rawIssue: CachedSelectedIssue
): ImportedIssueData {
  const parsedIssue = parseSmsGameIssueBody(rawIssue.body);
  const importedFormats: SavedFormatDraft[] = parsedIssue.formats.map(
    (format) => ({
      id: createId(),
      sourceSms: format.sourceSms,
      template: format.template,
      placeholders: format.placeholders.map(normalizePlaceholderValue),
      similarExamples:
        format.similarExamples.length > 0
          ? format.similarExamples
          : format.sourceSms.trim()
            ? [format.sourceSms.trim()]
            : [],
    })
  );

  return {
    issueNumber: rawIssue.number,
    issueTitle: rawIssue.title,
    issueUrl: rawIssue.url,
    bankName: parsedIssue.bankName,
    senders: parsedIssue.senders,
    formats: importedFormats,
  };
}

async function ensureMainBanksLoadedFromMainBranch(): Promise<{
  mainBanks: BankInfo[];
  sourceSha: string;
}> {
  const mainBranch = config.defaultBranch;
  const state = useSourceStore.getState();
  let sourceSha =
    state.sourceRef?.type === "branch" && state.sourceRef.name === mainBranch
      ? state.sourceRef.sha
      : "";

  if (!sourceSha) {
    sourceSha = await fetchBranchSha(mainBranch);
    useSourceStore.getState().setSource({
      type: "branch",
      name: mainBranch,
      sha: sourceSha,
    });
  }

  const tree = await fetchRepoTree(sourceSha);
  const mainBanks = indexBanksFromTree(tree);
  useSourceStore.getState().setTree(tree);
  return { mainBanks, sourceSha };
}

async function fetchRawIssue(
  issueNumber: number
): Promise<CachedSelectedIssue> {
  const cached = loadCachedSelectedIssueFromSession(issueNumber);
  if (cached) {
    return cached;
  }

  const issueToken = config.issueToken.trim();
  const octokit = issueToken
    ? createAuthenticatedOctokit(issueToken)
    : undefined;
  const issue = await fetchIssue(issueNumber, octokit);
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    url: issue.url,
  };
}

function resolveIssueImportErrorMessage(error: unknown, t: Translator): string {
  const status = readGitHubErrorStatus(error);
  if (status === 404) {
    return t("smsGame.importIssueNotFound");
  }
  if (status === 403) {
    return t("smsGame.importIssueForbidden");
  }
  return error instanceof Error ? error.message : String(error);
}

function resolveImportTargetDefaults(
  banks: BankInfo[],
  importedIssue: ImportedIssueData
): {
  importTargetMode: "existing" | "new";
  selectedExistingBankPath: string;
  newImportBankName: string;
} {
  const matchedBank = banks.find(
    (bank) =>
      normalizeBankLookup(bank.displayName) ===
      normalizeBankLookup(importedIssue.bankName)
  );

  if (matchedBank) {
    return {
      importTargetMode: "existing",
      selectedExistingBankPath: matchedBank.folderPath,
      newImportBankName: importedIssue.bankName,
    };
  }

  return {
    importTargetMode: banks.length > 0 ? "existing" : "new",
    selectedExistingBankPath: banks[0]?.folderPath ?? "",
    newImportBankName: importedIssue.bankName,
  };
}

function resolveStartImportError(params: {
  importedIssue: ImportedIssueData | null;
  importSourceSha: string;
  importTargetMode: "existing" | "new";
  selectedExistingBankPath: string;
  newImportBankName: string;
  t: Translator;
}): string | null {
  const {
    importedIssue,
    importSourceSha,
    importTargetMode,
    selectedExistingBankPath,
    newImportBankName,
    t,
  } = params;

  if (!(importedIssue && importSourceSha)) {
    return null;
  }
  if (importTargetMode === "existing" && !selectedExistingBankPath) {
    return t("smsGame.importTargetSelectBank");
  }
  if (importTargetMode === "new" && !newImportBankName.trim()) {
    return t("smsGame.importTargetNewBankRequired");
  }
  return null;
}

function shouldAutoImportIssue(params: {
  stage: GameStage;
  presetIssueQuery: string;
  autoStartFromSource: boolean;
  hasTriedAutoImport: boolean;
  isImportLoading: boolean;
}): boolean {
  const {
    stage,
    presetIssueQuery,
    autoStartFromSource,
    hasTriedAutoImport,
    isImportLoading,
  } = params;
  return (
    stage === "issue" &&
    !!presetIssueQuery &&
    autoStartFromSource &&
    !hasTriedAutoImport &&
    !isImportLoading
  );
}

function startMarkupSession(params: {
  smsInput: string;
  setNodes: (nodes: MarkupNode[]) => void;
  setPickerState: (value: PickerState | null) => void;
  setSelectionHint: (value: SelectionActionHint | null) => void;
  setIssueError: (value: string | null) => void;
  setStage: (stage: GameStage) => void;
}): void {
  const {
    smsInput,
    setNodes,
    setPickerState,
    setSelectionHint,
    setIssueError,
    setStage,
  } = params;
  if (!smsInput.trim()) {
    return;
  }
  setNodes([makeTextNode(smsInput)]);
  setPickerState(null);
  setSelectionHint(null);
  setIssueError(null);
  setStage("markup");
}

function replaceSelectionWithPlaceholderInNodes(
  nodes: MarkupNode[],
  selection: PendingSelection,
  placeholder: string
): MarkupNode[] {
  const index = nodes.findIndex(
    (node) => node.type === "text" && node.id === selection.nodeId
  );
  if (index === -1) {
    return nodes;
  }

  const target = nodes[index];
  if (!target || target.type !== "text") {
    return nodes;
  }

  const before = target.text.slice(0, selection.start);
  const picked = target.text.slice(selection.start, selection.end);
  const after = target.text.slice(selection.end);
  if (!picked) {
    return nodes;
  }

  return normalizeNodes([
    ...nodes.slice(0, index),
    ...(before ? [makeTextNode(before)] : []),
    makeSlotNode(placeholder, picked),
    ...(after ? [makeTextNode(after)] : []),
    ...nodes.slice(index + 1),
  ]);
}

function setSlotPlaceholderInNodes(
  nodes: MarkupNode[],
  slotId: string,
  placeholder: string | null
): MarkupNode[] {
  return nodes.map((node) => {
    if (node.type !== "slot" || node.id !== slotId) {
      return node;
    }
    return { ...node, placeholder };
  });
}

function removeSlotFromNodes(
  nodes: MarkupNode[],
  slotId: string
): MarkupNode[] {
  return normalizeNodes(
    nodes.flatMap((node) => {
      if (node.type !== "slot" || node.id !== slotId) {
        return [node];
      }
      return [makeTextNode(node.selectedText)];
    })
  );
}

function applyPickerSelection(params: {
  pickerState: PickerState | null;
  value: string;
  setNodes: (updater: (prev: MarkupNode[]) => MarkupNode[]) => void;
  setPickerState: (value: PickerState | null) => void;
  setSelectionHint: (value: SelectionActionHint | null) => void;
}): void {
  const { pickerState, value, setNodes, setPickerState, setSelectionHint } =
    params;
  if (!pickerState) {
    return;
  }

  const normalized = normalizePlaceholderValue(value);
  if (pickerState.mode === "selection" && pickerState.selection) {
    const selection = pickerState.selection;
    setNodes((prev) =>
      replaceSelectionWithPlaceholderInNodes(prev, selection, normalized)
    );
  } else if (pickerState.mode === "slot" && pickerState.slotId) {
    const slotId = pickerState.slotId;
    setNodes((prev) => setSlotPlaceholderInNodes(prev, slotId, normalized));
  }

  setPickerState(null);
  setSelectionHint(null);
}

function withFormatDraftAppended(
  previous: SavedFormatDraft[],
  smsInput: string,
  templateForSave: string,
  placeholdersInTemplate: string[]
): SavedFormatDraft[] {
  return [
    ...previous,
    {
      id: createId(),
      sourceSms: smsInput,
      template: templateForSave,
      placeholders: placeholdersInTemplate,
      similarExamples: [smsInput],
    },
  ];
}

function updateSavedFormatExample(
  formats: SavedFormatDraft[],
  formatId: string,
  index: number,
  value: string
): SavedFormatDraft[] {
  return formats.map((format) => {
    if (format.id !== formatId) {
      return format;
    }
    return {
      ...format,
      similarExamples: format.similarExamples.map((example, exampleIndex) =>
        exampleIndex === index ? value : example
      ),
    };
  });
}

function addSavedFormatExample(
  formats: SavedFormatDraft[],
  formatId: string
): SavedFormatDraft[] {
  return formats.map((format) =>
    format.id === formatId
      ? { ...format, similarExamples: [...format.similarExamples, ""] }
      : format
  );
}

function removeSavedFormatExample(
  formats: SavedFormatDraft[],
  formatId: string,
  index: number
): SavedFormatDraft[] {
  return formats.map((format) => {
    if (format.id !== formatId || format.similarExamples.length === 1) {
      return format;
    }
    return {
      ...format,
      similarExamples: format.similarExamples.filter(
        (_, exampleIndex) => exampleIndex !== index
      ),
    };
  });
}

function canProceedToIssueStage(
  bankName: string,
  savedFormats: SavedFormatDraft[]
): boolean {
  return !!bankName.trim() && savedFormats.length > 0;
}

function handleMarkSelectionAction(params: {
  selectionHint: SelectionActionHint | null;
  setPickerState: (value: PickerState | null) => void;
  setSelectionHint: (value: SelectionActionHint | null) => void;
}): void {
  const { selectionHint, setPickerState, setSelectionHint } = params;
  if (!selectionHint) {
    return;
  }
  setPickerState({ mode: "selection", selection: selectionHint.selection });
  setSelectionHint(null);
}

function handleChipDragEndAction(params: {
  event: React.DragEvent;
  slotId: string;
  setNodes: (updater: (prev: MarkupNode[]) => MarkupNode[]) => void;
}): void {
  const { event, slotId, setNodes } = params;
  const target = event.currentTarget as HTMLElement;
  const droppedInsideSurface = target.dataset.droppedInside === "true";
  target.dataset.droppedInside = "false";
  if (droppedInsideSurface) {
    return;
  }
  setNodes((prev) => setSlotPlaceholderInNodes(prev, slotId, null));
}

function saveCurrentDraftAndSwitchToBankStage(params: {
  canSaveDraft: boolean;
  smsInput: string;
  templateForSave: string;
  placeholdersInTemplate: string[];
  setSavedFormats: React.Dispatch<React.SetStateAction<SavedFormatDraft[]>>;
  setSelectionHint: (value: SelectionActionHint | null) => void;
  setStage: (stage: GameStage) => void;
}): void {
  const {
    canSaveDraft,
    smsInput,
    templateForSave,
    placeholdersInTemplate,
    setSavedFormats,
    setSelectionHint,
    setStage,
  } = params;
  if (!canSaveDraft) {
    return;
  }
  setSavedFormats((prev) =>
    withFormatDraftAppended(
      prev,
      smsInput,
      templateForSave,
      placeholdersInTemplate
    )
  );
  setSelectionHint(null);
  setStage("bank");
}

function openIssueStageIfReady(params: {
  bankName: string;
  savedFormats: SavedFormatDraft[];
  setIssueError: (value: string | null) => void;
  setStage: (stage: GameStage) => void;
}): void {
  const { bankName, savedFormats, setIssueError, setStage } = params;
  if (!canProceedToIssueStage(bankName, savedFormats)) {
    return;
  }
  setIssueError(null);
  setStage("issue");
}

async function publishIssueFromState(params: {
  bankName: string;
  savedFormats: SavedFormatDraft[];
  sendersTemplate: string;
  t: Translator;
  setIssueError: (value: string | null) => void;
  setIssueUrl: (value: string | null) => void;
  setIsCreatingIssue: (value: boolean) => void;
  invalidateStartableIssues: () => Promise<unknown>;
}): Promise<void> {
  const {
    bankName,
    savedFormats,
    sendersTemplate,
    t,
    setIssueError,
    setIssueUrl,
    setIsCreatingIssue,
    invalidateStartableIssues,
  } = params;
  if (!bankName.trim() || savedFormats.length === 0) {
    return;
  }

  const issueToken = config.issueToken.trim();
  if (!issueToken) {
    setIssueError(t("smsGame.issueTokenMissingEnv"));
    return;
  }

  setIssueError(null);
  setIssueUrl(null);
  setIsCreatingIssue(true);
  try {
    const octokit = createAuthenticatedOctokit(issueToken);
    const rawTitle = t("smsGame.issueTitleDefault", { bank: bankName.trim() });
    const title = ensureSmsGameIssueTitleMarker(rawTitle);
    const body = buildIssueBody(bankName.trim(), savedFormats, sendersTemplate);
    const issue = await createIssue(octokit, title, body);
    setIssueUrl(issue.url);
    await invalidateStartableIssues();
  } catch (error) {
    setIssueError(resolveIssuePublishErrorMessage(error, t));
  } finally {
    setIsCreatingIssue(false);
  }
}

async function loadIssueForWorkspaceState(params: {
  presetIssueQuery: string;
  t: Translator;
  setImportError: (value: string | null) => void;
  setIsImportLoading: (value: boolean) => void;
  setImportedIssue: (value: ImportedIssueData | null) => void;
  setImportBanks: (value: BankInfo[]) => void;
  setImportSourceSha: (value: string) => void;
  setImportTargetMode: (value: "existing" | "new") => void;
  setSelectedExistingBankPath: (value: string) => void;
  setNewImportBankName: (value: string) => void;
}): Promise<void> {
  const {
    presetIssueQuery,
    t,
    setImportError,
    setIsImportLoading,
    setImportedIssue,
    setImportBanks,
    setImportSourceSha,
    setImportTargetMode,
    setSelectedExistingBankPath,
    setNewImportBankName,
  } = params;
  const issueNumber = parseIssueIdentifier(presetIssueQuery);
  if (!issueNumber) {
    setImportError(t("smsGame.importIssueInvalid"));
    return;
  }

  setImportError(null);
  setIsImportLoading(true);
  try {
    const rawIssue = await fetchRawIssue(issueNumber);
    const nextImportedIssue = buildImportedIssueFromRaw(rawIssue);
    const { mainBanks, sourceSha } =
      await ensureMainBanksLoadedFromMainBranch();
    setImportedIssue(nextImportedIssue);
    setImportBanks(mainBanks);
    setImportSourceSha(sourceSha);

    const targetDefaults = resolveImportTargetDefaults(
      mainBanks,
      nextImportedIssue
    );
    setImportTargetMode(targetDefaults.importTargetMode);
    setSelectedExistingBankPath(targetDefaults.selectedExistingBankPath);
    setNewImportBankName(targetDefaults.newImportBankName);
  } catch (error) {
    setImportError(resolveIssueImportErrorMessage(error, t));
  } finally {
    setIsImportLoading(false);
  }
}

async function startWorkFromImportedIssueState(params: {
  importedIssue: ImportedIssueData | null;
  importSourceSha: string;
  importTargetMode: "existing" | "new";
  selectedExistingBankPath: string;
  newImportBankName: string;
  importBanks: BankInfo[];
  t: Translator;
  setImportError: (value: string | null) => void;
  setIsStartingFromIssue: (value: boolean) => void;
  createWorkspaceFromIssueData: (
    issueData: ImportedIssueData,
    baseBanks: BankInfo[],
    sourceSha: string,
    target: ImportTarget
  ) => void;
}): Promise<void> {
  const {
    importedIssue,
    importSourceSha,
    importTargetMode,
    selectedExistingBankPath,
    newImportBankName,
    importBanks,
    t,
    setImportError,
    setIsStartingFromIssue,
    createWorkspaceFromIssueData,
  } = params;

  const validationError = resolveStartImportError({
    importedIssue,
    importSourceSha,
    importTargetMode,
    selectedExistingBankPath,
    newImportBankName,
    t,
  });
  if (validationError) {
    setImportError(validationError);
    return;
  }
  if (!(importedIssue && importSourceSha)) {
    return;
  }

  setImportError(null);
  setIsStartingFromIssue(true);
  try {
    const target: ImportTarget =
      importTargetMode === "existing"
        ? { mode: "existing", bankPath: selectedExistingBankPath }
        : { mode: "new", bankName: newImportBankName };
    createWorkspaceFromIssueData(
      importedIssue,
      importBanks,
      importSourceSha,
      target
    );
  } catch (error) {
    setImportError(error instanceof Error ? error.message : String(error));
  } finally {
    setIsStartingFromIssue(false);
  }
}

export function SmsMarkupGame() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const lang = i18n.resolvedLanguage?.startsWith("ru") ? "ru" : "en";
  const draftStore = useDraftStore();
  const repository = useSourceStore((s) => s.repository);
  const sourceRef = useSourceStore((s) => s.sourceRef);

  const presetIssueQuery = searchParams.get("issue") ?? "";
  const autoStartFromSource = searchParams.get("autostart") === "1";
  const initialStage: GameStage =
    searchParams.get("stage") === "issue" ? "issue" : "paste";
  const [stage, setStage] = useState<GameStage>(initialStage);
  const [smsInput, setSmsInput] = useState("");
  const [nodes, setNodes] = useState<MarkupNode[]>([makeTextNode("")]);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [selectionHint, setSelectionHint] =
    useState<SelectionActionHint | null>(null);
  const [savedFormats, setSavedFormats] = useState<SavedFormatDraft[]>([]);
  const [bankName, setBankName] = useState("");
  const [sendersTemplate, setSendersTemplate] = useState("");
  const [isCreatingIssue, setIsCreatingIssue] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasTriedAutoImport, setHasTriedAutoImport] = useState(false);
  const [importedIssue, setImportedIssue] = useState<ImportedIssueData | null>(
    null
  );
  const [importBanks, setImportBanks] = useState<BankInfo[]>([]);
  const [importSourceSha, setImportSourceSha] = useState("");
  const [importTargetMode, setImportTargetMode] = useState<"existing" | "new">(
    "new"
  );
  const [selectedExistingBankPath, setSelectedExistingBankPath] = useState("");
  const [newImportBankName, setNewImportBankName] = useState("");
  const [isStartingFromIssue, setIsStartingFromIssue] = useState(false);

  const slotOrder = useMemo(() => getSlotOrder(nodes), [nodes]);
  const slotValues = useMemo(
    () =>
      nodes
        .filter((node): node is SlotNode => node.type === "slot")
        .map((node) => node.placeholder ?? ""),
    [nodes]
  );

  const placeholdersInTemplate = useMemo(
    () => extractPlaceholders(nodes),
    [nodes]
  );
  const templateForSave = useMemo(() => buildTemplate(nodes), [nodes]);
  const filledSlotCount = useMemo(
    () =>
      nodes.filter(
        (node): node is SlotNode =>
          node.type === "slot" && node.placeholder != null
      ).length,
    [nodes]
  );
  const totalSlotCount = slotOrder.length;
  const hasEmptySlots =
    totalSlotCount > 0 && filledSlotCount !== totalSlotCount;
  const canSaveDraft =
    templateForSave.trim().length > 0 && filledSlotCount > 0 && !hasEmptySlots;

  const activePickerGroupIndex = useMemo(() => {
    if (!pickerState) {
      return 1;
    }
    if (pickerState.mode === "selection") {
      return slotOrder.length + 1;
    }
    if (!pickerState.slotId) {
      return slotOrder.length + 1;
    }
    const slotIndex = slotOrder.indexOf(pickerState.slotId);
    return slotIndex >= 0 ? slotIndex + 1 : slotOrder.length + 1;
  }, [pickerState, slotOrder]);

  const currentPickerValue = useMemo(() => {
    if (!pickerState || pickerState.mode !== "slot" || !pickerState.slotId) {
      return "";
    }
    const slot = nodes.find(
      (node) => node.type === "slot" && node.id === pickerState.slotId
    );
    return slot?.type === "slot" ? (slot.placeholder ?? "") : "";
  }, [nodes, pickerState]);

  const startMarkup = () => {
    startMarkupSession({
      smsInput,
      setNodes,
      setPickerState,
      setSelectionHint,
      setIssueError,
      setStage,
    });
  };

  const setSlotPlaceholder = (slotId: string, placeholder: string | null) => {
    setNodes((prev) => setSlotPlaceholderInNodes(prev, slotId, placeholder));
  };

  const removeSlot = (slotId: string) => {
    setNodes((prev) => removeSlotFromNodes(prev, slotId));
  };

  const handleSurfaceMouseUp = () => {
    setSelectionHint(resolveSelectionHint(nodes));
  };

  const handlePickerSelect = (value: string) => {
    applyPickerSelection({
      pickerState,
      value,
      setNodes,
      setPickerState,
      setSelectionHint,
    });
  };

  const handleMarkSelection = () => {
    handleMarkSelectionAction({
      selectionHint,
      setPickerState,
      setSelectionHint,
    });
  };

  const openPickerForSlot = (slotId: string) => {
    setSelectionHint(null);
    setPickerState({ mode: "slot", slotId });
  };

  const handleChipDragStart = (e: React.DragEvent, slotId: string) => {
    e.dataTransfer.setData("text/plain", slotId);
  };

  const handleChipDragEnd = (e: React.DragEvent, slotId: string) => {
    handleChipDragEndAction({ event: e, slotId, setNodes });
  };

  const handleSurfaceDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const slotId = e.dataTransfer.getData("text/plain");
    const dragged = slotId ? document.getElementById(slotId) : null;
    if (dragged) {
      dragged.dataset.droppedInside = "true";
    }
  };

  const resetMarkupSurface = () => {
    setNodes([makeTextNode(smsInput)]);
    setPickerState(null);
    setSelectionHint(null);
  };

  const saveCurrentFormatAndGoBank = () => {
    saveCurrentDraftAndSwitchToBankStage({
      canSaveDraft,
      smsInput,
      templateForSave,
      placeholdersInTemplate,
      setSavedFormats,
      setSelectionHint,
      setStage,
    });
  };

  const addAnotherFormat = () => {
    setStage("paste");
    setSmsInput("");
    setNodes([makeTextNode("")]);
    setPickerState(null);
    setSelectionHint(null);
  };

  const updateFormatExample = (
    formatId: string,
    index: number,
    value: string
  ) => {
    setSavedFormats((prev) =>
      updateSavedFormatExample(prev, formatId, index, value)
    );
  };

  const addFormatExample = (formatId: string) => {
    setSavedFormats((prev) => addSavedFormatExample(prev, formatId));
  };

  const removeFormatExample = (formatId: string, index: number) => {
    setSavedFormats((prev) => removeSavedFormatExample(prev, formatId, index));
  };

  const goToIssueStage = () => {
    openIssueStageIfReady({
      bankName,
      savedFormats,
      setIssueError,
      setStage,
    });
  };

  const publishAsIssue = async () => {
    await publishIssueFromState({
      bankName,
      savedFormats,
      sendersTemplate,
      t,
      setIssueError,
      setIssueUrl,
      setIsCreatingIssue,
      invalidateStartableIssues: () =>
        queryClient.invalidateQueries({ queryKey: ["startable-issues"] }),
    });
  };

  const createWorkspaceFromIssueData = (
    issueData: ImportedIssueData,
    baseBanks: BankInfo[],
    sourceSha: string,
    target: ImportTarget
  ) => {
    const resolvedTarget = resolveBankTargetFromImport({
      issueData,
      baseBanks,
      target,
      draftStore,
      sourceSha,
    });
    const existingFormatPaths = collectExistingFormatPaths(
      resolvedTarget.existingBank,
      resolvedTarget.bankPath,
      draftStore
    );
    const createdFiles = createImportedFormatDrafts({
      issueData,
      bankPath: resolvedTarget.bankPath,
      sourceSha,
      existingFormatPaths,
      draftStore,
    });
    applyImportedFormatsToBanks({
      baseBanks,
      bankPath: resolvedTarget.bankPath,
      createdFiles,
      createdNewBank: resolvedTarget.createdNewBank,
      createdBankDisplayName: resolvedTarget.createdBankDisplayName,
    });
    navigateToImportedWorkspace(
      navigate,
      resolvedTarget.bankPath,
      createdFiles,
      repository,
      sourceRef
    );
  };

  const loadIssueForWorkspace = async () => {
    await loadIssueForWorkspaceState({
      presetIssueQuery,
      t,
      setImportError,
      setIsImportLoading,
      setImportedIssue,
      setImportBanks,
      setImportSourceSha,
      setImportTargetMode,
      setSelectedExistingBankPath,
      setNewImportBankName,
    });
  };

  useEffect(() => {
    const shouldAutoImport = shouldAutoImportIssue({
      stage,
      presetIssueQuery,
      autoStartFromSource,
      hasTriedAutoImport,
      isImportLoading,
    });
    if (!shouldAutoImport) {
      return;
    }

    setHasTriedAutoImport(true);
    void loadIssueForWorkspace();
  }, [
    stage,
    presetIssueQuery,
    hasTriedAutoImport,
    isImportLoading,
    autoStartFromSource,
    loadIssueForWorkspace,
  ]);

  const startWorkFromImportedIssue = async () => {
    await startWorkFromImportedIssueState({
      importedIssue,
      importSourceSha,
      importTargetMode,
      selectedExistingBankPath,
      newImportBankName,
      importBanks,
      t,
      setImportError,
      setIsStartingFromIssue,
      createWorkspaceFromIssueData,
    });
  };

  return (
    <SmsMarkupGameLayout
      activePickerGroupIndex={activePickerGroupIndex}
      addAnotherFormat={addAnotherFormat}
      addFormatExample={addFormatExample}
      bankName={bankName}
      canSaveDraft={canSaveDraft}
      currentPickerValue={currentPickerValue}
      filledSlotCount={filledSlotCount}
      goToIssueStage={goToIssueStage}
      handleChipDragEnd={handleChipDragEnd}
      handleChipDragStart={handleChipDragStart}
      handleMarkSelection={handleMarkSelection}
      handlePickerSelect={handlePickerSelect}
      handleSurfaceDrop={handleSurfaceDrop}
      handleSurfaceMouseUp={handleSurfaceMouseUp}
      hasEmptySlots={hasEmptySlots}
      importBanks={importBanks}
      importError={importError}
      importedIssue={importedIssue}
      importTargetMode={importTargetMode}
      isCreatingIssue={isCreatingIssue}
      isImportLoading={isImportLoading}
      isStartingFromIssue={isStartingFromIssue}
      issueError={issueError}
      issueUrl={issueUrl}
      lang={lang}
      newImportBankName={newImportBankName}
      nodes={nodes}
      openPickerForSlot={openPickerForSlot}
      pickerState={pickerState}
      presetIssueQuery={presetIssueQuery}
      publishAsIssue={publishAsIssue}
      removeFormatExample={removeFormatExample}
      removeSlot={removeSlot}
      resetMarkupSurface={resetMarkupSurface}
      saveCurrentFormatAndGoBank={saveCurrentFormatAndGoBank}
      savedFormats={savedFormats}
      selectedExistingBankPath={selectedExistingBankPath}
      selectionHint={selectionHint}
      sendersTemplate={sendersTemplate}
      setBankName={setBankName}
      setImportTargetMode={setImportTargetMode}
      setNewImportBankName={setNewImportBankName}
      setSelectedExistingBankPath={setSelectedExistingBankPath}
      setSelectionHint={setSelectionHint}
      setSendersTemplate={setSendersTemplate}
      setSlotPlaceholder={setSlotPlaceholder}
      setSmsInput={setSmsInput}
      setStage={setStage}
      slotValues={slotValues}
      smsInput={smsInput}
      stage={stage}
      startMarkup={startMarkup}
      startWorkFromImportedIssue={startWorkFromImportedIssue}
      t={t}
      totalSlotCount={totalSlotCount}
      updateFormatExample={updateFormatExample}
    />
  );
}

interface SmsMarkupGameLayoutProps {
  activePickerGroupIndex: number;
  addAnotherFormat: () => void;
  addFormatExample: (formatId: string) => void;
  bankName: string;
  canSaveDraft: boolean;
  currentPickerValue: string;
  filledSlotCount: number;
  goToIssueStage: () => void;
  handleChipDragEnd: (event: React.DragEvent, slotId: string) => void;
  handleChipDragStart: (event: React.DragEvent, slotId: string) => void;
  handleMarkSelection: () => void;
  handlePickerSelect: (value: string) => void;
  handleSurfaceDrop: (event: React.DragEvent) => void;
  handleSurfaceMouseUp: () => void;
  hasEmptySlots: boolean;
  importBanks: BankInfo[];
  importedIssue: ImportedIssueData | null;
  importError: string | null;
  importTargetMode: "existing" | "new";
  isCreatingIssue: boolean;
  isImportLoading: boolean;
  isStartingFromIssue: boolean;
  issueError: string | null;
  issueUrl: string | null;
  lang: "ru" | "en";
  newImportBankName: string;
  nodes: MarkupNode[];
  openPickerForSlot: (slotId: string) => void;
  pickerState: PickerState | null;
  presetIssueQuery: string;
  publishAsIssue: () => Promise<void>;
  removeFormatExample: (formatId: string, index: number) => void;
  removeSlot: (slotId: string) => void;
  resetMarkupSurface: () => void;
  saveCurrentFormatAndGoBank: () => void;
  savedFormats: SavedFormatDraft[];
  selectedExistingBankPath: string;
  selectionHint: SelectionActionHint | null;
  sendersTemplate: string;
  setBankName: (value: string) => void;
  setImportTargetMode: (value: "existing" | "new") => void;
  setNewImportBankName: (value: string) => void;
  setSelectedExistingBankPath: (value: string) => void;
  setSelectionHint: (value: SelectionActionHint | null) => void;
  setSendersTemplate: (value: string) => void;
  setSlotPlaceholder: (slotId: string, placeholder: string | null) => void;
  setSmsInput: (value: string) => void;
  setStage: (stage: GameStage) => void;
  slotValues: string[];
  smsInput: string;
  stage: GameStage;
  startMarkup: () => void;
  startWorkFromImportedIssue: () => Promise<void>;
  t: Translator;
  totalSlotCount: number;
  updateFormatExample: (formatId: string, index: number, value: string) => void;
}

function SmsMarkupGameLayout(props: SmsMarkupGameLayoutProps) {
  const {
    stage,
    setStage,
    t,
    pickerState,
    currentPickerValue,
    activePickerGroupIndex,
  } = props;
  const {
    slotValues,
    lang,
    setSelectionHint,
    handlePickerSelect,
    selectionHint,
  } = props;
  const { handleMarkSelection } = props;

  return (
    <div className="sms-game">
      <div className="sms-game__header">
        <div>
          <h2>{t("smsGame.title")}</h2>
          <p className="text-muted">{t("smsGame.subtitle")}</p>
        </div>
      </div>

      <SmsGameStageTabs setStage={setStage} stage={stage} t={t} />
      <SmsGameStageContent {...props} />

      {pickerState && (
        <ColumnPickerModal
          currentValue={currentPickerValue}
          groupIndex={activePickerGroupIndex}
          lang={lang}
          onClose={() => setSelectionHint(null)}
          onSelectColumn={handlePickerSelect}
          selectedColumns={slotValues}
          selectionText={pickerState.selection?.text ?? null}
        />
      )}

      {stage === "markup" && selectionHint && !pickerState && (
        <button
          className="sms-game__selection-action"
          onClick={handleMarkSelection}
          onMouseDown={(event) => event.preventDefault()}
          style={{ top: selectionHint.top, left: selectionHint.left }}
          type="button"
        >
          {t("smsGame.markSelection")}
        </button>
      )}
    </div>
  );
}

interface SmsGameStageTabsProps {
  setStage: (stage: GameStage) => void;
  stage: GameStage;
  t: Translator;
}

function SmsGameStageTabs({ setStage, stage, t }: SmsGameStageTabsProps) {
  return (
    <div className="sms-game__stage">
      {(
        [
          ["paste", t("smsGame.stagePaste")],
          ["markup", t("smsGame.stageMarkup")],
          ["bank", t("smsGame.stageBank")],
          ["issue", t("smsGame.stageIssue")],
        ] as [GameStage, string][]
      ).map(([nextStage, label]) => (
        <button
          className={`sms-game__stage-tab ${stage === nextStage ? "sms-game__stage-tab--active" : ""}`}
          key={nextStage}
          onClick={() => setStage(nextStage)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SmsGameStageContent(props: SmsMarkupGameLayoutProps) {
  const { stage } = props;
  if (stage === "paste") {
    return <SmsGamePasteStage {...props} />;
  }
  if (stage === "markup") {
    return <SmsGameMarkupStage {...props} />;
  }
  if (stage === "bank") {
    return <SmsGameBankStage {...props} />;
  }
  return <SmsGameIssueStage {...props} />;
}

function SmsGamePasteStage(props: SmsMarkupGameLayoutProps) {
  const { smsInput, setSmsInput, startMarkup, t } = props;
  return (
    <div className="grid-2 sms-game__grid">
      <div className="panel">
        <div className="panel__header">{t("smsGame.pasteSms")}</div>
        <div className="panel__body flex-col gap-md">
          <textarea
            className="textarea sms-game__sms-input"
            onChange={(event) => setSmsInput(event.target.value)}
            placeholder={t("smsGame.smsPlaceholder")}
            value={smsInput}
          />
          <button
            className="btn btn--primary"
            disabled={!smsInput.trim()}
            onClick={startMarkup}
          >
            {t("smsGame.startMarkup")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SmsGameMarkupNodeProps {
  handleChipDragEnd: (event: React.DragEvent, slotId: string) => void;
  handleChipDragStart: (event: React.DragEvent, slotId: string) => void;
  node: MarkupNode;
  openPickerForSlot: (slotId: string) => void;
  removeSlot: (slotId: string) => void;
  setSlotPlaceholder: (slotId: string, placeholder: string | null) => void;
  t: Translator;
}

function SmsGameMarkupNode({
  handleChipDragEnd,
  handleChipDragStart,
  node,
  openPickerForSlot,
  removeSlot,
  setSlotPlaceholder,
  t,
}: SmsGameMarkupNodeProps) {
  if (node.type === "text") {
    return (
      <span
        className="sms-game__surface-text"
        data-node-id={node.id}
        data-node-type="text"
        key={node.id}
      >
        {node.text}
      </span>
    );
  }

  if (!node.placeholder) {
    return (
      <span className="sms-game__slot-empty-wrap" key={node.id}>
        <button
          className="sms-game__slot-empty"
          onClick={() => openPickerForSlot(node.id)}
          title={node.selectedText}
          type="button"
        >
          {t("smsGame.emptySlot")}
        </button>
        <button
          aria-label={t("smsGame.deleteChip")}
          className="sms-game__chip-remove sms-game__chip-remove--empty"
          onClick={(event) => {
            event.stopPropagation();
            removeSlot(node.id);
          }}
          title={t("smsGame.deleteChip")}
          type="button"
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <span className="sms-game__slot-chip-wrap" key={node.id}>
      <button
        className="sms-game__chip-main"
        data-dropped-inside="false"
        draggable
        id={node.id}
        onClick={() => openPickerForSlot(node.id)}
        onDragEnd={(event) => handleChipDragEnd(event, node.id)}
        onDragStart={(event) => handleChipDragStart(event, node.id)}
        title={t("smsGame.changePlaceholder")}
        type="button"
      >
        {`\${${node.placeholder}}`}
      </button>
      <button
        aria-label={t("smsGame.deleteChip")}
        className="sms-game__chip-remove"
        onClick={(event) => {
          event.stopPropagation();
          setSlotPlaceholder(node.id, null);
        }}
        title={t("smsGame.deleteChip")}
        type="button"
      >
        ×
      </button>
    </span>
  );
}

function SmsGameMarkupStage(props: SmsMarkupGameLayoutProps) {
  const {
    t,
    filledSlotCount,
    totalSlotCount,
    resetMarkupSurface,
    handleSurfaceDrop,
    setSelectionHint,
    handleSurfaceMouseUp,
    nodes,
    openPickerForSlot,
    removeSlot,
    handleChipDragEnd,
    handleChipDragStart,
    setSlotPlaceholder,
    canSaveDraft,
    hasEmptySlots,
    saveCurrentFormatAndGoBank,
  } = props;

  return (
    <div className="panel sms-game__single-window">
      <div className="panel__header">{t("smsGame.markupWorkspace")}</div>
      <div className="panel__body flex-col gap-md">
        <ol className="sms-game__instructions-list">
          <li>{t("smsGame.markupStep1")}</li>
          <li>{t("smsGame.markupStep2")}</li>
          <li>{t("smsGame.markupStep3")}</li>
          <li>{t("smsGame.markupStep4")}</li>
        </ol>

        <div className="sms-game__hint-line">
          <span className="badge badge--info">
            {t("smsGame.filledSlots", {
              filled: filledSlotCount,
              total: totalSlotCount,
            })}
          </span>
          <span className="text-muted text-sm">{t("smsGame.dragOutHint")}</span>
          <button className="btn btn--sm" onClick={resetMarkupSurface}>
            {t("smsGame.resetTemplate")}
          </button>
        </div>

        <div
          className="sms-game__markup-surface"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleSurfaceDrop}
          onMouseDown={() => setSelectionHint(null)}
          onMouseUp={handleSurfaceMouseUp}
        >
          {nodes.map((node) => (
            <SmsGameMarkupNode
              handleChipDragEnd={handleChipDragEnd}
              handleChipDragStart={handleChipDragStart}
              key={node.id}
              node={node}
              openPickerForSlot={openPickerForSlot}
              removeSlot={removeSlot}
              setSlotPlaceholder={setSlotPlaceholder}
              t={t}
            />
          ))}
        </div>

        <div className="sms-game__hint-line">
          {!canSaveDraft && hasEmptySlots && (
            <div className="badge badge--warning">
              {t("smsGame.saveBlockedByEmptySlots")}
            </div>
          )}
          <button
            className="btn btn--primary"
            disabled={!canSaveDraft}
            onClick={saveCurrentFormatAndGoBank}
          >
            {t("smsGame.saveAndGoBank")}
          </button>
        </div>
      </div>
    </div>
  );
}

function templatePartClassName(part: TemplatePart): string {
  return part.type === "placeholder" ? "sms-game__chip" : "sms-game__text";
}

function templatePartValue(part: TemplatePart): string {
  if (part.type === "placeholder") {
    return `\${${part.value}}`;
  }
  return part.value;
}

interface SmsGameSavedFormatItemProps {
  addFormatExample: (formatId: string) => void;
  format: SavedFormatDraft;
  index: number;
  removeFormatExample: (formatId: string, index: number) => void;
  t: Translator;
  updateFormatExample: (formatId: string, index: number, value: string) => void;
}

function SmsGameSavedFormatItem({
  addFormatExample,
  format,
  index,
  removeFormatExample,
  t,
  updateFormatExample,
}: SmsGameSavedFormatItemProps) {
  return (
    <div className="sms-game__saved-item">
      <div className="flex items-center gap-sm">
        <span className="badge badge--info">#{index + 1}</span>
      </div>
      <div className="sms-game__preview">
        {splitTemplate(format.template).map((part, partIndex) => (
          <span
            className={templatePartClassName(part)}
            key={`${part.type}-${partIndex}-${part.value}`}
          >
            {templatePartValue(part)}
          </span>
        ))}
      </div>
      <div className="sms-game__chips-row">
        {format.placeholders.map((placeholder) => (
          <span className="sms-game__chip" key={`${format.id}-${placeholder}`}>
            {placeholder}
          </span>
        ))}
      </div>
      <details>
        <summary className="text-sm">{t("smsGame.showOriginal")}</summary>
        <pre className="sms-game__raw">{format.sourceSms}</pre>
      </details>
      <div className="sms-game__examples-edit">
        <div className="text-muted text-sm">{t("smsGame.similarExamples")}</div>
        {format.similarExamples.map((example, exampleIndex) => (
          <div
            className="sms-game__example-row"
            key={`${format.id}-${exampleIndex}`}
          >
            <textarea
              aria-label={t("smsGame.similarExamples")}
              className="textarea"
              onChange={(event) =>
                updateFormatExample(format.id, exampleIndex, event.target.value)
              }
              placeholder={t("smsGame.similarExamplePlaceholder")}
              value={example}
            />
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => removeFormatExample(format.id, exampleIndex)}
            >
              {t("editor.removeExample")}
            </button>
          </div>
        ))}
        <button
          className="btn btn--sm"
          onClick={() => addFormatExample(format.id)}
        >
          + {t("editor.addExample")}
        </button>
      </div>
    </div>
  );
}

function SmsGameBankStage(props: SmsMarkupGameLayoutProps) {
  const {
    addAnotherFormat,
    addFormatExample,
    bankName,
    goToIssueStage,
    removeFormatExample,
    savedFormats,
    sendersTemplate,
    setBankName,
    setSendersTemplate,
    t,
    updateFormatExample,
  } = props;

  return (
    <div className="grid-2 sms-game__grid">
      <div className="panel">
        <div className="panel__header">{t("smsGame.bankTitle")}</div>
        <div className="panel__body flex-col gap-md">
          <label className="font-medium text-sm">
            {t("smsGame.bankInputLabel")}
          </label>
          <input
            aria-label={t("smsGame.bankInputLabel")}
            className="input"
            onChange={(event) => setBankName(event.target.value)}
            placeholder={t("smsGame.bankInputPlaceholder")}
            value={bankName}
          />
          <p className="text-muted text-sm">{t("smsGame.bankHint")}</p>
          <label className="font-medium text-sm">
            {t("smsGame.sendersInputLabel")}
          </label>
          <textarea
            aria-label={t("smsGame.sendersInputLabel")}
            className="textarea"
            onChange={(event) => setSendersTemplate(event.target.value)}
            placeholder={t("smsGame.sendersInputPlaceholder")}
            value={sendersTemplate}
          />
          <p className="text-muted text-sm">{t("smsGame.sendersHint")}</p>
          <div className="sms-game__bank-actions">
            <button className="btn" onClick={addAnotherFormat}>
              {t("smsGame.addAnotherFormat")}
            </button>
            <button
              className="btn btn--primary"
              disabled={!bankName.trim() || savedFormats.length === 0}
              onClick={goToIssueStage}
            >
              {t("smsGame.goToIssue")}
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">
          {t("smsGame.savedFormats")} · {savedFormats.length}
        </div>
        <div className="panel__body sms-game__saved-list flex-col gap-md">
          {savedFormats.map((format, index) => (
            <SmsGameSavedFormatItem
              addFormatExample={addFormatExample}
              format={format}
              index={index}
              key={format.id}
              removeFormatExample={removeFormatExample}
              t={t}
              updateFormatExample={updateFormatExample}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface SmsGameIssueImportPanelProps {
  importBanks: BankInfo[];
  importedIssue: ImportedIssueData | null;
  importError: string | null;
  importTargetMode: "existing" | "new";
  isImportLoading: boolean;
  isStartingFromIssue: boolean;
  newImportBankName: string;
  selectedExistingBankPath: string;
  setImportTargetMode: (value: "existing" | "new") => void;
  setNewImportBankName: (value: string) => void;
  setSelectedExistingBankPath: (value: string) => void;
  startWorkFromImportedIssue: () => Promise<void>;
  t: Translator;
}

function SmsGameIssueImportPanel({
  importBanks,
  importedIssue,
  importError,
  importTargetMode,
  isImportLoading,
  isStartingFromIssue,
  newImportBankName,
  selectedExistingBankPath,
  setImportTargetMode,
  setNewImportBankName,
  setSelectedExistingBankPath,
  startWorkFromImportedIssue,
  t,
}: SmsGameIssueImportPanelProps) {
  return (
    <>
      <div className="text-muted text-sm">{t("smsGame.importTargetHint")}</div>
      {isImportLoading && (
        <div className="flex items-center gap-sm">
          <span className="spinner" />
          <span>{t("app.loading")}</span>
        </div>
      )}
      {importError && (
        <div className="issue-item issue-item--error">{importError}</div>
      )}
      {importedIssue && (
        <>
          <div className="issue-item issue-item--success flex-col">
            <div className="font-medium">
              {t("smsGame.importIssueLoaded", {
                number: importedIssue.issueNumber,
              })}
            </div>
            <div className="text-sm">{importedIssue.issueTitle}</div>
            <div className="text-sm">
              {t("smsGame.importTargetIssueBankHint", {
                bank: importedIssue.bankName,
              })}
            </div>
            <a href={importedIssue.issueUrl} rel="noreferrer" target="_blank">
              {importedIssue.issueUrl}
            </a>
            <div className="text-sm">
              {t("smsGame.importIssueFormats", {
                count: importedIssue.formats.length,
              })}
            </div>
          </div>

          <label className="font-medium text-sm">
            {t("smsGame.importTargetModeLabel")}
          </label>
          <label className="flex items-center gap-sm text-sm">
            <input
              checked={importTargetMode === "existing"}
              name="import-target-mode"
              onChange={() => setImportTargetMode("existing")}
              type="radio"
            />
            {t("smsGame.importTargetExisting")}
          </label>
          {importTargetMode === "existing" && (
            <>
              <label className="font-medium text-sm">
                {t("smsGame.importTargetExistingLabel")}
              </label>
              <select
                aria-label={t("smsGame.importTargetExistingLabel")}
                className="input"
                disabled={importBanks.length === 0}
                onChange={(event) =>
                  setSelectedExistingBankPath(event.target.value)
                }
                value={selectedExistingBankPath}
              >
                {importBanks.map((bank) => (
                  <option key={bank.folderPath} value={bank.folderPath}>
                    {bank.displayName}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="flex items-center gap-sm text-sm">
            <input
              checked={importTargetMode === "new"}
              name="import-target-mode"
              onChange={() => setImportTargetMode("new")}
              type="radio"
            />
            {t("smsGame.importTargetNew")}
          </label>
          {importTargetMode === "new" && (
            <>
              <label className="font-medium text-sm">
                {t("smsGame.importTargetNewLabel")}
              </label>
              <input
                aria-label={t("smsGame.importTargetNewLabel")}
                className="input"
                onChange={(event) => setNewImportBankName(event.target.value)}
                placeholder={t("smsGame.bankInputPlaceholder")}
                value={newImportBankName}
              />
            </>
          )}

          <div className="sms-game__bank-actions">
            <button
              className="btn btn--primary"
              disabled={isStartingFromIssue}
              onClick={() => void startWorkFromImportedIssue()}
            >
              {isStartingFromIssue
                ? t("app.loading")
                : t("smsGame.importTargetStart")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

interface SmsGameIssuePublishPanelProps {
  bankName: string;
  isCreatingIssue: boolean;
  issueError: string | null;
  issueUrl: string | null;
  publishAsIssue: () => Promise<void>;
  savedFormats: SavedFormatDraft[];
  t: Translator;
}

function SmsGameIssuePublishPanel({
  bankName,
  isCreatingIssue,
  issueError,
  issueUrl,
  publishAsIssue,
  savedFormats,
  t,
}: SmsGameIssuePublishPanelProps) {
  return (
    <>
      <div className="text-muted text-sm">
        {t("smsGame.issueRepo", {
          owner: config.defaultSourceOwner,
          repo: config.defaultSourceRepo,
        })}
      </div>
      <div className="text-muted text-sm">{t("smsGame.issueTokenEnvHint")}</div>
      {!config.issueToken.trim() && (
        <div className="issue-item issue-item--warning">
          {t("smsGame.issueTokenMissingEnv")}
        </div>
      )}
      {issueError && (
        <div className="issue-item issue-item--error">{issueError}</div>
      )}
      {issueUrl && (
        <div className="issue-item issue-item--success">
          <a href={issueUrl} rel="noreferrer" target="_blank">
            {issueUrl}
          </a>
        </div>
      )}
      <div className="sms-game__bank-actions">
        <button
          className="btn btn--primary"
          disabled={
            isCreatingIssue ||
            !config.issueToken.trim() ||
            !bankName.trim() ||
            savedFormats.length === 0
          }
          onClick={publishAsIssue}
        >
          {isCreatingIssue
            ? t("smsGame.issueCreating")
            : t("smsGame.createIssue")}
        </button>
      </div>
    </>
  );
}

interface SmsGameIssuePreviewProps {
  bankName: string;
  importedIssue: ImportedIssueData | null;
  presetIssueQuery: string;
  savedFormats: SavedFormatDraft[];
  sendersTemplate: string;
}

function resolveIssuePreviewBody(props: SmsGameIssuePreviewProps): string {
  const {
    bankName,
    importedIssue,
    presetIssueQuery,
    savedFormats,
    sendersTemplate,
  } = props;
  if (presetIssueQuery) {
    if (!importedIssue) {
      return "—";
    }
    return buildIssueBody(
      importedIssue.bankName,
      importedIssue.formats,
      importedIssue.senders
    );
  }
  return buildIssueBody(
    bankName.trim() || "Unknown bank",
    savedFormats,
    sendersTemplate
  );
}

function SmsGameIssuePreview(
  props: SmsGameIssuePreviewProps & { t: Translator }
) {
  const { t } = props;
  return (
    <div className="panel">
      <div className="panel__header">{t("smsGame.issuePreview")}</div>
      <div className="panel__body">
        <pre className="sms-game__issue-preview">
          {resolveIssuePreviewBody(props)}
        </pre>
      </div>
    </div>
  );
}

function SmsGameIssueStage(props: SmsMarkupGameLayoutProps) {
  const {
    bankName,
    importBanks,
    importedIssue,
    importError,
    importTargetMode,
    isCreatingIssue,
    isImportLoading,
    isStartingFromIssue,
    issueError,
    issueUrl,
    newImportBankName,
    presetIssueQuery,
    publishAsIssue,
    savedFormats,
    selectedExistingBankPath,
    sendersTemplate,
    setImportTargetMode,
    setNewImportBankName,
    setSelectedExistingBankPath,
    startWorkFromImportedIssue,
    t,
  } = props;

  return (
    <div className="grid-2 sms-game__grid">
      <div className="panel">
        <div className="panel__header">{t("smsGame.issueTitle")}</div>
        <div className="panel__body flex-col gap-md">
          {presetIssueQuery ? (
            <SmsGameIssueImportPanel
              importBanks={importBanks}
              importError={importError}
              importedIssue={importedIssue}
              importTargetMode={importTargetMode}
              isImportLoading={isImportLoading}
              isStartingFromIssue={isStartingFromIssue}
              newImportBankName={newImportBankName}
              selectedExistingBankPath={selectedExistingBankPath}
              setImportTargetMode={setImportTargetMode}
              setNewImportBankName={setNewImportBankName}
              setSelectedExistingBankPath={setSelectedExistingBankPath}
              startWorkFromImportedIssue={startWorkFromImportedIssue}
              t={t}
            />
          ) : (
            <SmsGameIssuePublishPanel
              bankName={bankName}
              isCreatingIssue={isCreatingIssue}
              issueError={issueError}
              issueUrl={issueUrl}
              publishAsIssue={publishAsIssue}
              savedFormats={savedFormats}
              t={t}
            />
          )}
        </div>
      </div>
      <SmsGameIssuePreview
        bankName={bankName}
        importedIssue={importedIssue}
        presetIssueQuery={presetIssueQuery}
        savedFormats={savedFormats}
        sendersTemplate={sendersTemplate}
        t={t}
      />
    </div>
  );
}

function ColumnPickerModal({
  groupIndex,
  selectionText,
  selectedColumns,
  currentValue,
  lang,
  onClose,
  onSelectColumn,
}: {
  groupIndex: number;
  selectionText: string | null;
  selectedColumns: string[];
  currentValue: string;
  lang: "ru" | "en";
  onClose: () => void;
  onSelectColumn: (columnName: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const titleId = useId();

  const currentBaseName = toComparableBase(currentValue);
  const usedBaseNames = useMemo(() => {
    const set = new Set<string>();
    selectedColumns.forEach((column) => {
      const base = toComparableBase(column);
      if (base && base !== currentBaseName) {
        set.add(base);
      }
    });
    return set;
  }, [currentBaseName, selectedColumns]);

  const filteredColumns = useMemo(() => {
    if (!search.trim()) {
      return ALLOWED_COLUMNS_SORTED;
    }
    const query = search.toLowerCase();
    return ALLOWED_COLUMNS_SORTED.filter((column) => {
      const description =
        column.description[lang]?.toLowerCase() ??
        column.description.en.toLowerCase();
      return (
        column.name.toLowerCase().includes(query) || description.includes(query)
      );
    });
  }, [lang, search]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal regex-column-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="modal__title" id={titleId}>
          {t("columns.selectForGroup", { index: groupIndex })}
        </div>
        {selectionText && (
          <div className="badge badge--info sms-game__selection-badge">
            {t("smsGame.selectionPrompt", { text: selectionText })}
          </div>
        )}
        <input
          autoFocus
          className="input"
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("columns.search")}
          value={search}
        />
        <div className="regex-column-modal__list">
          {filteredColumns.map((column) => {
            const optionBase = toComparableBase(column.name);
            const isUsedByOtherGroup = usedBaseNames.has(optionBase);
            const isCurrent = optionBase === currentBaseName;
            const isDisabled = isUsedByOtherGroup && !isCurrent;

            const value = column.parameterized
              ? `${column.name}#${column.paramHint ?? ""}`
              : column.name;

            return (
              <button
                className={`regex-column-modal__item ${isCurrent ? "regex-column-modal__item--selected" : ""}`.trim()}
                disabled={isDisabled}
                key={column.name}
                onClick={() => onSelectColumn(value)}
                type="button"
              >
                <span className="font-medium text-mono">
                  {SPECIAL_PLACEHOLDERS.get(column.name.toLowerCase()) ??
                    column.name}
                </span>
                <span className="text-muted text-sm">
                  {column.description[lang] ?? column.description.en}
                </span>
                {column.parameterized &&
                  !SPECIAL_PLACEHOLDERS.has(column.name.toLowerCase()) && (
                    <span className="badge badge--info text-sm">
                      {t("columns.param")}
                    </span>
                  )}
                {isDisabled && (
                  <span className="badge badge--warning text-sm">
                    {t("columns.alreadyUsed")}
                  </span>
                )}
              </button>
            );
          })}
          {filteredColumns.length === 0 && (
            <div className="p-md text-muted text-sm">—</div>
          )}
        </div>
        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
