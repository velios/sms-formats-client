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
    <div className="ui-card">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-[color:var(--c-tone-quantifier-soft-bg)] px-2 py-1 font-mono font-semibold text-[color:var(--c-tone-quantifier-text)] text-xs">
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
      <p className="mt-2 text-foreground text-xs">{snippet.desc}</p>
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
        <p className="mt-1 text-warning text-xs">
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
    <p className="mt-1 text-muted-foreground text-xs">
      <span className="font-semibold text-muted-foreground">{label}: </span>
      <span className={cn(mono && "font-mono")}>{value}</span>
    </p>
  );
}
