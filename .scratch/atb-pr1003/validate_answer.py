"""Validate an agent answer applied over the package layers, upstream-style.

Usage: python3 validate_answer.py <package.txt> <answer.xml>
"""
import re
import sys
import unicodedata

FILE_OPEN = re.compile(r'^<file path="(.+)">$')
DELETE_OPEN = re.compile(r'^<delete path="(.+)">$')


def parse_blocks(text):
    """Return dict path -> body (None for delete) in order of appearance."""
    out = {}
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        m = FILE_OPEN.match(lines[i])
        d = DELETE_OPEN.match(lines[i])
        if m:
            body = []
            i += 1
            while i < len(lines) and lines[i] != "</file>":
                body.append(lines[i])
                i += 1
            out[m.group(1)] = "\n".join(body)
        elif d:
            while i < len(lines) and lines[i] != "</delete>":
                i += 1
            out[d.group(1)] = None
        i += 1
    return out


def parse_layers(package_text):
    """Return final state: dict path -> body, draft over pr over main."""
    state = {}
    for layer in ("main", "pr", "draft"):
        m = re.search(r'<files layer="%s">\n(.*?)\n</files>' % layer, package_text, re.S)
        if not m:
            continue
        state.update(parse_blocks(m.group(1)))
    return state


def parse_format(body):
    lines = body.strip("\n").split("\n")
    regex = lines[0]
    rest = "\n".join(lines[1:])
    parts = rest.split("-----COLUMNS-----")
    if len(parts) != 2:
        return None
    cols_and_examples = parts[1].split("-----EXAMPLE-----")
    columns = cols_and_examples[0].strip()
    cols = [c.strip() for c in columns.split(";")] if columns else []
    examples = [e.strip() for e in cols_and_examples[1:]]
    return regex, cols, examples


def clean(s):
    return re.sub(r"[\n\r]+", " ", s).strip()


def main():
    package = open(sys.argv[1], encoding="utf-8").read()
    answer = open(sys.argv[2], encoding="utf-8").read()
    state = parse_layers(package)
    ans = parse_blocks(answer)
    for path, body in ans.items():
        if body is None:
            state.pop(path, None)
        else:
            state[path] = body

    formats = {}
    errors = []
    for path, body in sorted(state.items()):
        if not path.endswith(".txt") or path.endswith("senders.txt"):
            continue
        parsed = parse_format(body)
        if not parsed:
            errors.append(("invalid_format", path, ""))
            continue
        regex, cols, examples = parsed
        try:
            compiled = re.compile(clean(regex))
        except re.error as e:
            errors.append(("regex_error", path, str(e)))
            continue
        formats[path] = (compiled, cols, examples)
        if not examples or any(not e for e in examples):
            errors.append(("invalid_format", path, "empty/missing example"))
        for ex in examples:
            m = compiled.search(clean(ex))
            if not m:
                errors.append(("example_no_match", path, ex[:60]))
                continue
            if cols and compiled.groups != len(cols):
                errors.append(("group_count_mismatch", path,
                               f"groups={compiled.groups} cols={len(cols)}"))

    paths = sorted(formats)
    for p1 in paths:
        c1, _, _ = formats[p1]
        for p2 in paths:
            if p1 == p2:
                continue
            for ex in formats[p2][2]:
                if c1.search(clean(ex)):
                    errors.append(("cross_match", f"{p1}  ловит пример из  {p2}", ex[:70]))

    if not errors:
        print("OK: ошибок нет.", len(formats), "форматов проверено")
    for kind, path, detail in errors:
        print(f"[{kind}] {path}\n    {detail}")


main()
