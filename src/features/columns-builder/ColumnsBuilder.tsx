import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@/domain/types";
import { ALLOWED_COLUMNS } from "@/domain/types";

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
      return ALLOWED_COLUMNS;
    }
    const q = searchQuery.toLowerCase();
    return ALLOWED_COLUMNS.filter(
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
    <div className="panel">
      <div className="panel__header">
        <span>{t("editor.columns")}</span>
        <div className="flex gap-xs">
          <button
            className="btn btn--ghost btn--sm"
            onClick={handleTextEditOpen}
          >
            {t("columns.textEdit")}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setShowAdd(!showAdd)}
          >
            + {t("columns.add")}
          </button>
        </div>
      </div>

      <div className="panel__body">
        {textEditMode ? (
          <div className="flex-col gap-sm">
            <input
              className="input input--mono"
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="column1;column2;column3"
              value={textValue}
            />
            <div className="flex gap-sm">
              <button
                className="btn btn--primary btn--sm"
                onClick={handleTextEditApply}
              >
                {t("app.save")}
              </button>
              <button
                className="btn btn--sm"
                onClick={() => setTextEditMode(false)}
              >
                {t("app.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Column list with drag-and-drop */}
            <div className="mb-md flex-col gap-xs">
              {columns.map((col, i) => {
                const parts = col.split("#");
                const baseName = parts[0]!;
                const param = parts[1];
                const colDef = ALLOWED_COLUMNS.find((c) => c.name === baseName);
                const isValid =
                  !!colDef || ALLOWED_COLUMNS.some((c) => c.name === baseName);

                return (
                  <div
                    className="column-item"
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
                      className={`column-item__name ${isValid ? "" : "text-muted"}`}
                    >
                      {baseName}
                    </span>
                    {colDef?.parameterized && (
                      <input
                        className="input input--mono"
                        onChange={(e) => handleParamChange(i, e.target.value)}
                        placeholder={colDef.paramHint ?? t("columns.param")}
                        style={{ width: 120, padding: "2px 6px", fontSize: 12 }}
                        value={param ?? ""}
                      />
                    )}
                    {!isValid && (
                      <span className="badge badge--warning text-sm">?</span>
                    )}
                    <button
                      className="column-item__remove"
                      onClick={() => handleRemoveColumn(i)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {columns.length === 0 && (
                <div className="text-muted text-sm">{t("bank.noResults")}</div>
              )}
            </div>

            {/* Serialized preview */}
            <div
              className="text-dim text-mono text-sm"
              style={{ wordBreak: "break-all" }}
            >
              {columns.join(";")}
            </div>
          </>
        )}

        {/* Add column dropdown */}
        {showAdd && (
          <div
            className="mt-md"
            style={{
              borderTop: "1px solid var(--c-border)",
              paddingTop: "var(--space-sm)",
            }}
          >
            <input
              autoFocus
              className="input mb-sm"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("columns.search")}
              value={searchQuery}
            />
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {filteredColumns.map((col) => (
                <div
                  className="autocomplete__item"
                  key={col.name}
                  onClick={() => handleAddColumn(col)}
                >
                  <span className="font-medium text-mono text-sm">
                    {col.name}
                  </span>
                  <span className="text-muted text-sm">
                    {col.description[lang] ?? col.description.en}
                  </span>
                  {col.parameterized && (
                    <span className="badge badge--info text-sm">param</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
