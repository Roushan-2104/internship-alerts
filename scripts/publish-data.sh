#!/usr/bin/env bash
# Commits data/jobs.json and pushes it, retrying if another run saved first.
# Each run regenerates the whole file, so this run's newer copy wins any clash.
set -euo pipefail

branch="${1:-main}"
git add data/jobs.json
if git diff --cached --quiet; then
  echo "No data changes"
  exit 0
fi
git commit -m "Update job data [skip ci]"

for attempt in 1 2 3 4 5; do
  if git push origin "HEAD:${branch}"; then
    echo "Published on attempt ${attempt}"
    exit 0
  fi
  echo "Another run saved first. Rebasing onto it, keeping this run's data (attempt ${attempt})."
  git fetch origin "${branch}"
  # During a rebase, "theirs" is the commit being replayed: this run's fresh data.
  git rebase -X theirs "origin/${branch}"
  sleep $((attempt * 3))
done

echo "Could not publish job data after 5 attempts" >&2
exit 1
