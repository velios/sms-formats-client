interface DraftSwitchGuard {
  clearAll: () => void;
  hasDrafts: () => boolean;
}

type ConfirmSourceSwitch = (message: string) => boolean;

export function confirmSourceSwitch(params: {
  confirm?: ConfirmSourceSwitch;
  confirmMessage: string;
  draftStore: DraftSwitchGuard;
}): boolean {
  const { confirm = window.confirm, confirmMessage, draftStore } = params;
  if (!draftStore.hasDrafts()) {
    return true;
  }
  if (!confirm(confirmMessage)) {
    return false;
  }
  draftStore.clearAll();
  return true;
}
