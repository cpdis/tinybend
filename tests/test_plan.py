"""Checks the whole-map plan: python3 tests/test_plan.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "modal_app"))
from plan import AREA, OVERLAP, SHOT, grid, next_wave, overlap, pins, shots_under  # noqa: E402

# A made-up map: a 30 by 20 block of shots with one corner missing.
shots = {(c, r) for c in range(-12, 18) for r in range(-8, 12)} - {(c, r) for c in range(10, 18) for r in range(6, 12)}
areas = grid(shots)

# Every shot lies under at least one area, and every area has at least one shot.
covered = {shot for a in areas for shot in shots_under(a["x"], a["y"], a["size"])}
assert shots <= covered
assert all(any(s in shots for s in shots_under(a["x"], a["y"], a["size"])) for a in areas)

# Grid neighbours share exactly the overlap.
by_name = {a["name"]: a for a in areas}
assert by_name["v1_c1_r0"]["x"] - by_name["v1_c0_r0"]["x"] == AREA - OVERLAP

# Waves: no two areas in a wave overlap, every area is drawn once, and the limit holds.
pending, drawn = list(areas), []
while pending:
    wave = next_wave(pending, 10)
    assert 0 < len(wave) <= 10
    assert not any(overlap(a, b) for a in wave for b in wave if a is not b)
    # Pins are every finished overlapping area, in the order drawn.
    for a in wave:
        assert pins(a, drawn) == [d["name"] for d in drawn if overlap(a, d)]
    drawn += wave
    pending = [a for a in pending if a not in wave]
assert len(drawn) == len(areas)
assert SHOT == 2048

# A larger map on the same grid: the first map's whole areas are left out, and its part-drawn
# edge areas come back under the new prefix.
more = shots | {(c, r) for c in range(-20, 26) for r in range(-14, 18)}
added = grid(more, "v2", earlier=shots)
whole = {a["name"][3:] for a in areas if all(s in shots for s in shots_under(a["x"], a["y"], a["size"]))}
assert whole and not any(a["name"][3:] in whole for a in added)
assert {a["name"][3:] for a in areas} - whole <= {a["name"][3:] for a in added}
assert {s for a in areas + added for s in shots_under(a["x"], a["y"], a["size"])} >= more
print(f"whole-map plan: all properties hold ({len(areas)} areas)")
