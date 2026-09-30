#!/bin/zsh
# Prints every CSS rule the running dev server sends whose selector line contains the argument,
# whole and as sent. The dev server pretty-prints and reorders properties, so grepping for a compact
# one-liner copied from the source file finds nothing even when the change is live.
#
#   scripts/served-css-rule.sh '.print-table {'
#
# Expects `npm run dev` on port 3000. Prints nothing if no served rule matches.
selector="${1:?usage: scripts/served-css-rule.sh '<selector> {'}"
base="${SERVED_CSS_BASE:-http://localhost:3000}"
curl -s -m 60 "$base/ttr/" | grep -oE '/ttr/_next/static/[^"]+\.css' | sort -u | while read -r url; do
  curl -s -m 30 "$base$url"
done | awk -v sel="$selector" 'index($0, sel) && /\{/ {p=1} p {print} p && /\}/ {p=0}'
