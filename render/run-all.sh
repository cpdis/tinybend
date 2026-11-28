#!/bin/bash
# Renders every shot in a frames file, keeps the Mac awake, and logs network traffic.
# Safe to run again: finished shots are skipped. Runs passes until none are left.
#
#   nohup render/run-all.sh render/frames/bend.json render/out/bend &
set -u
frames=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
out=$(mkdir -p "$2" && cd "$2" && pwd)
cd "$(dirname "$0")"

left() {
  node -e 'const fs=require("fs");const f=JSON.parse(fs.readFileSync(process.argv[1]));console.log(f.filter(s=>!fs.existsSync(process.argv[2]+"/"+s.id+".json")).length)' "$frames" "$out"
}

# Bytes in and out on the default network interface, every 2 seconds, for the write-up's traffic chart.
touch "$out/render.running"
interface=$(route -n get default | awk '/interface:/{print $2}')
[ -f "$out/network.tsv" ] || printf 'time\tin_bytes\tout_bytes\n' > "$out/network.tsv"
( while [ -f "$out/render.running" ]; do
    netstat -ibn -I "$interface" | awk -v t="$(date +%s)" 'NR==2{print t"\t"$7"\t"$10}' >> "$out/network.tsv"
    sleep 2
  done ) &

for pass in 1 2 3 4 5 6; do
  caffeinate -dims node shoot.js "$frames" --out "$out" >> "$out/render.log" 2>&1
  remaining=$(left)
  echo "pass $pass finished, $remaining shots left" >> "$out/render.log"
  [ "$remaining" = "0" ] && break
  # A pass that ends with shots left is worth a look. Say so on the Mac's screen.
  osascript -e "display notification \"$remaining shots left after pass $pass. See render.log.\" with title \"Tiny Bend render\"" 2>/dev/null
  sleep 600 # Shots are left only when Google kept refusing tiles. Give the limit time to clear.
done
rm -f "$out/render.running"
osascript -e "display notification \"Render ended with $(left) shots left.\" with title \"Tiny Bend render\"" 2>/dev/null
