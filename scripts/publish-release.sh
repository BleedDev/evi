#!/usr/bin/env bash
# Publishes Evi's GitHub release from one folder holding every file it carries and notes.md.
# release.yml runs it: straight from the release job when Evi Setup comes from the last release,
# or from its publish job after Evi Setup was built again. Needs GH_TOKEN, GH_REPO, TAG and VERSION.
#
#   bash scripts/publish-release.sh <folder>
set -euo pipefail
cd "$1"
if gh release view "$TAG" > /dev/null 2>&1; then
    echo "::error::A release or draft for $TAG already exists. Delete it first to rebuild."
    exit 1
fi
# A version with a dash is a prerelease that never becomes "Latest"
flags=(--latest)
if [[ "$VERSION" == *-* ]]; then flags=(--prerelease --latest=false); fi
ls -l
# Evi Setup for every system, and evi-core.json for Evi Setup and in-app updates
gh release create "$TAG" evi-core.json Evi-Setup.exe Evi-Setup-macos.zip Evi-Setup-linux-{x64,arm64} *.sha256 \
    "${flags[@]}" \
    --target "$GITHUB_SHA" \
    --title "Evi $VERSION" \
    --notes-file notes.md
