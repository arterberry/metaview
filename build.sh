#!/usr/bin/env bash
set -e

# echo "Running tests..."
# npm run test

echo "Cleaning dist/"
rm -rf dist
mkdir -p dist

echo "Copying assets..."
cd src
find . -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.png" -o -name "*.json" -o -name "*.ttf" -o -name "*.md" \) | tar cf - -T - | (cd ../dist && tar xf -)
cd ..

cp LICENSE dist/

echo "Build completed."
