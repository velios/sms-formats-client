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
  const { draftStore } = params;
  draftStore.hasDrafts();
  return true;
}
