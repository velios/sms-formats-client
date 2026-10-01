const INTERVAL = 10 * 60_000;

export function watchWorkspaceVisibility(
  check: () => Promise<void>
): () => void {
  let remaining = INTERVAL;
  let started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = document.visibilityState === "visible";
  const schedule = () => {
    started = Date.now();
    timer = setTimeout(() => {
      remaining = INTERVAL;
      void check();
      schedule();
    }, remaining);
  };
  const onVisibility = () => {
    const nextVisible = document.visibilityState === "visible";
    if (visible === nextVisible) {
      return;
    }
    visible = nextVisible;
    if (visible) {
      void check();
      schedule();
    } else {
      clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - started));
    }
  };
  if (visible) {
    schedule();
  }
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
