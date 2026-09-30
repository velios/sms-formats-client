import { normalizeSmsText, tryCompile } from "./regex";

export interface SmsRecognition {
  matched: boolean;
  error: string | null;
}

export interface SmsesRecognition {
  error: string | null;
  matched: boolean[];
}

export interface CompiledRegex {
  regex: RegExp | null;
  error: string | null;
}

function testCompiled(regex: RegExp, sms: string): boolean {
  return regex.test(normalizeSmsText(sms));
}

export function compileRegexes(regexes: string[]): CompiledRegex[] {
  return regexes.map((regex) => {
    if (!regex.trim()) {
      return { regex: null, error: null };
    }
    const compiled = tryCompile(regex);
    return { regex: compiled.regex, error: compiled.error };
  });
}

export function recognizeWithCompiled(
  compiled: CompiledRegex[],
  sms: string
): SmsRecognition[] {
  const subject = normalizeSmsText(sms);
  return compiled.map((entry) => {
    if (!entry.regex) {
      return { matched: false, error: entry.error };
    }
    return { matched: entry.regex.test(subject), error: null };
  });
}

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

export function regexesBySms(regexes: string[], sms: string): SmsRecognition[] {
  return recognizeWithCompiled(compileRegexes(regexes), sms);
}

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
