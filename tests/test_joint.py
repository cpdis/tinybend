"""Properties the joint sampler's window maths must hold, for any area size.

    python3 tests/test_joint.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from modal_app.joint import CELL, SHIFT, STRIDE, WINDOW, coverage, pinned_cells, tent, window_starts

SIZES = range(WINDOW, 420)

for length in SIZES:
    for shifted in (False, True):
        starts = window_starts(length, shifted)
        assert starts[0] == 0 and starts[-1] == length - WINDOW, "windows reach both ends"
        assert all(b - a <= STRIDE for a, b in zip(starts, starts[1:])), "neighbours always overlap"
        assert min(coverage(length, shifted)) >= 1, "every cell is drawn by at least one window"

# Blended weights are the window weights divided by the coverage, so they sum to 1 on every cell.
for length in (WINDOW, 112, 400):
    for shifted in (False, True):
        total = coverage(length, shifted)
        shares = [0.0] * length
        for start in window_starts(length, shifted):
            for i in range(WINDOW):
                shares[start + i] += tent(i) / total[start + i]
        assert all(abs(share - 1) < 1e-9 for share in shares), "blend weights sum to 1"

# A window edge inside the area must not sit in the same place on two steps running. This holds
# when the area is a whole number of strides past one window, which sample.py requires.
for length in range(WINDOW + STRIDE, 420, STRIDE):
    plain = {s for s in window_starts(length, False)} | {s + WINDOW for s in window_starts(length, False)}
    moved = {s for s in window_starts(length, True)} | {s + WINDOW for s in window_starts(length, True)}
    # Both grids keep a window against each border, so those two windows' inner edges do repeat.
    # The tent weight is lowest there, and a finished map pins neighbours across a border anyway.
    inside = (plain & moved) - {0, WINDOW, length - WINDOW, length}
    assert not inside, f"edges repeat at {sorted(inside)} for length {length}"

# A pin covers only cells whose every pixel is already drawn: a strip 40 px wide pins 2 cells, not 3.
known = [[x < 40 for x in range(4 * CELL)] for _ in range(2 * CELL)]
assert pinned_cells(known) == [[True, True, False, False]] * 2, "a part-drawn cell is not pinned"

assert SHIFT * 2 == STRIDE
print("joint sampler window maths: all properties hold")
