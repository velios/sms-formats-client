#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PATTERN='(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}|sk_(live|test)_[0-9a-zA-Z]{16,})'

echo "Checking tracked files for common secret patterns..."
if git grep -nEI "${PATTERN}" -- . >/tmp/sms-formats-secrets-tracked.txt; then
  echo "Potential secrets found in tracked files:"
  sed -n '1,20p' /tmp/sms-formats-secrets-tracked.txt
  exit 1
fi

echo "Checking git history patches for common secret patterns..."
if git log --all -p --pretty=format: | rg -n "${PATTERN}" >/tmp/sms-formats-secrets-history.txt; then
  echo "Potential secrets found in git history patches:"
  sed -n '1,20p' /tmp/sms-formats-secrets-history.txt
  exit 1
fi

echo "Secret scan passed: no matches found in tracked files and git history."
