import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { RegexSnippet } from "./schema";

export function SnippetCard({
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
        <code className="min-w-0 flex-1 break-all rounded-[3px] bg-[color:var(--c-tone-quantifier-soft-bg)] px-2 py-1 font-mono font-semibold text-[13px] text-[color:var(--c-tone-quantifier-text)]">
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
        <p className="mt-1.5 text-[color:var(--c-warning)] text-xs">
          <span className="font-semibold">{t("snippets.gotcha")}: </span>
          {snippet.gotcha}
        </p>
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
