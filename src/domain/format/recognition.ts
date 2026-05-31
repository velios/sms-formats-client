import { cleanText, tryCompile } from "./regex";

export interface SmsRecognition {
  matched: boolean;
  error: string | null;
}

export interface SmsesRecognition {
  error: string | null;
  matched: boolean[];
}

/**
 * One regex precompiled for reuse. `regex` is null both for an empty/whitespace
 * source (no match, no error) and an invalid one (no match, `error` set) — the
 * two are told apart by `error`, preserving the recognition semantics.
 */
export interface CompiledRegex {
  regex: RegExp | null;
  error: string | null;
}

function testCompiled(regex: RegExp, sms: string): boolean {
  return regex.test(cleanText(sms));
}

/**
 * Compile many regex strings once for repeated matching, aligned by index to
 * `regexes`. Goes through the same `tryCompile` (flag `d` + fallback) as every
 * other path and keeps the recognition semantics: an empty/whitespace regex is
 * `{ regex: null, error: null }` (not an error), an invalid one carries its
 * `error`. The compiled array is the caller's to cache by content/SHA — the
 * core stays pure (ADR-0003).
 */
export function compileRegexes(regexes: string[]): CompiledRegex[] {
  return regexes.map((regex) => {
    if (!regex.trim()) {
      return { regex: null, error: null };
    }
    const compiled = tryCompile(regex);
    return { regex: compiled.regex, error: compiled.error };
  });
}

/**
 * Which of many precompiled regexes recognize a single SMS. Normalizes the SMS
 * once and tests against the ready `RegExp[]`, so no recompilation happens per
 * call. Result is aligned by index to `compiled`, carrying each entry's error.
 */
export function recognizeWithCompiled(
  compiled: CompiledRegex[],
  sms: string
): SmsRecognition[] {
  const subject = cleanText(sms);
  return compiled.map((entry) => {
    if (!entry.regex) {
      return { matched: false, error: entry.error };
    }
    return { matched: entry.regex.test(subject), error: null };
  });
}

/**
 * Recognize one regex against one SMS. Boolean path: normalizes via `cleanText`
 * and discards the match object — positions are the rich `testRegex` path.
 */
export function recognizeSms(regex: string, sms: string): SmsRecognition {
  if (!regex.trim()) {
    return { matched: false, error: null };
  }
  const compiled = tryCompile(regex);
  if (!compiled.regex) {
    return { matched: false, error: compiled.error };
  }
  return { matched: testCompiled(compiled.regex, sms), error: null };
}

/**
 * Which of many regexes recognize a single SMS. The single matching path for
 * the whole project: compile once, then test the normalized SMS against the
 * compiled set. Result is aligned by index to `regexes`, with a per-regex error
 * since each may be individually invalid.
 */
export function regexesBySms(regexes: string[], sms: string): SmsRecognition[] {
  return recognizeWithCompiled(compileRegexes(regexes), sms);
}

/**
 * Which of many SMS a single regex recognizes. Compiles the regex once; a
 * single `error` covers an invalid regex, while `matched` is aligned by index
 * to `smses`.
 */
export function smsesByRegex(smses: string[], regex: string): SmsesRecognition {
  if (!regex.trim()) {
    return { error: null, matched: smses.map(() => false) };
  }
  const compiled = tryCompile(regex);
  if (!compiled.regex) {
    return { error: compiled.error, matched: [] };
  }
  const { regex: compiledRegex } = compiled;
  return {
    error: null,
    matched: smses.map((sms) => testCompiled(compiledRegex, sms)),
  };
}
