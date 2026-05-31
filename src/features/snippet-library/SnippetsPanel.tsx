import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { REGEX_SNIPPETS } from "@/content/snippets.generated";
import { SnippetCard } from "./SnippetCard";
import {
  ALL_GROUPS,
  type GroupFilter,
  SnippetGroupNav,
} from "./SnippetGroupNav";
import { filterSnippets, groupSnippets } from "./schema";

interface Props {
  onInsert: (pattern: string) => void;
}

export function SnippetsPanel({ onInsert }: Props) {
  const { t } = useTranslation();
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

  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-[color:var(--c-border)] border-b p-2">
        <Input
          className="h-7 px-2 py-1 text-xs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("snippets.search")}
          value={search}
        />
        {/* Narrow panel: groups collapse into a dropdown; the sidebar takes over once there's room. */}
        <select
          className="@[440px]:hidden h-7 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(event) =>
            setActiveGroup(event.target.value as GroupFilter)
          }
          value={activeGroup}
        >
          <option value={ALL_GROUPS}>
            {t("snippets.allGroups")} ({searchFiltered.length})
          </option>
          {groups.map(({ group, snippets }) => (
            <option key={group} value={group}>
              {t(`snippets.groups.${group}`)} ({snippets.length})
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <SnippetGroupNav
          activeGroup={activeGroup}
          className="@[440px]:flex hidden w-[160px] shrink-0"
          groups={groups}
          onSelect={setActiveGroup}
          totalCount={searchFiltered.length}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
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
    </div>
  );
}
