#!/usr/bin/env bash
# Builds a deterministic Git Flow-shaped test repository for git-graph-panel.
#
#   scripts/make-fixture-repo.sh <empty-dir>
#
# The repository to open in Claude Code is <dir>; its remote is the bare
# repository <dir>.origin.git next to it. Covers: main/develop/feature/release/hotfix branches, merge
# commits, an octopus merge, 10 feature lanes open at once (more than the
# graph's 8-lane limit), tags, a branch that exists only on origin, messages
# with Korean text, `|` and quotes, and three uncommitted changes (M, A, ??).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <empty-dir>" >&2
  exit 1
fi

DIR="$1"
mkdir -p "$DIR"
if [ -n "$(ls -A "$DIR")" ]; then
  echo "error: $DIR is not empty" >&2
  exit 1
fi
DIR="$(cd "$DIR" && pwd)"

ORIGIN="$DIR.origin.git"
rm -rf "$ORIGIN"
git init -q --bare -b main "$ORIGIN"
cd "$DIR"
git init -q -b main

git config user.name "Dana Kim"
git config user.email "dana@example.com"
git config commit.gpgsign false
git config tag.gpgsign false
git remote add origin "$ORIGIN"

# Deterministic clock: every commit is 90 minutes after the previous one.
BASE=1704067200
TICK=0
AUTHORS=("Dana Kim|dana@example.com" "한지우|jiwoo@example.com" "Sam O'Neil|sam@example.com")

stamp() {
  TICK=$((TICK + 1))
  export GIT_COMMITTER_DATE="$((BASE + TICK * 5400)) +0000"
  export GIT_AUTHOR_DATE="$GIT_COMMITTER_DATE"
  local who="${AUTHORS[$((TICK % 3))]}"
  export GIT_AUTHOR_NAME="${who%%|*}"
  export GIT_AUTHOR_EMAIL="${who##*|}"
  export GIT_COMMITTER_NAME="Dana Kim"
  export GIT_COMMITTER_EMAIL="dana@example.com"
}

# commit <message> [file]: appends a line to <file> (default: branch-named) and commits.
commit() {
  local msg="$1"
  local file="${2:-$(git rev-parse --abbrev-ref HEAD | tr '/' '_').txt}"
  stamp
  echo "$msg ($TICK)" >> "$file"
  git add "$file"
  git commit -q -m "$msg"
}

# merge <branch>... : --no-ff merge (octopus when several) with a deterministic date.
merge() {
  stamp
  local msg="merge: ${*} 병합"
  git merge -q --no-ff -m "$msg" "$@" >/dev/null
}

tag() {
  stamp
  git tag -a "$1" -m "$1" >/dev/null
}

# --- main: initial history ----------------------------------------------------
commit "chore: 초기 커밋" README.md
commit "docs: README 추가" README.md
tag v0.1.0

# --- develop ------------------------------------------------------------------
git switch -q -c develop
commit "chore: develop 브랜치 시작" develop.txt

# --- ten feature branches open at once ----------------------------------------
FEATURES=(login profile search payment notification dashboard settings export i18n onboarding)
for f in "${FEATURES[@]}"; do
  git switch -q -c "feature/$f" develop
  commit "feat($f): 초기 구조 | scaffold"
  git switch -q develop
done
for round in 2 3; do
  for f in "${FEATURES[@]}"; do
    git switch -q "feature/$f"
    case "$f:$round" in
      login:2)   commit "feat(login): \"로그인\" 폼 추가" ;;
      search:2)  commit "fix(search): 'quote' and \"double\" 처리" ;;
      payment:3) commit "feat(payment): 결제 | 취소 | 환불 플로우" ;;
      *)         commit "feat($f): 작업 $round" ;;
    esac
  done
done
git switch -q develop
commit "fix: 파이프(|) 문자 파싱 오류 수정" develop.txt

# --- a long-lived feature that stays unmerged ----------------------------------
git switch -q -c feature/long-lived develop
commit "feat(long): 장기 작업 시작"
commit "feat(long): 장기 작업 계속"
git switch -q develop

# --- merge the ten features one by one ----------------------------------------
for f in "${FEATURES[@]}"; do
  merge "feature/$f"
  commit "chore: $f 병합 후 정리" develop.txt
done

# --- octopus merge of three small branches -------------------------------------
for n in 1 2 3; do
  git switch -q -c "feature/oct-$n" develop
  commit "feat(oct-$n): 옥토퍼스 대상 $n"
  git switch -q develop
done
merge feature/oct-1 feature/oct-2 feature/oct-3

# --- release/1.0.0 --------------------------------------------------------------
git switch -q -c release/1.0.0 develop
commit "release: 1.0.0 준비" release.txt
commit "fix(release): 버전 문자열 수정" release.txt
git switch -q develop
commit "feat: release 중 develop 작업" develop.txt
git switch -q main
merge release/1.0.0
tag v1.0.0
git switch -q develop
merge main

# --- hotfix/1.0.1 ----------------------------------------------------------------
git switch -q -c hotfix/1.0.1 main
commit "fix: 긴급 수정 \"크래시\" 해결" hotfix.txt
git switch -q main
merge hotfix/1.0.1
tag v1.0.1
git switch -q develop
merge main

# --- push everything, then diverge ---------------------------------------------
git push -q origin --all
git push -q origin --tags

# A branch that exists only on origin.
git switch -q -c feature/remote-only develop
commit "feat(remote): origin 에만 있는 브랜치"
git push -q origin feature/remote-only
git switch -q develop
git branch -q -D feature/remote-only

# Local develop is ahead of origin/develop.
commit "feat: 로컬에만 있는 커밋" develop.txt
commit "docs: 변경 내역 정리" develop.txt

# --- uncommitted changes: M, A, ?? ----------------------------------------------
echo "local edit" >> develop.txt
echo "staged" > staged-new.txt
git add staged-new.txt
echo "scratch" > untracked-note.txt

echo "fixture repo ready: $DIR (origin: $ORIGIN)"
