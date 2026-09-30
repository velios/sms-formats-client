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
    "cursor-pointer rounded-full border px-2 py-1 font-semibold text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isActive
      ? "border-primary bg-primary-soft text-primary"
      : "border-border bg-card text-muted-foreground hover:text-primary"
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
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b px-2 py-2">
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
          <div className="p-2 text-muted-foreground text-sm">
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
