#!/usr/bin/env bash
# Publishes the static site into ./public.
#
# Works two ways:
#   - git-linked deploy: the sources are already checked out here, so they are
#     copied straight across.
#   - direct deploy of this bootstrap alone: the sources are fetched from the
#     public repository's main branch.
#
# Either way supabase/ and the repo's own tooling stay out of public/, so the
# SQL migrations are never served from the CDN.
set -euo pipefail

if [ -f index.html ]; then
  SRC="$PWD"
  echo "building from the checked-out sources"
else
  SRC="$(mktemp -d)"
  echo "fetching sources from github.com/sudhamshu1411/fruitly@main"
  curl -fsSL "https://codeload.github.com/sudhamshu1411/fruitly/tar.gz/refs/heads/main" \
    | tar xz --strip-components=1 -C "$SRC"
fi

rm -rf public
mkdir -p public
( cd "$SRC" && tar cf - \
    --exclude='./.git' \
    --exclude='./.github' \
    --exclude='./supabase' \
    --exclude='./email-templates' \
    --exclude='./public' \
    --exclude='./node_modules' \
    --exclude='./build.sh' \
    --exclude='./package.json' \
    --exclude='./vercel.json' \
    --exclude='./README.md' \
    --exclude='./.gitignore' \
    --exclude='./.vercelignore' \
    . ) | tar xf - -C public

echo "published:"
find public -type f | sort
