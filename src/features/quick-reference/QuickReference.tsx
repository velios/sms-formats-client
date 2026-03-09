import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface RefItem {
  token: string;
  desc: { en: string; ru: string };
}

interface RefCategory {
  id: string;
  label: { en: string; ru: string };
  items: RefItem[];
}

const CATEGORIES: RefCategory[] = [
  {
    id: "common",
    label: { en: "Common Tokens", ru: "Частые" },
    items: [
      {
        token: ".",
        desc: {
          en: "Any character except newline",
          ru: "Любой символ кроме перевода строки",
        },
      },
      { token: "\\d", desc: { en: "Digit (0–9)", ru: "Цифра (0–9)" } },
      { token: "\\D", desc: { en: "Non-digit", ru: "Не цифра" } },
      {
        token: "\\w",
        desc: {
          en: "Word character (a–z, A–Z, 0–9, _)",
          ru: "Словесный символ (a–z, A–Z, 0–9, _)",
        },
      },
      {
        token: "\\W",
        desc: { en: "Non-word character", ru: "Не словесный символ" },
      },
      { token: "\\s", desc: { en: "Whitespace", ru: "Пробельный символ" } },
      {
        token: "\\S",
        desc: { en: "Non-whitespace", ru: "Не пробельный символ" },
      },
    ],
  },
  {
    id: "anchors",
    label: { en: "Anchors", ru: "Якоря" },
    items: [
      { token: "^", desc: { en: "Start of string", ru: "Начало строки" } },
      { token: "$", desc: { en: "End of string", ru: "Конец строки" } },
      { token: "\\b", desc: { en: "Word boundary", ru: "Граница слова" } },
      {
        token: "\\B",
        desc: { en: "Non-word boundary", ru: "Не граница слова" },
      },
    ],
  },
  {
    id: "quantifiers",
    label: { en: "Quantifiers", ru: "Квантификаторы" },
    items: [
      { token: "*", desc: { en: "0 or more", ru: "0 или более" } },
      { token: "+", desc: { en: "1 or more", ru: "1 или более" } },
      { token: "?", desc: { en: "0 or 1", ru: "0 или 1" } },
      { token: "{n}", desc: { en: "Exactly n", ru: "Ровно n" } },
      { token: "{n,}", desc: { en: "n or more", ru: "n или более" } },
      { token: "{n,m}", desc: { en: "Between n and m", ru: "От n до m" } },
      {
        token: "*?",
        desc: { en: "0 or more (lazy)", ru: "0 или более (ленивый)" },
      },
      {
        token: "+?",
        desc: { en: "1 or more (lazy)", ru: "1 или более (ленивый)" },
      },
    ],
  },
  {
    id: "groups",
    label: { en: "Group Constructs", ru: "Группы" },
    items: [
      { token: "(...)", desc: { en: "Capturing group", ru: "Группа захвата" } },
      {
        token: "(?:...)",
        desc: { en: "Non-capturing group", ru: "Группа без захвата" },
      },
      {
        token: "(?=...)",
        desc: { en: "Positive lookahead", ru: "Положительный просмотр вперёд" },
      },
      {
        token: "(?!...)",
        desc: { en: "Negative lookahead", ru: "Отрицательный просмотр вперёд" },
      },
      {
        token: "(?<=...)",
        desc: { en: "Positive lookbehind", ru: "Положительный просмотр назад" },
      },
      {
        token: "(?<!...)",
        desc: { en: "Negative lookbehind", ru: "Отрицательный просмотр назад" },
      },
      {
        token: "|",
        desc: { en: "Alternation (or)", ru: "Альтернатива (или)" },
      },
    ],
  },
  {
    id: "charclass",
    label: { en: "Character Classes", ru: "Классы символов" },
    items: [
      {
        token: "[abc]",
        desc: { en: "Any of a, b, or c", ru: "Любой из a, b, c" },
      },
      { token: "[^abc]", desc: { en: "Not a, b, or c", ru: "Не a, b, c" } },
      {
        token: "[a-z]",
        desc: { en: "Range: a to z", ru: "Диапазон: от a до z" },
      },
      {
        token: "[A-Z]",
        desc: { en: "Range: A to Z", ru: "Диапазон: от A до Z" },
      },
      {
        token: "[0-9]",
        desc: { en: "Range: 0 to 9", ru: "Диапазон: от 0 до 9" },
      },
    ],
  },
  {
    id: "meta",
    label: { en: "Meta Sequences", ru: "Метапоследоват." },
    items: [
      { token: "\\n", desc: { en: "Newline", ru: "Перевод строки" } },
      { token: "\\t", desc: { en: "Tab", ru: "Табуляция" } },
      { token: "\\r", desc: { en: "Carriage return", ru: "Возврат каретки" } },
      { token: "\\.", desc: { en: "Escaped dot", ru: "Экранированная точка" } },
      {
        token: "\\\\",
        desc: { en: "Escaped backslash", ru: "Экранированный обратный слэш" },
      },
    ],
  },
];

export function QuickReference() {
  const { i18n } = useTranslation();
  const lang = i18n.language as "ru" | "en";
  const [activeCat, setActiveCat] = useState("common");
  const [search, setSearch] = useState("");

  const activeCategory = CATEGORIES.find((c) => c.id === activeCat);

  const filteredItems = useMemo(() => {
    if (!activeCategory) {
      return [];
    }
    if (!search) {
      return activeCategory.items;
    }
    const q = search.toLowerCase();
    return activeCategory.items.filter(
      (it) =>
        it.token.toLowerCase().includes(q) ||
        (it.desc[lang] ?? it.desc.en).toLowerCase().includes(q)
    );
  }, [activeCategory, search, lang]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <Input
          aria-label={
            lang === "ru"
              ? "Поиск по справочнику regex"
              : "Search regex reference"
          }
          className="h-7 px-2 py-1 text-xs"
          onChange={(e) => setSearch(e.target.value)}
          placeholder={lang === "ru" ? "Поиск…" : "Search…"}
          value={search}
        />
      </div>
      <div className="grid h-full min-h-0 flex-1 overflow-hidden border-t border-[color:var(--c-border)] [grid-template-columns:140px_1fr]">
        <div className="overflow-y-auto border-r border-[color:var(--c-border)]">
          {CATEGORIES.map((cat) => (
            <button
              className={cn(
                "block w-full border-0 border-b border-[color:var(--c-border)] bg-transparent px-2.5 py-1.5 text-left text-xs transition-colors",
                activeCat === cat.id
                  ? "bg-[color:var(--c-bg-elevated)] font-semibold text-[color:var(--c-accent)]"
                  : "text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-bg-hover)] hover:text-[color:var(--c-text)]"
              )}
              key={cat.id}
              onClick={() => {
                setActiveCat(cat.id);
                setSearch("");
              }}
              type="button"
            >
              {cat.label[lang] ?? cat.label.en}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto p-1">
          {filteredItems.map((it, i) => (
            <div
              className="flex gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-xs hover:bg-[color:var(--c-bg-hover)]"
              key={i}
            >
              <span className="min-w-[60px] font-mono font-medium text-[color:var(--c-accent)]">
                {it.token}
              </span>
              <span className="text-[color:var(--c-text-muted)]">
                {it.desc[lang] ?? it.desc.en}
              </span>
            </div>
          ))}
          {filteredItems.length === 0 && (
            <div className="p-4 text-sm text-[color:var(--c-text-muted)]">
              —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
