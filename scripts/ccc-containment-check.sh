#!/bin/bash
# ccc(containment): WAI-995. Fail when the CCC overlay leaks outside its allowed paths.
#
# The check compares the upstream base (default tag v0.10.2) with HEAD, or with the
# working tree when --worktree is given. It allows only these changes:
#   1. New or changed files under hindsight-control-plane/src/ccc/** and
#      hindsight-control-plane/public/ccc/**.
#   2. The overlay's own files outside those trees, by exact path (OWN_FILES).
#      This script is one of them.
#   3. In-place edits of anchored upstream files (ANCHORS). The added + deleted line
#      count of each anchored file against the base must not be more than its cap.
#   4. The ANCHORS file list must be equal to the files in the "anchors" list of
#      hindsight-control-plane/src/ccc/hooks.json (the anchor register).
# Any other change (an edit to an upstream file that is not anchored, a deletion,
# a type change, a binary change to an anchored file, a new file outside the ccc
# trees) is a violation.
#
# Usage: scripts/ccc-containment-check.sh [--repo DIR] [--base REF] [--head REF] [--worktree]
#   --repo DIR   repository to check (default: current directory)
#   --base REF   upstream base (default: v0.10.2). The update gate gives the pinned commit SHA.
#   --head REF   commit to check (default: HEAD). Not used with --worktree.
#   --worktree   check the working tree (tracked changes and untracked files that are not
#                ignored) against the base.
# Exit codes: 0 pass, 1 violation, 2 cannot run.
#
# To raise a cap or add an anchored file, change this file and hooks.json in the same
# reviewed commit. Portable to bash 3.2 (macOS /bin/bash). Needs git, awk and python3.

set -u
export LC_ALL=C

REPO=.
BASE=v0.10.2
HEADREF=HEAD
WORKTREE=0
CP=hindsight-control-plane

# Anchored upstream files: "<cap> <path>". Cap = maximum added + deleted lines against
# the base (the size of the anchored edit when it was registered, WAI-995 or later for
# sidebar.tsx at WAI-1064, plus a small rebase margin).
ANCHORS='6 hindsight-control-plane/src/app/[locale]/banks/[bankId]/page.tsx
18 hindsight-control-plane/src/app/[locale]/layout.tsx
22 hindsight-control-plane/src/app/[locale]/login/page.tsx
8 hindsight-control-plane/src/app/api/banks/route.ts
10 hindsight-control-plane/src/app/layout.tsx
32 hindsight-control-plane/src/components/bank-selector.tsx
28 hindsight-control-plane/src/components/constellation.tsx
12 hindsight-control-plane/src/components/data-view.tsx
44 hindsight-control-plane/src/components/documents-view.tsx
40 hindsight-control-plane/src/components/home-view.tsx
18 hindsight-control-plane/src/components/sidebar.tsx
40 hindsight-control-plane/src/components/think-view.tsx
4 hindsight-control-plane/src/components/ui/spinner.tsx'

# Files the overlay owns outside src/ccc/ and public/ccc/ (exact paths).
OWN_FILES='scripts/ccc-containment-check.sh
hindsight-control-plane/src/app/api/reflect-history/[bank]/route.ts
hindsight-control-plane/src/lib/documents-request-gate.ts'

usage() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) [ $# -ge 2 ] || { echo "ccc-containment: --repo needs a value" >&2; exit 2; }; REPO=$2; shift 2 ;;
    --base) [ $# -ge 2 ] || { echo "ccc-containment: --base needs a value" >&2; exit 2; }; BASE=$2; shift 2 ;;
    --head) [ $# -ge 2 ] || { echo "ccc-containment: --head needs a value" >&2; exit 2; }; HEADREF=$2; shift 2 ;;
    --worktree) WORKTREE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ccc-containment: unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in git awk python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ccc-containment: cannot run: $tool not found" >&2; exit 2; }
done

g() { git --literal-pathspecs -C "$REPO" "$@"; }

BASE_SHA=$(g rev-parse --verify -q "$BASE^{commit}") || { echo "ccc-containment: cannot run: base $BASE not found in $REPO" >&2; exit 2; }
if [ "$WORKTREE" = 1 ]; then
  HEAD_SHA=$(g rev-parse --verify -q "HEAD^{commit}") || { echo "ccc-containment: cannot run: no HEAD in $REPO" >&2; exit 2; }
  RANGE="$BASE_SHA"
  TARGET="worktree (HEAD $HEAD_SHA)"
else
  HEAD_SHA=$(g rev-parse --verify -q "$HEADREF^{commit}") || { echo "ccc-containment: cannot run: head $HEADREF not found in $REPO" >&2; exit 2; }
  RANGE="$BASE_SHA $HEAD_SHA"
  TARGET="$HEAD_SHA"
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ccc-containment.XXXXXX") || { echo "ccc-containment: cannot run: mktemp failed" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT

VIOLATIONS=0
PATHS=0
ANCHORED=0

line() { printf '  %-4s %s %s  (%s)\n' "$1" "$2" "$3" "$4"; }
violation() { VIOLATIONS=$((VIOLATIONS + 1)); line FAIL "$1" "$2" "$3"; }
allowed() { line ok "$1" "$2" "$3"; }

cap_of() { printf '%s\n' "$ANCHORS" | awk -v p="$1" '$2 == p { print $1; exit }'; }
is_own() { printf '%s\n' "$OWN_FILES" | grep -Fxq -- "$1"; }
in_ccc_tree() {
  case "$1" in
    "$CP/src/ccc/"*|"$CP/public/ccc/"*) return 0 ;;
  esac
  return 1
}

# Prints "<added> <deleted>" for one path against the base ("- -" for a binary diff).
# $RANGE is unquoted on purpose: it holds one or two commit SHAs.
numstat() { g diff --no-renames --no-ext-diff --no-textconv --numstat $RANGE -- "$1" | awk -F'\t' 'NR == 1 { print $1 " " $2 }'; }

check_path() {
  status=$1
  path=$2
  PATHS=$((PATHS + 1))
  if in_ccc_tree "$path"; then allowed "$status" "$path" "ccc tree"; return; fi
  if is_own "$path"; then allowed "$status" "$path" "overlay-owned file"; return; fi
  cap=$(cap_of "$path")
  if [ -n "$cap" ]; then
    if [ "$status" != M ]; then violation "$status" "$path" "anchored upstream file must be edited in place, status $status"; return; fi
    ANCHORED=$((ANCHORED + 1))
    counts=$(numstat "$path")
    added=${counts%% *}
    deleted=${counts##* }
    case "$added$deleted" in
      ''|*[!0-9]*) violation M "$path" "anchored file has a binary or unreadable diff"; return ;;
    esac
    total=$((added + deleted))
    if [ "$total" -gt "$cap" ]; then
      violation M "$path" "anchored edit is $total lines, cap $cap"
    else
      allowed M "$path" "anchored edit $total/$cap lines"
    fi
    return
  fi
  case "$status" in
    A) violation A "$path" "new file outside src/ccc/ and public/ccc/" ;;
    D) violation D "$path" "upstream file deleted" ;;
    *) violation "$status" "$path" "upstream file changed but not anchored" ;;
  esac
}

echo "ccc-containment-check: repo=$REPO base=$BASE ($BASE_SHA) target=$TARGET"

# 1-3. Every changed path against the base. --no-renames gives one status letter per path.
g diff --no-renames --no-ext-diff --name-status -z $RANGE > "$TMP/changes" || { echo "ccc-containment: cannot run: git diff failed" >&2; exit 2; }
while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  check_path "$(printf '%s' "$status" | cut -c1)" "$path"
done < "$TMP/changes"

if [ "$WORKTREE" = 1 ]; then
  g ls-files --others --exclude-standard -z > "$TMP/untracked" || { echo "ccc-containment: cannot run: git ls-files failed" >&2; exit 2; }
  while IFS= read -r -d '' path; do
    check_path A "$path"
  done < "$TMP/untracked"
fi

# 4. The cap table and the anchor register list the same files.
REGISTER="$CP/src/ccc/hooks.json"
if [ "$WORKTREE" = 1 ]; then
  cat "$REPO/$REGISTER" > "$TMP/hooks.json" 2>/dev/null
else
  g show "$HEAD_SHA:$REGISTER" > "$TMP/hooks.json" 2>/dev/null
fi
if [ ! -s "$TMP/hooks.json" ]; then
  violation - "$REGISTER" "anchor register missing"
else
  if ! python3 -c 'import json,sys
spec = json.load(open(sys.argv[1]))
print("\n".join(sorted({"hindsight-control-plane/" + a["file"] for a in spec["anchors"]})))' "$TMP/hooks.json" > "$TMP/register-files"; then
    echo "ccc-containment: cannot run: hooks.json anchors unreadable" >&2
    exit 2
  fi
  printf '%s\n' "$ANCHORS" | awk '{ print $2 }' | sort > "$TMP/cap-files"
  if cmp -s "$TMP/register-files" "$TMP/cap-files"; then
    allowed - "$REGISTER" "anchor register lists the same $(wc -l < "$TMP/cap-files" | tr -d ' ') files as the cap table"
  else
    comm -23 "$TMP/register-files" "$TMP/cap-files" | while IFS= read -r f; do echo "  FAIL - $f  (in hooks.json anchors, no cap in this script)"; done
    comm -13 "$TMP/register-files" "$TMP/cap-files" | while IFS= read -r f; do echo "  FAIL - $f  (has a cap in this script, not in hooks.json anchors)"; done
    violation - "$REGISTER" "anchor register and cap table differ"
  fi
fi

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "result: FAIL ($VIOLATIONS violation(s); $PATHS changed paths, $ANCHORED anchored upstream files)"
  exit 1
fi
echo "result: PASS ($PATHS changed paths, $ANCHORED anchored upstream files within caps)"
exit 0
