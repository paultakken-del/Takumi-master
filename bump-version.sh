#!/usr/bin/env bash
# bump-version.sh — verhoogt APP_VERSION in index.html met 0.01
#
# Gebruik: ./bump-version.sh
# Wordt aangeroepen vóór een `git add index.html && git commit ...` zodat
# elke push naar main automatisch een nieuwe versie krijgt. Sidebar-footer
# leest deze constante en toont 'v0.110' etc. Drie decimalen zodat 0.100
# als '0.100' blijft renderen (niet '0.1').

set -e

FILE="index.html"
if [ ! -f "$FILE" ]; then
  echo "fout: $FILE niet gevonden in cwd"
  exit 1
fi

# Huidige versie ophalen (regex match op de const-regel)
CURRENT=$(grep -oE "const APP_VERSION = '[0-9]+\.[0-9]+'" "$FILE" | grep -oE "[0-9]+\.[0-9]+")
if [ -z "$CURRENT" ]; then
  echo "fout: kon APP_VERSION niet vinden in $FILE"
  exit 1
fi

# Bump +0.01, drie decimalen weergave
NEW=$(awk -v c="$CURRENT" 'BEGIN { printf "%.3f", c + 0.01 }')

# Vervang in-place
sed -i "s|const APP_VERSION = '$CURRENT'|const APP_VERSION = '$NEW'|" "$FILE"

echo "APP_VERSION: $CURRENT -> $NEW"
