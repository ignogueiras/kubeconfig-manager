#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

clean_intermediates() {
  rm -rf -- \
    "$ROOT_DIR/dist" \
    "$ROOT_DIR/desktop-dist" \
    "$ROOT_DIR/release/linux-unpacked"
  rm -f -- \
    "$ROOT_DIR/release/builder-debug.yml" \
    "$ROOT_DIR/release/builder-effective-config.yaml" \
    "$ROOT_DIR/release/latest-linux.yml" \
    "$ROOT_DIR"/release/*.blockmap
}

clean_intermediates
trap clean_intermediates EXIT

npm run build
./node_modules/.bin/electron-builder --linux AppImage

printf 'AppImage ready in %s/release\n' "$ROOT_DIR"