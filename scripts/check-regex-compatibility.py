"""Check fixture expectations using Python re, as in upstream validation."""

import json
import re
import sys
from pathlib import Path

cases_path = (
    Path(__file__).resolve().parents[1]
    / "src/domain/format/regex-compatibility-cases.json"
)
cases = json.loads(cases_path.read_text(encoding="utf-8"))
failures = []
for case in cases:
    sms = re.sub(r"[\n\r]+", " ", case["sms"]).strip()
    match = re.compile(case["pattern"]).search(sms)
    actual = {"match": match.group(0), "groups": list(match.groups())} if match else None
    if actual != case["upstream"]:
        failures.append(case["id"])
print(f"Python {sys.version.split()[0]}: {len(cases)} cases, {len(failures)} failures")
for failure in failures:
    print(failure)
sys.exit(bool(failures))
