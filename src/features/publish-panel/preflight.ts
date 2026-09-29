export function resolvePublishPreflightState(params: {
  resolverHeadSha: string;
  sessionHeadSha: string;
  writable: boolean;
  localChangesCount: number;
  hasInvalidScopeChanges: boolean;
  validationErrorsCount: number;
}):
  | "stale"
  | "read-only"
  | "no-changes"
  | "invalid-scope"
  | "validation-failed"
  | "can-publish" {
  const {
    resolverHeadSha,
    sessionHeadSha,
    writable,
    localChangesCount,
    hasInvalidScopeChanges,
    validationErrorsCount,
  } = params;
  if (resolverHeadSha !== sessionHeadSha) {
    return "stale";
  }
  if (!writable) {
    return "read-only";
  }
  if (localChangesCount === 0) {
    return "no-changes";
  }
  if (hasInvalidScopeChanges) {
    return "invalid-scope";
  }
  if (validationErrorsCount > 0) {
    return "validation-failed";
  }
  return "can-publish";
}
