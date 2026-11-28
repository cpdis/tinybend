"""The plan for drawing the whole map: which areas, and which can be drawn at the same time.

Plain Python with no GPU or Modal code, so it can be tested and costed on a laptop.
An area is a dict with name, x, y and size, in map pixels.
"""

SHOT = 2048  # Shot size in the full render. Shot c{col}_r{row} covers x from col * SHOT.
AREA = 9472  # One area: 1,024 px plus eleven strides of 768 px. About 2.8 km.
OVERLAP = 1024  # Neighbouring areas share this much, and the later one is pinned to it.
ORIGIN = (-5335, -1041)  # The city area's corner. The grid is laid out from here.


def shots_under(x: int, y: int, size: int) -> list[tuple[int, int]]:
    """The (col, row) of every shot position an area touches."""
    return [(col, row) for row in range(y // SHOT, (y + size - 1) // SHOT + 1) for col in range(x // SHOT, (x + size - 1) // SHOT + 1)]


def overlap(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["size"] and b["x"] < a["x"] + a["size"] and a["y"] < b["y"] + b["size"] and b["y"] < a["y"] + a["size"]


def grid(shots: set[tuple[int, int]], prefix: str = "v1", earlier: set[tuple[int, int]] | None = None) -> list[dict]:
    """Every grid area that has at least one rendered shot under it, nearest the origin first.

    earlier is the shot set of a map already drawn on the same grid. An area is left out when
    that map drew all of it: every shot position under it is in earlier. An area the earlier
    map drew only in part, at its edge, stays in. It is drawn again under the new prefix,
    pinned to the part that exists.
    """
    step = AREA - OVERLAP
    cols = [c * SHOT for c, _ in shots]
    rows = [r * SHOT for _, r in shots]
    areas = []
    for j in range((min(rows) - ORIGIN[1]) // step - 1, (max(rows) + SHOT - ORIGIN[1]) // step + 1):
        for i in range((min(cols) - ORIGIN[0]) // step - 1, (max(cols) + SHOT - ORIGIN[0]) // step + 1):
            x, y = ORIGIN[0] + i * step, ORIGIN[1] + j * step
            under = shots_under(x, y, AREA)
            if earlier is not None and all(shot in earlier for shot in under):
                continue
            if any(shot in shots for shot in under):
                areas.append({"name": f"{prefix}_c{i}_r{j}", "x": x, "y": y, "size": AREA, "ring": max(abs(i), abs(j))})
    return sorted(areas, key=lambda a: (a["ring"], a["name"]))


def next_wave(pending: list[dict], limit: int) -> list[dict]:
    """The areas to draw now: taken in order, skipping any that overlaps one already taken.

    Two areas that overlap must not be drawn at the same time, because the later one has to
    be pinned to the earlier one's finished pixels.
    """
    wave = []
    for area in pending:
        if len(wave) < limit and not any(overlap(area, taken) for taken in wave):
            wave.append(area)
    return wave


def pins(area: dict, drawn: list[dict]) -> list[str]:
    """The finished areas this one overlaps, in the order they were drawn."""
    return [d["name"] for d in drawn if overlap(area, d)]
