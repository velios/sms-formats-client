import type { ReactNode } from "react";
import { testRegex } from "@/domain/format";
import { normalizeIntersectionExample } from "@/features/intersections/core";
import type { LoadedFormat } from "@/features/workspace/bank-snapshot";
import { cn } from "@/lib/utils";

export interface ActiveFormatSearchContext {
  filePath: string;
  regex: string;
  examples: string[];
  activeExampleIndex: number;
}

export interface IntersectionExampleItem {
  text: string;
  filePath: string;
  fileName: string;
}

export function getActiveExampleText(
  context: ActiveFormatSearchContext | null
): string {
  if (!context) {
    return "";
  }
  return context.examples[context.activeExampleIndex] ?? "";
}

export function collectIntersectingExamples(params: {
  activeFilePath: string | null;
  activeRegex: string;
  entries: LoadedFormat[];
}): IntersectionExampleItem[] {
  const { activeFilePath, activeRegex, entries } = params;
  if (!(activeFilePath && activeRegex.trim())) {
    return [];
  }

  const seenExamples = new Set<string>();
  const result: IntersectionExampleItem[] = [];

  for (const entry of entries) {
    if (entry.filePath === activeFilePath) {
      continue;
    }

    for (const example of entry.examples) {
      const normalizedExample = normalizeIntersectionExample(example);
      const dedupeKey = `${entry.filePath}\u0000${normalizedExample}`;
      if (!normalizedExample || seenExamples.has(dedupeKey)) {
        continue;
      }

      if (!testRegex(activeRegex, normalizedExample).matched) {
        continue;
      }

      seenExamples.add(dedupeKey);
      result.push({
        text: normalizedExample,
        filePath: entry.filePath,
        fileName: entry.fileName,
      });
    }
  }

  return result;
}

const formatIntersectionMetricClassName =
  "inline-flex h-4 shrink-0 items-center justify-center rounded px-1 align-middle leading-none";

export function FormatIntersectionMetric(params: {
  value: number;
  tone: "success" | "error";
  ariaLabel?: string;
  onClick?: () => void;
}): ReactNode {
  const { value, tone, ariaLabel, onClick } = params;
  const className = cn(
    formatIntersectionMetricClassName,
    tone === "success" ? "text-success" : "bg-destructive text-white",
    onClick &&
      "cursor-pointer appearance-none border-0 transition-[color,background-color,opacity,box-shadow] duration-150 [font:inherit] hover:bg-destructive-soft hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );

  if (onClick) {
    return (
      <button
        aria-label={ariaLabel}
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        type="button"
      >
        {value}
      </button>
    );
  }

  return <span className={className}>{value}</span>;
}
