#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-F:/ai-novel-studio-hotfix-v321}"
DEST="${1:-F:/ai-novel-studio-cleanup-rollback-test}"
GIT_REPO="$REPO"
PS_DEST="$DEST"
if [[ "$REPO" =~ ^([A-Za-z]):/(.*)$ ]]; then
  GIT_REPO="/mnt/${BASH_REMATCH[1],,}/${BASH_REMATCH[2]}"
fi
if [[ "$DEST" =~ ^/mnt/([A-Za-z])/(.*)$ ]]; then
  PS_DEST="${BASH_REMATCH[1],,}:/${BASH_REMATCH[2]}"
fi

case "$DEST" in
  F:/ai-novel-studio-hotfix-v321|F:/ai-novel-studio-hotfix-v321/*)
    echo "Refusing to use retained project as rollback destination" >&2
    exit 2
    ;;
esac

if [[ -e "$DEST" ]]; then
  echo "Rollback destination already exists: $DEST" >&2
  exit 2
fi

mkdir -p "$DEST"
git clone --no-hardlinks "$GIT_REPO" "$DEST/ai-novel-studio"
git -C "$DEST/ai-novel-studio" switch --detach f1388fb7dd9649dbedea19aef8fb90da7d17d1c6
git -C "$DEST/ai-novel-studio" stash apply --index origin/codex/archive/cleanup-20260820/ai-novel-studio-dirty

git -C "$DEST/ai-novel-studio" worktree add --detach "$DEST/ai-novel-studio-spike" origin/codex/spike-dsh-feasibility
git -C "$DEST/ai-novel-studio" worktree add --detach "$DEST/ai-novel-studio-v310" origin/codex/v3.1.0-dsh-brain
git -C "$DEST/ai-novel-studio-v310" stash apply --index origin/codex/archive/cleanup-20260820/ai-novel-studio-v310-dirty
git -C "$DEST/ai-novel-studio" worktree add --detach "$DEST/ai-novel-studio-v320" origin/codex/v3.2.0-dsh-closeout
git -C "$DEST/ai-novel-studio" worktree add --detach "$DEST/ai-novel-studio-v320-rollback-check" origin/codex/archive/cleanup-20260820/v320-rollback-check

if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$REPO/reports/cleanup-other-projects-20260820/recovery-small-projects.zip' -DestinationPath '$PS_DEST' -Force"
  powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$REPO/reports/cleanup-other-projects-20260820/recovery-local-state-unique.zip' -DestinationPath '$PS_DEST' -Force"
fi

echo "Rollback restored source heads and archived dirty states under $DEST"
