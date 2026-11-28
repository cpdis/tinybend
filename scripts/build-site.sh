#!/bin/sh
# Copies the write-up and only the images it uses into site/how/, so the site folder can be
# deployed as it is. site/how/ is made by this script and is not kept in git.
#
#   scripts/build-site.sh
set -eu
cd "$(dirname "$0")/.."
rm -rf site/how
mkdir -p site/how
cp writeup/how.md site/how/how.md
grep -oE '\(images/[^)]+\)' writeup/how.md | tr -d '()' | sort -u | while read -r image; do
  mkdir -p "site/how/$(dirname "$image")"
  cp "writeup/$image" "site/how/$image"
done
echo "site/how: $(find site/how -type f | wc -l | tr -d ' ') files, $(du -sh site/how | cut -f1)"
