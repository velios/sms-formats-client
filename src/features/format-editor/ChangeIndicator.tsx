import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ChangeMarker } from "./change-markers";

export function ChangeIndicator({ marker }: { marker?: ChangeMarker }) {
  const { t } = useTranslation();
  if (!marker) {
    return null;
  }
  const label = t(
    marker === "local" ? "editor.localChange" : "editor.sourceChange"
  );
  return (
    <StatusBadge
      aria-label={label}
      className="ml-1"
      data-change={marker}
      title={label}
      variant={marker === "local" ? "modified" : "warning"}
    >
      ●
    </StatusBadge>
  );
}
