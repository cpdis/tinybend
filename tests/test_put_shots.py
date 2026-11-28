"""Checks which files scripts/put-shots.py sends: python3 tests/test_put_shots.py"""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("put_shots", Path(__file__).resolve().parent.parent / "scripts" / "put-shots.py")
put = importlib.util.module_from_spec(spec)
spec.loader.exec_module(put)

# A whole shot is three files, with plain or probe-style ids.
for name in ["c0_r0.png", "c-12_r6.depth.png", "c3_r-1.json", "pilot-butte__c3_r-1.depth.png"]:
    assert put.WHOLE.fullmatch(name), name
# Colour only is the colour PNG, never the depth PNG.
assert put.COLOUR.fullmatch("c0_r0.png")
assert not put.COLOUR.fullmatch("c0_r0.depth.png")
# Other files in a render folder are never sent.
for name in ["gain.json", "shoot.log", "c0_r0.png.tmp", "frames.json"]:
    assert not put.WHOLE.fullmatch(name), name

# A shot missing its depth or sidecar is caught before anything is sent.
files = [Path(n) for n in ["c0_r0.png", "c0_r0.depth.png", "c0_r0.json", "c1_r0.png", "c1_r0.json", "c2_r0.depth.png"]]
assert put.incomplete(files) == ["c1_r0", "c2_r0"], put.incomplete(files)
assert put.incomplete(files[:3]) == []
print("put-shots: ok")
