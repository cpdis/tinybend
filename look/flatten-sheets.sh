#!/bin/sh
# Repaints the water on every sheet of a map with one shared table of colours.
#
#   look/flatten-sheets.sh <sheets-folder> <out-folder>
#
# Pass 1 learns the water colours from every sheet into <out-folder>/tones.json, one sheet at a
# time, because each sheet adds to the same file. Pass 2 repaints every sheet with that table,
# four at a time. WATER_BBOX passes through to look/osm-water.js for a map larger than the first.
set -e
sheets=$1
out=$2
mkdir -p "$out"
# One line per sheet: name and its top-left corner in map pixels, margin included.
list=$(node -e '
const i = require(require("path").resolve(process.argv[1], "index.json"));
for (const [c, r] of i.sheets) console.log(`${c}_${r} ${i.x + c * i.sheet - i.margin} ${i.y + r * i.sheet - i.margin}`);
' "$sheets")
echo "$list" | while read -r name x y; do
  [ -f "$out/$name.png" ] && continue
  node look/flatten-water.js "$sheets/$name.render.png" "$sheets/$name.png" "$x" "$y" --learn "$out/tones.json" --mask "$sheets/$name.mask.png" > /dev/null
done
echo "learned tones from $(echo "$list" | wc -l | tr -d ' ') sheets"
echo "$list" | xargs -P 4 -L 1 sh -c '[ -f "'"$out"'/$0.png" ] || node look/flatten-water.js "'"$sheets"'/$0.render.png" "'"$sheets"'/$0.png" "$1" "$2" "'"$out"'/$0.png" --tones "'"$out"'/tones.json" --mask "'"$sheets"'/$0.mask.png"'
echo "repainted"
