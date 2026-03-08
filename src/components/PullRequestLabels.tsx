import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useState } from "react";
import type { PullRequestLabel } from "@/domain/types";

const DEFAULT_LABEL_COLOR = "#d1d9e0";

function normalizeLabelColor(color: string): string {
  const normalized = color.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/iu.test(normalized)) {
    return DEFAULT_LABEL_COLOR;
  }
  return `#${normalized}`;
}

function getLabelTextColor(backgroundColor: string): string {
  const normalized = normalizeLabelColor(backgroundColor).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness >= 160 ? "#172033" : "#ffffff";
}

function buildLabelStyle(color: string): CSSProperties {
  const backgroundColor = normalizeLabelColor(color);
  return {
    backgroundColor,
    color: getLabelTextColor(backgroundColor),
  };
}

function stopEvent(
  event:
    | ReactKeyboardEvent<HTMLButtonElement>
    | ReactMouseEvent<HTMLButtonElement>
) {
  event.stopPropagation();
}

interface PullRequestLabelsProps {
  className?: string;
  labels: PullRequestLabel[];
  maxVisible?: number;
  neutralLabels?: string[];
}

export function PullRequestLabels({
  className,
  labels,
  maxVisible = 1,
  neutralLabels = [],
}: PullRequestLabelsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (labels.length === 0 && neutralLabels.length === 0) {
    return null;
  }

  const limitedVisibleCount = Math.max(1, maxVisible);
  const visibleLabels = isExpanded
    ? labels
    : labels.slice(0, limitedVisibleCount);
  const hiddenCount = labels.length - visibleLabels.length;
  const isExpandable = !isExpanded && hiddenCount > 0;
  const containerClassName = [
    "pr-labels",
    isExpanded ? "pr-labels--expanded" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const allLabelsTitle = labels.map((label) => label.name).join(", ");

  return (
    <div className={containerClassName}>
      {neutralLabels.map((label) => (
        <span
          className="pr-label-chip pr-label-chip--neutral"
          key={`neutral-${label}`}
          title={label}
        >
          {label}
        </span>
      ))}
      {visibleLabels.map((label) => {
        const chipStyle = buildLabelStyle(label.color);
        if (isExpandable) {
          return (
            <button
              className="pr-label-chip pr-label-chip--button"
              key={label.name}
              onClick={(event) => {
                stopEvent(event);
                setIsExpanded(true);
              }}
              onKeyDown={stopEvent}
              style={chipStyle}
              title={label.name}
              type="button"
            >
              {label.name}
            </button>
          );
        }

        return (
          <span
            className="pr-label-chip"
            key={label.name}
            style={chipStyle}
            title={label.name}
          >
            {label.name}
          </span>
        );
      })}
      {hiddenCount > 0 && !isExpanded && (
        <button
          className="pr-label-chip pr-label-chip--button pr-label-chip--counter"
          onClick={(event) => {
            stopEvent(event);
            setIsExpanded(true);
          }}
          onKeyDown={stopEvent}
          title={allLabelsTitle}
          type="button"
        >
          +{hiddenCount}
        </button>
      )}
    </div>
  );
}
