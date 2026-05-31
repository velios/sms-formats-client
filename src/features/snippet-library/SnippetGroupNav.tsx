import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { RegexSnippet, SnippetGroup } from "./schema";

export const ALL_GROUPS = "all" as const;
export type GroupFilter = SnippetGroup | typeof ALL_GROUPS;

export function SnippetGroupNav({
  groups,
  totalCount,
  activeGroup,
  onSelect,
  className,
}: {
  groups: Array<{ group: SnippetGroup; snippets: RegexSnippet[] }>;
  totalCount: number;
  activeGroup: GroupFilter;
  onSelect: (group: GroupFilter) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <nav
      className={cn(
        "flex flex-col gap-0.5 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--c-border)] p-1",
        className
      )}
    >
      <GroupButton
        count={totalCount}
        isActive={activeGroup === ALL_GROUPS}
        label={t("snippets.allGroups")}
        onClick={() => onSelect(ALL_GROUPS)}
      />
      {groups.map(({ group, snippets }) => (
        <GroupButton
          count={snippets.length}
          isActive={activeGroup === group}
          key={group}
          label={t(`snippets.groups.${group}`)}
          onClick={() => onSelect(group)}
        />
      ))}
    </nav>
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
