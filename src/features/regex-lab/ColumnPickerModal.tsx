import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ALLOWED_COLUMNS_SORTED } from "@/domain/types";
import { cn } from "@/lib/utils";

export function ColumnPickerModal({
  groupIndex,
  selectedColumns,
  currentValue,
  onClose,
  onSelectColumn,
}: {
  groupIndex: number;
  selectedColumns: string[];
  currentValue: string;
  onClose: () => void;
  onSelectColumn: (columnName: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const lang = i18n.resolvedLanguage?.startsWith("ru") ? "ru" : "en";
  const currentBaseName = currentValue.split("#")[0] ?? "";
  const usedBaseNames = useMemo(() => {
    const names = new Set<string>();
    selectedColumns.forEach((column, index) => {
      if (index === groupIndex - 1) {
        return;
      }
      const base = column.split("#")[0];
      if (base) {
        names.add(base);
      }
    });
    return names;
  }, [groupIndex, selectedColumns]);
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
    <ModalDialog
      className="flex max-h-[calc(100vh-40px)] flex-col sm:max-w-[760px]"
      onClose={onClose}
      title={t("columns.selectForGroup", { index: groupIndex })}
    >
      <Input
        autoFocus
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("columns.search")}
        value={search}
      />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--c-border)]">
        {filteredColumns.map((column) => {
          const isUsedByOtherGroup = usedBaseNames.has(column.name);
          const isCurrent = currentBaseName === column.name;
          const isDisabled = isUsedByOtherGroup && !isCurrent;
          return (
            <button
              className={cn(
                "flex w-full items-center gap-2 border-[color:var(--c-border)] border-b bg-[color:var(--c-bg-surface)] px-3 py-2 text-left last:border-b-0",
                isCurrent && "bg-[color:var(--c-accent-soft)]",
                !isDisabled && "hover:bg-[color:var(--c-bg-hover)]",
                isDisabled && "cursor-not-allowed opacity-55"
              )}
              disabled={isDisabled}
              key={column.name}
              onClick={() =>
                onSelectColumn(
                  column.parameterized
                    ? `${column.name}#${column.paramHint ?? ""}`
                    : column.name
                )
              }
              type="button"
            >
              <span className="font-medium font-mono">{column.name}</span>
              <span className="text-[color:var(--c-text-muted)] text-sm">
                {column.description[lang] ?? column.description.en}
              </span>
              {column.parameterized && (
                <StatusBadge className="text-xs" variant="info">
                  {t("columns.param")}
                </StatusBadge>
              )}
              {isDisabled && (
                <StatusBadge className="text-xs" variant="warning">
                  {t("columns.alreadyUsed")}
                </StatusBadge>
              )}
            </button>
          );
        })}
        {filteredColumns.length === 0 && (
          <div className="p-4 text-[color:var(--c-text-muted)] text-sm">—</div>
        )}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose} type="button">
          {t("app.cancel")}
        </Button>
      </div>
    </ModalDialog>
  );
}
