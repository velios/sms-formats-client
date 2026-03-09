import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ColumnDef } from "@/domain/types";
import { ALLOWED_COLUMNS, ALLOWED_COLUMNS_SORTED } from "@/domain/types";
import { cn } from "@/lib/utils";

interface Props {
  columns: string[];
  onChange: (columns: string[]) => void;
}

export function ColumnsBuilder({ columns, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [textEditMode, setTextEditMode] = useState(false);
  const [textValue, setTextValue] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const lang = i18n.language as "ru" | "en";

  const filteredColumns = useMemo(() => {
    if (!searchQuery) {
      return ALLOWED_COLUMNS_SORTED;
    }
    const q = searchQuery.toLowerCase();
    return ALLOWED_COLUMNS_SORTED.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description[lang]?.toLowerCase().includes(q)
    );
  }, [searchQuery, lang]);

  const handleAddColumn = (col: ColumnDef) => {
    let colStr = col.name;
    if (col.parameterized) {
      colStr = `${col.name}#${col.paramHint ?? ""}`;
    }
    onChange([...columns, colStr]);
    setShowAdd(false);
    setSearchQuery("");
  };

  const handleRemoveColumn = (index: number) => {
    onChange(columns.filter((_, i) => i !== index));
  };

  const handleParamChange = (index: number, param: string) => {
    const newCols = [...columns];
    const baseName = (newCols[index] ?? "").split("#")[0]!;
    newCols[index] = param ? `${baseName}#${param}` : baseName;
    onChange(newCols);
  };

  const handleTextEditApply = () => {
    const newCols = textValue
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean);
    onChange(newCols);
    setTextEditMode(false);
  };

  const handleTextEditOpen = () => {
    setTextValue(columns.join(";"));
    setTextEditMode(true);
  };

  // Drag and drop
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) {
      return;
    }

    const newCols = [...columns];
    const [removed] = newCols.splice(dragIndex, 1);
    newCols.splice(index, 0, removed!);
    onChange(newCols);
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]">
      <div className="flex items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.5px] text-[color:var(--c-text-muted)]">
        <span>{t("editor.columns")}</span>
        <div className="flex gap-1">
          <Button
            onClick={handleTextEditOpen}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("columns.textEdit")}
          </Button>
          <Button
            onClick={() => setShowAdd(!showAdd)}
            size="sm"
            type="button"
            variant="ghost"
          >
            + {t("columns.add")}
          </Button>
        </div>
      </div>

      <div className="p-4">
        {textEditMode ? (
          <div className="flex flex-col gap-2">
            <Input
              className="font-mono"
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="column1;column2;column3"
              value={textValue}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleTextEditApply}
                size="sm"
                type="button"
                variant="primary"
              >
                {t("app.save")}
              </Button>
              <Button
                onClick={() => setTextEditMode(false)}
                size="sm"
                type="button"
              >
                {t("app.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Column list with drag-and-drop */}
            <div className="mb-4 flex flex-col gap-1">
              {columns.map((col, i) => {
                const parts = col.split("#");
                const baseName = parts[0]!;
                const param = parts[1];
                const colDef = ALLOWED_COLUMNS.find((c) => c.name === baseName);
                const isValid =
                  !!colDef || ALLOWED_COLUMNS.some((c) => c.name === baseName);

                return (
                  <div
                    className="flex items-center gap-2 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-3 py-2"
                    draggable
                    key={`${col}-${i}`}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragStart={() => handleDragStart(i)}
                    style={{
                      opacity: dragIndex === i ? 0.5 : 1,
                    }}
                  >
                    <span className="drag-handle" title={t("columns.dragHint")}>
                      ⠿
                    </span>
                    <span
                      className={cn(
                        "font-medium text-[color:var(--c-text)]",
                        !isValid && "text-[color:var(--c-text-muted)]"
                      )}
                    >
                      {baseName}
                    </span>
                    {colDef?.parameterized && (
                      <Input
                        className="h-7 w-[120px] px-1.5 py-1 text-xs font-mono"
                        onChange={(e) => handleParamChange(i, e.target.value)}
                        placeholder={colDef.paramHint ?? t("columns.param")}
                        value={param ?? ""}
                      />
                    )}
                    {!isValid && (
                      <StatusBadge className="text-xs" variant="warning">
                        ?
                      </StatusBadge>
                    )}
                    <Button
                      aria-label={t("editor.removeExample")}
                      onClick={() => handleRemoveColumn(i)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
              {columns.length === 0 && (
                <div className="text-sm text-[color:var(--c-text-muted)]">
                  {t("bank.noResults")}
                </div>
              )}
            </div>

            {/* Serialized preview */}
            <div
              className="font-mono text-sm text-[color:var(--c-text-dim)]"
              style={{ wordBreak: "break-all" }}
            >
              {columns.join(";")}
            </div>
          </>
        )}

        {/* Add column dropdown */}
        {showAdd && (
          <div
            className="mt-4 border-t border-[color:var(--c-border)] pt-2"
            style={{
              maxHeight: 280,
            }}
          >
            <Input
              autoFocus
              className="mb-2"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("columns.search")}
              value={searchQuery}
            />
            <div className="max-h-[200px] overflow-y-auto">
              {filteredColumns.map((col) => (
                <button
                  aria-label={col.name}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--c-bg-hover)]"
                  key={col.name}
                  onClick={() => handleAddColumn(col)}
                  type="button"
                >
                  <span className="font-medium text-mono text-sm">
                    {col.name}
                  </span>
                  <span className="text-sm text-[color:var(--c-text-muted)]">
                    {col.description[lang] ?? col.description.en}
                  </span>
                  {col.parameterized && (
                    <StatusBadge className="text-xs" variant="info">
                      param
                    </StatusBadge>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
