#!/usr/bin/env bash
set -e
PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$(pwd)"

echo "Applying Auralis SEO/GEO V3 from: $PATCH_DIR"
echo "Target repository: $TARGET_DIR"

# Remove only generated public-route copies from earlier SEO patches.
rm -rf "$TARGET_DIR/chi-siamo" "$TARGET_DIR/empty-leg" "$TARGET_DIR/prenota" "$TARGET_DIR/contatti"

# Copy patch, excluding this installer/readme.
for item in "$PATCH_DIR"/*; do
  name="$(basename "$item")"
  case "$name" in
    apply-seo-v3.sh|PATCH_README.txt) continue ;;
  esac
  cp -R "$item" "$TARGET_DIR/"
done

echo "V3 applied. Review with: git status && git diff --stat"
