#!/usr/bin/env python3
"""Uploads a render's shots to a folder on the Modal Volume, in batches, and proves it.

    scripts/put-shots.py render/out/bend /renders/bend
    scripts/put-shots.py --colour-only render/out/bend /renders/bend

By default every shot goes up whole: its colour PNG, its 16-bit depth PNG and its camera
sidecar JSON, side by side in one folder. Tiny Perth uploaded colour only, and later lost the
depth for most of its map when the Mac's copy was cleaned up (only 731 of 4,640 shots kept
depth). The Volume is the backup, so depth and sidecars belong there from the start.
--colour-only sends just the colour PNGs, for a folder that only a drawing job reads.

One upload of all 40 GB hung after hours and left nothing on the Volume, with no error. So
this uploads 100 shots at a time. Each batch has a time limit and is tried again if it fails
or hangs. After each batch the Volume is listed, and only shots the Volume really has count
as done. It can be stopped and started again: shots already there are skipped, and never
replaced.
The run ends with the count on the Volume against the count on disk, and exits 1 if they differ.
A shot counts as on disk only when all three of its files are: a shot missing its depth or
sidecar stops the run before anything is sent, because a half shot is what lost Perth's depth.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

VOLUME = "tinybend"
BATCH = 100
BATCH_SECONDS = 20 * 60  # About 1.2 GB a batch: far more time than a healthy line needs.
TRIES = 4
# Shot ids are c<col>_r<row>, optionally after a prefix such as a probe spot ("pilot-butte__").
ID = r"(?:[a-z0-9-]+__)?c-?\d+_r-?\d+"
COLOUR = re.compile(ID + r"\.png")
WHOLE = re.compile(ID + r"\.(png|depth\.png|json)")
SHOT = WHOLE


def on_volume(folder: str) -> set[str]:
    """Names of the shots the Volume has in the folder. Empty if the folder is not there yet.

    Any other failure (network, sign-in) stops the run. Treating it as an empty folder would
    send shots the Volume already has."""
    listing = subprocess.run(["modal", "volume", "ls", VOLUME, folder, "--json"], capture_output=True, text=True)
    if listing.returncode != 0:
        if "No such file or directory" in listing.stdout + listing.stderr:
            return set()
        sys.exit(f"could not list {folder} on the Volume, so nothing was sent:\n{listing.stderr.strip() or listing.stdout.strip()}")
    return {Path(entry["filename"]).name for entry in json.loads(listing.stdout) if SHOT.fullmatch(Path(entry["filename"]).name)}


def incomplete(files: list[Path]) -> list[str]:
    """Shot ids that lack their colour, depth or sidecar file."""
    names = {p.name for p in files}
    ids = {re.sub(r"\.(depth\.png|png|json)$", "", n) for n in names}
    return sorted(i for i in ids if not {f"{i}.png", f"{i}.depth.png", f"{i}.json"} <= names)


def main(source: str, folder: str) -> None:
    local = sorted(p for p in Path(source).iterdir() if SHOT.fullmatch(p.name))
    if SHOT is WHOLE:
        missing_parts = incomplete(local)
        if missing_parts:
            sys.exit(f"{len(missing_parts)} shots lack colour, depth or sidecar, so nothing was sent: {', '.join(missing_parts[:10])}")
    done = on_volume(folder)
    print(f"{len(local)} files on disk, {len(done & {p.name for p in local})} already on the Volume", flush=True)
    failures = 0
    while True:
        missing = [p for p in local if p.name not in done]
        if not missing:
            break
        batch = missing[:BATCH]
        # Hard links gather the batch in one folder without copying the files.
        with tempfile.TemporaryDirectory(dir=Path(source).parent) as staging:
            for shot in batch:
                os.link(shot, Path(staging) / shot.name)
            # No --force: if a shot is already there (the listing was behind), the put fails and
            # the next listing drops it from the batch. A shot on the Volume is never replaced.
            try:
                subprocess.run(["modal", "volume", "put", VOLUME, staging, folder], check=True, capture_output=True, timeout=BATCH_SECONDS)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                print(f"batch did not finish: {type(error).__name__}", flush=True)
        before = len(done)
        done = on_volume(folder)
        if len(done) == before:
            failures += 1
            if failures >= TRIES:
                sys.exit(f"{TRIES} batches in a row added nothing. Stopping with {len(missing)} shots left.")
        else:
            failures = 0
        print(f"{len(done)} of {len(local)} files on the Volume", flush=True)
    done = on_volume(folder) & {p.name for p in local}
    print(f"finished: {len(done)} of {len(local)} files are on the Volume")
    sys.exit(0 if len(done) == len(local) else 1)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[0] == "--colour-only":
        SHOT = COLOUR
        args = args[1:]
    main(args[0], args[1])
