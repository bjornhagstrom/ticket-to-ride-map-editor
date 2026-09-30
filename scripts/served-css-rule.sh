#!/bin/zsh
# Prints every CSS rule the running dev server sends whose selector line contains the argument,
# whole and as sent. The dev server pretty-prints and reorders properties, so grepping for a compact
# one-liner copied from the source file finds nothing even when the change is live.
#
#   scripts/served-css-rule.sh '.print-table {'
#   SERVED_CSS_BASE=http://localhost:3001 scripts/served-css-rule.sh '.print-table {'
#
# Asks the server on port 3000 unless SERVED_CSS_BASE says otherwise; a working copy of your own is
# usually served on another port, and 3000 then shows someone else's CSS. Exits 1, and says so, when
# no served rule matches, so a check built on it cannot pass by accident.
selector="${1:?usage: scripts/served-css-rule.sh '<selector> {'}"
base="${SERVED_CSS_BASE:-http://localhost:3000}"
found=$(curl -s -m 60 "$base/ttr/" | grep -oE '/ttr/_next/static/[^"]+\.css' | sort -u | while read -r url; do
  curl -s -m 30 "$base$url"
done | awk -v sel="$selector" 'index($0, sel) && /\{/ {p=1} p {print} p && /\}/ {p=0}')
if [[ -z "$found" ]]; then
  echo "No rule matching '$selector' in the CSS served by $base." >&2
  exit 1
fi
print -r -- "$found"
