import { Columns3 } from "lucide-react";
import { Children, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import { Button } from "@/components/ui/button";

const usePanelResizeStore = create<{
  enabled: boolean;
  toggle: () => void;
}>((set) => ({
  enabled: false,
  toggle: () => set((state) => ({ enabled: !state.enabled })),
}));

export function PanelResizeToggle() {
  const { t } = useTranslation();
  const { enabled, toggle } = usePanelResizeStore();
  const location = useLocation();
  if (!location.pathname.startsWith("/repo/")) {
    return null;
  }
  return (
    <Button
      aria-label={t("panels.resize")}
      aria-pressed={enabled}
      className="rounded-md"
      onClick={toggle}
      size="icon"
      title={enabled ? t("panels.finishResize") : t("panels.resize")}
      variant={enabled ? "primary" : "ghost"}
    >
      <Columns3 className="size-4" />
    </Button>
  );
}

export function ResizablePanels({
  children,
  side,
}: {
  children: ReactNode;
  side: "left" | "right";
}) {
  const enabled = usePanelResizeStore((state) => state.enabled);
  const [width, setWidth] = useState<number | null>(null);
  const expandedWidth = useRef(320);
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const collapsed = width === 32;
  const { t } = useTranslation();
  const label = t(side === "left" ? "panels.left" : "panels.right");
  const parts = Children.toArray(children);
  const initial =
    side === "left" ? "clamp(264px,19vw,340px)" : "clamp(320px,24vw,430px)";
  const size = width === null ? initial : `${width}px`;
  const resize = (value: number) => {
    const available = container.current?.clientWidth ?? 1200;
    const maximum = Math.max(
      160,
      available -
        (side === "left" ? 480 : 320) -
        (container.current?.children[1]?.clientWidth ?? 12)
    );
    const next = value < 100 ? 32 : Math.min(maximum, Math.max(160, value));
    if (next > 32) {
      expandedWidth.current = next;
    }
    setWidth(next);
  };
  const pane = (
    <div className="grid min-h-0 min-w-0 overflow-hidden">
      <div
        className="min-h-0 min-w-0"
        style={{ display: collapsed ? "none" : "grid" }}
      >
        {parts[side === "left" ? 0 : 1]}
      </div>
      {collapsed && (
        <button
          aria-label={t("panels.expand", { panel: label })}
          className="ui-panel flex flex-col items-center gap-3 py-3 text-primary"
          onClick={() => resize(expandedWidth.current)}
          title={t("panels.expand", { panel: label })}
          type="button"
        >
          <span>{side === "left" ? "›" : "‹"}</span>
          <span className="text-xs" style={{ writingMode: "vertical-rl" }}>
            {label}
          </span>
        </button>
      )}
    </div>
  );
  return (
    <div
      className="grid min-h-0 min-w-0 flex-1"
      ref={container}
      style={{
        gridTemplateColumns:
          side === "left"
            ? `${size} var(--panel-gap) minmax(0,1fr)`
            : `minmax(0,1fr) var(--panel-gap) ${size}`,
      }}
    >
      {side === "left" ? pane : parts[0]}
      <div className="relative flex items-center justify-center">
        {enabled && (
          <button
            aria-label={t("panels.width", { panel: label })}
            className="absolute inset-y-0 -right-0.5 -left-0.5 z-10 flex touch-none select-none items-center justify-center text-primary hover:bg-primary-soft focus-visible:outline-2"
            onDoubleClick={() => resize(collapsed ? expandedWidth.current : 32)}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const element =
                container.current?.children[side === "left" ? 0 : 2];
              drag.current = {
                x: event.clientX,
                width: element?.getBoundingClientRect().width ?? 320,
              };
            }}
            onPointerMove={(event) => {
              if (!drag.current) {
                return;
              }
              resize(
                drag.current.width +
                  (event.clientX - drag.current.x) * (side === "left" ? 1 : -1)
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            style={{ cursor: "col-resize" }}
            title={t("panels.resizeHint", { panel: label })}
            type="button"
          >
            <span className="h-12 w-1 rounded bg-current" />
          </button>
        )}
      </div>
      {side === "right" ? pane : parts[1]}
    </div>
  );
}
