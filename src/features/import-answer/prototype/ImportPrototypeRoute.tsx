// ПРОТОТИП — не продакшн-код. Тикет #27. Три варианта экрана импорта на одном
// маршруте `/prototype/import-screen`, переключаются `?variant=A|B|C`;
// случай из корпуса — `?case=<id>`.
//
// Отдельный маршрут, а не настоящий workspace банка: экран — модалка поверх
// затемнения, а живой workspace требует токена GitHub, банка и PR. Подложка
// нарисована статикой, чтобы плотность была видна.

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { buildView, type Scenario, SCENARIOS } from "./scenarios";
import { NAME as NAME_A, VariantA } from "./VariantA";
import { NAME as NAME_B, VariantB } from "./VariantB";
import { NAME as NAME_C, VariantC } from "./VariantC";
import { NAME as NAME_D, VariantD } from "./VariantD";

const VARIANTS = ["A", "B", "C", "D"] as const;
const FIRST = SCENARIOS[0] as Scenario;
const NAMES: Record<string, string> = {
  A: NAME_A,
  B: NAME_B,
  C: NAME_C,
  D: NAME_D,
};

export function ImportPrototypeRoute() {
  const [params, setParams] = useSearchParams();
  const variant = (params.get("variant") ?? "A").toUpperCase();
  const caseId = params.get("case") ?? FIRST.id;
  const [closed, setClosed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const scenario = SCENARIOS.find((item) => item.id === caseId) ?? FIRST;
  const view = buildView(scenario);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      next.set(key, value);
      setParams(next, { replace: true });
      setClosed(false);
      setToast(null);
    },
    [params, setParams]
  );

  const cycle = useCallback(
    (step: number) => {
      const index = Math.max(0, VARIANTS.indexOf(variant as "A"));
      const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length] as string;
      setParam("variant", next);
    },
    [setParam, variant]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (event.key === "ArrowLeft") {
        cycle(-1);
      }
      if (event.key === "ArrowRight") {
        cycle(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycle]);

  const close = useCallback(() => setClosed(true), []);

  return (
    <div className="min-h-screen bg-[color:var(--c-bg)] p-6">
      {/* Подложка вместо настоящего workspace — чтобы модалка была не в вакууме. */}
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 opacity-60">
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-3">
          <span className="font-semibold text-[14px]">{scenario.bankName}</span>
          <span className="text-[12px] text-[color:var(--c-text-dim)]">
            {scenario.bankPath}
          </span>
          <span className="ml-auto text-[12px] text-[color:var(--c-text-dim)]">
            AI промпт · Импортировать ответ · Опубликовать
          </span>
        </div>
        <div className="grid grid-cols-[280px_1fr] gap-3">
          <div className="flex h-[560px] flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-3">
            {Object.keys(scenario.before)
              .slice(0, 14)
              .map((path) => (
                <div
                  className="truncate text-[12px] text-[color:var(--c-text-dim)]"
                  key={path}
                >
                  {path.split("/").pop()}
                </div>
              ))}
          </div>
          <div className="h-[560px] rounded-[var(--radius-md)] border border-[color:var(--c-border)]" />
        </div>
      </div>

      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-[420px] rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-3 text-[13px] shadow-lg">
          {toast}
        </div>
      )}

      {!closed && variant === "A" && (
        <VariantA onClose={close} scenario={scenario} view={view} />
      )}
      {!closed && variant === "B" && (
        <VariantB onClose={close} scenario={scenario} view={view} />
      )}
      {!closed && variant === "D" && (
        <VariantD onClose={close} scenario={scenario} view={view} />
      )}
      {!closed && variant === "C" && (
        <VariantC
          onClose={close}
          onToast={setToast}
          scenario={scenario}
          view={view}
        />
      )}

      <div className="fixed right-4 bottom-4 z-[60] flex max-w-[300px] flex-col gap-2 rounded-[var(--radius-md)] border border-[color:#ffffff33] bg-[color:#111318] p-2 text-white shadow-2xl">
        <div className="flex items-center gap-2">
          <Button onClick={() => cycle(-1)} size="icon-sm" type="button">
            ←
          </Button>
          <span className="flex-1 text-center text-[12px]">
            {variant} — {NAMES[variant] ?? "?"}
          </span>
          <Button onClick={() => cycle(1)} size="icon-sm" type="button">
            →
          </Button>
          {closed && (
            <Button
              onClick={() => setClosed(false)}
              size="sm"
              type="button"
              variant="primary"
            >
              Открыть снова
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {SCENARIOS.map((item) => (
            <button
              className={`rounded-sm px-2 py-1 text-[11px] ${
                item.id === scenario.id
                  ? "bg-white text-black"
                  : "bg-[color:#ffffff1a]"
              }`}
              key={item.id}
              onClick={() => setParam("case", item.id)}
              type="button"
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
