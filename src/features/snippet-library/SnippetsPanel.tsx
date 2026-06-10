import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { REGEX_SNIPPETS } from "@/content/snippets.generated";
import { cn } from "@/lib/utils";
import { SnippetCard } from "./SnippetCard";
import { groupSnippets, type SnippetGroup } from "./schema";

const ALL_GROUPS = "all" as const;
type GroupFilter = SnippetGroup | typeof ALL_GROUPS;

interface Props {
  onInsert: (pattern: string) => void;
}

const groupPillClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer rounded-full border px-2.5 py-[3px] font-semibold text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)]",
    isActive
      ? "border-[color:var(--c-accent)] bg-[color:var(--c-accent-soft)] text-[color:var(--c-accent)]"
      : "border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-accent)]"
  );

export function SnippetsPanel({ onInsert }: Props) {
  const { t } = useTranslation();
  const [activeGroup, setActiveGroup] = useState<GroupFilter>(ALL_GROUPS);

  const groups = useMemo(() => groupSnippets(REGEX_SNIPPETS), []);
  const visibleSnippets =
    activeGroup === ALL_GROUPS
      ? REGEX_SNIPPETS
      : REGEX_SNIPPETS.filter((snippet) => snippet.group === activeGroup);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-[color:var(--c-border)] border-b px-2.5 py-2">
        <button
          className={groupPillClassName(activeGroup === ALL_GROUPS)}
          onClick={() => setActiveGroup(ALL_GROUPS)}
          type="button"
        >
          {t("snippets.allGroups")}
        </button>
        {groups.map(({ group }) => (
          <button
            className={groupPillClassName(activeGroup === group)}
            key={group}
            onClick={() => setActiveGroup(group)}
            type="button"
          >
            {t(`snippets.groups.${group}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visibleSnippets.length === 0 ? (
          <div className="p-2 text-[color:var(--c-text-muted)] text-sm">
            {t("snippets.empty")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleSnippets.map((snippet) => (
              <SnippetCard
                key={snippet.id}
                onInsert={onInsert}
                snippet={snippet}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
