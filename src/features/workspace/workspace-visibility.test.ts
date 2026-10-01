import { expect, it, mock } from "bun:test";
import { setTestGlobal } from "@/test-globals";
import { watchWorkspaceVisibility } from "./workspace-visibility";

it("counts visible time, checks only real returns and cleans up", () => {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let id = 0;
  const target = new EventTarget();
  const doc = Object.assign(target, { visibilityState: "visible" });
  setTestGlobal("document", doc);
  setTestGlobal("setTimeout", (callback: () => void, delay: number) => {
    timers.set(++id, { at: now + delay, callback });
    return id;
  });
  setTestGlobal("clearTimeout", (key: number) => timers.delete(key));
  const originalNow = Date.now;
  Date.now = () => now;
  const check = mock(() => Promise.resolve());
  const advance = (ms: number) => {
    now += ms;
    for (const [key, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(key);
        timer.callback();
      }
    }
  };
  const visibility = (value: string) => {
    doc.visibilityState = value;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  try {
    const stop = watchWorkspaceVisibility(check);
    advance(5 * 60_000);
    expect(check).not.toHaveBeenCalled();
    visibility("hidden");
    advance(20 * 60_000);
    expect(check).not.toHaveBeenCalled();
    visibility("visible");
    expect(check).toHaveBeenCalledTimes(1);
    visibility("visible");
    expect(check).toHaveBeenCalledTimes(1);
    advance(5 * 60_000);
    expect(check).toHaveBeenCalledTimes(2);
    advance(10 * 60_000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
    expect(timers.size).toBe(0);
    visibility("hidden");
    visibility("visible");
    expect(check).toHaveBeenCalledTimes(3);
  } finally {
    Date.now = originalNow;
  }
});
