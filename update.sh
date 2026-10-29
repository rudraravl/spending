#!/bin/bash
# Update Keep to the newest release. Stop the app before running this.
#
# Everything lives in main(), which bash reads in full before running it, so the
# checkout below can safely replace this file mid-update.
set -euo pipefail

main() {
    cd "$(dirname "$0")"

    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        echo "You have local changes to Keep's files. Commit or discard them, then re-run." >&2
        git status --short --untracked-files=no >&2
        exit 1
    fi

    if branch="$(git symbolic-ref --quiet --short HEAD)"; then
        echo "You're on the '$branch' branch, so this looks like a development checkout." >&2
        echo "update.sh is for release installs. Use 'git pull' instead, or switch to a release:" >&2
        echo "  git checkout \"\$(git tag --list 'v*' --sort=-v:refname | head -1)\"" >&2
        exit 1
    fi

    echo "Checking for updates..."
    git fetch --quiet --tags origin

    local current latest
    current="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)"
    latest="$(git tag --list 'v*' --sort=-v:refname | head -1)"

    if [ -z "$latest" ]; then
        echo "No releases found." >&2
        exit 1
    fi
    if [ "$current" = "$latest" ]; then
        echo "Already up to date ($current)."
        exit 0
    fi

    echo "Updating $current -> $latest"

    if [ -f data/budget.db ]; then
        local backup="data/pre-update_${current}_$(date +%Y-%m-%d_%H-%M-%S).db"
        cp data/budget.db "$backup"
        echo "- Backed up database to $backup"
    fi

    git -c advice.detachedHead=false checkout --quiet "$latest"

    if [ ! -d .venv ]; then
        python3 -m venv .venv
    fi
    echo "- Installing Python dependencies"
    .venv/bin/pip install -q --disable-pip-version-check -r requirements.txt
    echo "- Installing frontend dependencies"
    npm --prefix frontend install --silent

    echo
    echo "Updated to $latest. Start the app as usual; the database migrates on startup."
    echo "What's new: https://github.com/rudraravl/spending/releases/tag/$latest"
}

main "$@"
