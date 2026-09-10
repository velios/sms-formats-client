// Throwaway prototype: opt-in resizing of the existing workspace columns.
import { Columns3 } from "lucide-react";
import { Children, type ReactNode, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { create } from "zustand";
import { Button } from "@/components/ui/button";

const useLayoutPrototype = create<{
  enabled: boolean;
  toggle: () => void;
}>((set) => ({
  enabled: false,
  toggle: () => set((state) => ({ enabled: !state.enabled })),
}));

export function LayoutPrototypeToggle() {
  const { enabled, toggle } = useLayoutPrototype();
  const location = useLocation();
  if (!location.pathname.startsWith("/repo/")) {
    return null;
  }
  return (
    <Button
      aria-label="Изменить ширину панелей"
      aria-pressed={enabled}
      className="size-9 rounded-full"
      onClick={toggle}
      size="icon"
      title={enabled ? "Завершить настройку ширины" : "Изменить ширину панелей"}
      variant={enabled ? "primary" : "ghost"}
    >
      <Columns3 className="size-4" />
    </Button>
  );
}

export function ResizablePanelsPrototype({
  children,
  side,
}: {
  children: ReactNode;
  side: "left" | "right";
}) {
  const enabled = useLayoutPrototype((state) => state.enabled);
  const [width, setWidth] = useState<number | null>(null);
  const expandedWidth = useRef(320);
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const collapsed = width === 32;
  const label = side === "left" ? "Файлы и действия" : "Справка";
  const parts = Children.toArray(children);
  const initial =
    side === "left" ? "clamp(264px,19vw,340px)" : "clamp(320px,24vw,430px)";
  const size = width === null ? initial : `${width}px`;
  const resize = (value: number) => {
    const available = container.current?.clientWidth ?? 1200;
    const maximum = Math.max(
      160,
      available - (side === "left" ? 480 : 320) - 16
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
          aria-label={`Развернуть: ${label}`}
          className="flex flex-col items-center gap-4 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] py-3 text-[color:var(--c-accent)]"
          onClick={() => resize(expandedWidth.current)}
          title={`Развернуть: ${label}`}
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
            ? `${size} 16px minmax(0,1fr)`
            : `minmax(0,1fr) 16px ${size}`,
      }}
    >
      {side === "left" ? pane : parts[0]}
      <div className="relative flex items-center justify-center">
        {enabled && (
          <button
            aria-label={`Ширина: ${label}`}
            className="absolute inset-0 flex touch-none select-none items-center justify-center text-[color:var(--c-accent)] hover:bg-[color:var(--c-accent-soft)] focus-visible:outline-2"
            onDoubleClick={() => resize(collapsed ? expandedWidth.current : 32)}
            onKeyDown={(event) => {
              if (event.key === "Home") {
                resize(32);
              } else if (event.key === "Enter") {
                resize(collapsed ? expandedWidth.current : 32);
              } else if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight"
              ) {
                event.preventDefault();
                const delta = event.key === "ArrowRight" ? 24 : -24;
                resize(
                  (width ?? expandedWidth.current) +
                    (side === "left" ? delta : -delta)
                );
              }
            }}
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
            title={`${label}: тяните границу; двойной щелчок сворачивает панель`}
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
