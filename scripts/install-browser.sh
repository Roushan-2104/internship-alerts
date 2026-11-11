#!/usr/bin/env bash
# Installs Chromium for Playwright, surviving short outages of Ubuntu's package servers.
# Tries the full install (browser plus system packages) a few times, then falls back to the
# browser alone, since GitHub's runners usually have the system packages already. Either way,
# it checks the browser really starts.
set -uo pipefail

for attempt in 1 2 3; do
  if npx playwright install --with-deps chromium; then
    echo "Installed Chromium with system packages on attempt ${attempt}"
    installed=1
    break
  fi
  echo "Install attempt ${attempt} failed. Waiting before retrying."
  sleep $((attempt * 20))
done

if [ "${installed:-0}" != 1 ]; then
  echo "System packages could not be installed. Installing the browser alone."
  npx playwright install chromium || { echo "Could not install Chromium" >&2; exit 1; }
fi

node -e "
const { chromium } = require('playwright');
chromium.launch().then((browser) => browser.close()).then(
  () => console.log('Chromium starts correctly'),
  (error) => { console.error('Chromium does not start:', error.message); process.exit(1); },
);
"
