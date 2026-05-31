import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
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
  onClose: () => void;
  onInsert: (pattern: string) => void;
}

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
        <SnippetGroupNav
          activeGroup={activeGroup}
          className="w-[200px] shrink-0"
          groups={groups}
          onSelect={setActiveGroup}
          totalCount={searchFiltered.length}
        />
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
