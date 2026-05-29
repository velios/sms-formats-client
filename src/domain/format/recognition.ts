import { cleanText, tryCompile } from "./regex";

export interface SmsRecognition {
  matched: boolean;
  error: string | null;
}

export interface SmsesRecognition {
  error: string | null;
  matched: boolean[];
}

function testCompiled(regex: RegExp, sms: string): boolean {
  return regex.test(cleanText(sms));
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
 * Which of many regexes recognize a single SMS. Normalizes the SMS once;
 * result is aligned by index to `regexes`, with a per-regex error since each
 * may be individually invalid.
 */
export function regexesBySms(regexes: string[], sms: string): SmsRecognition[] {
  const subject = cleanText(sms);
  return regexes.map((regex) => {
    if (!regex.trim()) {
      return { matched: false, error: null };
    }
    const compiled = tryCompile(regex);
    if (!compiled.regex) {
      return { matched: false, error: compiled.error };
    }
    return { matched: compiled.regex.test(subject), error: null };
  });
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
