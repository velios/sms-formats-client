import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { REGEX_SNIPPETS } from "@/content/snippets.generated";
import { cn } from "@/lib/utils";
import {
  filterSnippets,
  groupSnippets,
  type RegexSnippet,
  type SnippetGroup,
} from "./schema";

interface Props {
  onClose: () => void;
  onInsert: (pattern: string) => void;
}

const ALL_GROUPS = "all" as const;
type GroupFilter = SnippetGroup | typeof ALL_GROUPS;

export function SnippetLibraryModal({ onClose, onInsert }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<GroupFilter>(ALL_GROUPS);

  const searchFiltered = useMemo(
    () => filterSnippets(REGEX_SNIPPETS, search),
    [search]
  );
  const groups = useMemo(() => groupSnippets(searchFiltered), [searchFiltered]);
  const visibleSnippets = useMemo(
    () =>
      activeGroup === ALL_GROUPS
        ? searchFiltered
        : searchFiltered.filter((snippet) => snippet.group === activeGroup),
    [activeGroup, searchFiltered]
  );

  const handleInsert = (pattern: string) => {
    onInsert(pattern);
    onClose();
  };

  return (
    <ModalDialog
      className="flex h-[calc(100vh-40px)] flex-col sm:max-w-[900px]"
      onClose={onClose}
      title={t("snippets.title")}
      titleId={titleId}
    >
      <Input
        autoFocus
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("snippets.search")}
        value={search}
      />
      <div className="mt-3 flex min-h-0 flex-1 gap-3">
        <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--c-border)] p-1">
          <GroupButton
            count={searchFiltered.length}
            isActive={activeGroup === ALL_GROUPS}
            label={t("snippets.allGroups")}
            onClick={() => setActiveGroup(ALL_GROUPS)}
          />
          {groups.map(({ group, snippets }) => (
            <GroupButton
              count={snippets.length}
              isActive={activeGroup === group}
              key={group}
              label={t(`snippets.groups.${group}`)}
              onClick={() => setActiveGroup(group)}
            />
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {visibleSnippets.length === 0 ? (
            <div className="p-4 text-[color:var(--c-text-muted)] text-sm">
              {t("snippets.empty")}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleSnippets.map((snippet) => (
                <SnippetCard
                  key={snippet.id}
                  onInsert={handleInsert}
                  snippet={snippet}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose} type="button">
          {t("app.close")}
        </Button>
      </div>
    </ModalDialog>
  );
}

function GroupButton({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm transition-colors",
        isActive
          ? "bg-[color:var(--c-accent-soft)] text-[color:var(--c-accent)]"
          : "text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-bg-hover)]"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="truncate">{label}</span>
      <span className="ml-2 shrink-0 text-[color:var(--c-text-dim)] text-xs">
        {count}
      </span>
    </button>
  );
}

function SnippetCard({
  snippet,
  onInsert,
}: {
  snippet: RegexSnippet;
  onInsert: (pattern: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] p-3">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-[3px] bg-[color:var(--c-bg-input)] px-2 py-1 font-mono text-[13px] text-[color:var(--c-text)]">
          {snippet.pattern}
        </code>
        <StatusBadge
          className="shrink-0 text-xs"
          variant={snippet.kind === "default" ? "success" : "info"}
        >
          {t(`snippets.kind.${snippet.kind}`)}
        </StatusBadge>
        <Button
          className="shrink-0"
          onClick={() => onInsert(snippet.pattern)}
          size="sm"
          type="button"
        >
          {t("snippets.insert")}
        </Button>
      </div>
      <p className="mt-2 text-[color:var(--c-text)] text-sm">{snippet.desc}</p>
      {snippet.trigger && (
        <SnippetField label={t("snippets.trigger")} value={snippet.trigger} />
      )}
      {snippet.example && (
        <SnippetField
          label={t("snippets.example")}
          mono
          value={snippet.example}
        />
      )}
      {snippet.gotcha && (
        <SnippetField label={t("snippets.gotcha")} value={snippet.gotcha} />
      )}
    </div>
  );
}

function SnippetField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <p className="mt-1.5 text-[color:var(--c-text-muted)] text-xs">
      <span className="font-semibold text-[color:var(--c-text-dim)]">
        {label}:{" "}
      </span>
      <span className={cn(mono && "font-mono")}>{value}</span>
    </p>
  );
}
