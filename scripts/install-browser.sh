#!/usr/bin/env bash
# Installs Chromium for Playwright without depending on Ubuntu's package servers when possible.
# GitHub's runners usually have the system packages Chromium needs, so the browser is installed
# alone first. System packages are only installed if Chromium then fails to start, and each try
# has a time limit, so an outage of those servers can't use up the whole run.
set -uo pipefail

starts() {
  node -e "
const { chromium } = require('playwright');
chromium.launch().then((browser) => browser.close()).then(() => process.exit(0), (error) => { console.error(error.message.split('\n')[0]); process.exit(1); });
"
}

for attempt in 1 2 3; do
  if timeout 300 npx playwright install chromium; then break; fi
  echo "Browser download attempt ${attempt} failed."
  [ "$attempt" = 3 ] && { echo "Could not download Chromium" >&2; exit 1; }
  sleep $((attempt * 15))
done

if starts; then
  echo "Chromium starts correctly without extra system packages"
  exit 0
fi

echo "Chromium needs system packages. Installing them."
for attempt in 1 2; do
  if timeout 240 npx playwright install-deps chromium && starts; then
    echo "Chromium starts correctly after installing system packages (attempt ${attempt})"
    exit 0
  fi
  echo "System package attempt ${attempt} failed."
  sleep 30
done

echo "Chromium could not be made to start" >&2
exit 1
