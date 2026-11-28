"""Draws the whole map, area by area, on up to ten GPUs at once.

    modal run --detach -m modal_app.map_run::run --lora klein-v1-s0 --usage-limit 200 --spend-limit 200 --budget 5 --waves 1 --limit 1
    modal run --detach -m modal_app.map_run::run --lora klein-v1-s0 --usage-limit 200 --spend-limit 200
    modal run --detach -m modal_app.map_run::run --lora klein-v1-s0 --usage-limit 200 --spend-limit 200 --version v2 --renders greater --after v1

The job lists the areas, then works in waves. A wave is a set of areas that do not overlap
each other, so they can be drawn at the same time. Each is pinned to every finished area it
overlaps. The job can be stopped and started again: finished areas are never redrawn.

/areas/map-<version>.order.json on the Volume lists the finished areas in the order they were
drawn. The assembler needs that order.

Two guards stop a run early. The run has a budget in dollars, and a wave that could pass it is
not started. The budget comes from Modal itself: the job reads this month's usage and charges
with `modal billing summary`, takes them from --usage-limit and --spend-limit (typed in from
the billing page, which is the only place Modal shows them), and keeps a margin. --budget can
make it smaller. Modal stops every machine at once when either limit is reached.
And if any area of a wave fails, or joins its neighbours with a brightness step over
JOIN_LIMIT, no further wave starts.

A larger map is a new version on the same grid. --renders names its folder of shots, which
holds the earlier map's shots too. --after names the earlier version: its areas count as
finished, and its order list starts the new one. Areas the earlier map drew whole are not
drawn again. Its part-drawn edge areas are drawn again under the new version's name.
"""

import modal

from .common import volume
from .plan import grid, next_wave, pins
from .sample import app, draw

# Areas drawn before this job existed. They are pinned to like any other finished area.
SEED = ["city", "b2-east", "b2-south", "b2-corner"]
# Dollars for one whole area: 28 minutes of H100 at $3.95 an hour, plus start-up. A wave is
# costed as if every area were whole, so the budget errs on the safe side.
AREA_COST = 2.1
# Brightness levels (of 255) an area may differ from its pinned neighbours. Good joins measure
# under 3. The light-band fault measured 20.
JOIN_LIMIT = 8


# Not preemptible: Modal may stop and restart an ordinary function at any time. That happened
# to this job in its first real phase. The restarted job had forgotten what it had spent.
@app.function(volumes={"/vol": volume}, timeout=20 * 60 * 60, nonpreemptible=True)
def draw_map(lora: str, waves: int, limit: int, version: str, renders: str, after: str, budget: float, run_id: str) -> str:
    import json
    import re
    import time
    from pathlib import Path

    def shots_in(folder: str) -> set[tuple[int, int]]:
        return {(int(m[1]), int(m[2])) for m in (re.fullmatch(r"c(-?\d+)_r(-?\d+)\.png", p.name) for p in Path(f"/vol/renders/{folder}").iterdir()) if m}

    order_path = Path(f"/vol/areas/map-{version}.order.json")
    if order_path.exists():
        order = json.loads(order_path.read_text())
    elif after:
        order = json.loads(Path(f"/vol/areas/map-{after}.order.json").read_text())
    else:
        order = list(SEED)
    # Areas drawn again to fix a fault, as {"old": "new"} in map-<version>.redrawn*.json. Files
    # on the Volume are never overwritten, so the new picture gets its own name, and each new
    # list its own file. A new picture goes right after the old one in the order: the assembler
    # pastes it over the old, and later areas pin to both in that order, so the new one wins.
    for redrawn_path in sorted(Path("/vol/areas").glob(f"map-{version}.redrawn*.json")):
        for old, new in json.loads(redrawn_path.read_text()).items():
            if new not in order:
                order.insert(order.index(old) + 1, new)
    # The earlier map's shots: the folder its areas were drawn from, as their position files say.
    earlier = None
    if after:
        last = json.loads(Path(f"/vol/areas/map-{after}.order.json").read_text())[-1]
        earlier = shots_in(json.loads(Path(f"/vol/areas/{last}.json").read_text()).get("renders", "bend"))
    areas = grid(shots_in(renders), version, earlier)
    started_with = len([name for name in order if name.startswith(f"{version}_")])
    failures: dict[str, int] = {}
    # What this run has spent and which areas it has sent out, kept on the Volume. If the job
    # is restarted all the same, it carries on from this record and not from zero.
    record_path = Path(f"/vol/areas/map-{version}.run-{run_id}.json")
    record = json.loads(record_path.read_text()) if record_path.exists() else {"spent": 0.0, "sent": []}
    spent, stopped = record["spent"], ""
    # Areas a stopped job sent out may still be drawing. Wait for them; never send one twice.
    for _ in range(90):
        volume.reload()
        if all(Path(f"/vol/areas/{name}.json").exists() for name in record["sent"]):
            break
        time.sleep(30)

    for wave_number in range(1, waves + 1):
        volume.reload()
        # A finished area has its position file. If the job was stopped mid-wave, an area can
        # be finished but missing from the order list. It joins the list here. That is safe:
        # the areas of one wave never overlap, so their order among themselves does not matter.
        for area in areas:
            if area["name"] not in order and Path(f"/vol/areas/{area['name']}.json").exists():
                order.append(area["name"])
        drawn = [{"name": name, **json.loads(Path(f"/vol/areas/{name}.json").read_text())} for name in order]
        pending = [a for a in areas if a["name"] not in order and failures.get(a["name"], 0) < 2]
        if not pending:
            break
        wave = next_wave(pending, limit)
        if spent + len(wave) * AREA_COST > budget:
            stopped = f"stopped before wave {wave_number}: it could cost ${len(wave) * AREA_COST:.0f} and ${budget - spent:.0f} of the budget is left"
            break
        spent += len(wave) * AREA_COST
        record_path.write_text(json.dumps({"spent": spent, "sent": [a["name"] for a in wave]}))
        volume.commit()
        print(f"wave {wave_number}: {', '.join(a['name'] for a in wave)}", flush=True)
        jobs = [(a["name"], lora, "klein", a["x"], a["y"], a["size"], 25, 0, ",".join(pins(a, drawn)), renders) for a in wave]
        results = list(draw.starmap(jobs, return_exceptions=True))
        volume.reload()  # See the position files the drawing machines wrote, for their join steps.
        for area, result in zip(wave, results):
            if isinstance(result, Exception):
                failures[area["name"]] = failures.get(area["name"], 0) + 1
                print(f"FAILED {area['name']}: {result!r}", flush=True)
            else:
                order.append(area["name"])
                print(result, flush=True)
                step = json.loads(Path(f"/vol/areas/{area['name']}.json").read_text()).get("join_step") or 0
                if step > JOIN_LIMIT:
                    stopped = f"stopped after wave {wave_number}: {area['name']} joins its neighbours with a step of {step} levels"
            if failures.get(area["name"]):
                stopped = stopped or f"stopped after wave {wave_number}: {area['name']} failed"
        order_path.write_text(json.dumps(order))
        volume.commit()
        if stopped:
            break

    left = [a["name"] for a in areas if a["name"] not in order]
    done = len([name for name in order if name.startswith(f"{version}_")])
    return f"{done} of {len(areas)} areas drawn ({done - started_with} in this run); {len(left)} left; about ${spent:.0f} of ${budget:.0f} used. {stopped or "No guard stopped the run."}"


def room(usage_limit: float, spend_limit: float) -> tuple[float, float, float]:
    """This month's usage and charges, read from Modal, and the dollars left under both limits.

    Modal has two limits. The usage limit counts all usage, free credit included. The spend
    limit counts only what is charged. Modal stops every machine at once when either is
    reached. The CLI reports usage and charges but not the limits, so those are typed in from
    the billing page.
    """
    import json
    import subprocess

    summary = json.loads(subprocess.run(["modal", "billing", "summary", "--json"], check=True, capture_output=True, text=True).stdout)
    usage, charges = float(summary["metered_cost"]), float(summary["billed_cost"])
    return usage, charges, min(usage_limit - usage, spend_limit - charges)


@app.local_entrypoint()
def run(lora: str, usage_limit: float, spend_limit: float, budget: float = 0, margin: float = 10, waves: int = 100, limit: int = 10, version: str = "v1", renders: str = "bend", after: str = ""):
    # The budget is the room under Modal's limits less a margin, or --budget if that is smaller.
    usage, charges, left = room(usage_limit, spend_limit)
    allowed = left - margin
    budget = min(budget, allowed) if budget else allowed
    print(f"Modal this month: usage ${usage:.2f} of ${usage_limit:.0f}, charges ${charges:.2f} of ${spend_limit:.0f}. Room ${left:.2f}, margin ${margin:.0f}, budget for this run ${budget:.2f}.")
    if budget < AREA_COST:
        raise SystemExit("No room for one area under Modal's limits. Raise a limit, or wait for the next month.")
    import time

    print(draw_map.remote(lora, waves, limit, version, renders, after, budget, time.strftime("%Y%m%d-%H%M%S")))
    after_usage, after_charges, _ = room(usage_limit, spend_limit)
    print(f"This run cost ${after_usage - usage:.2f} by Modal's own figures (they can lag by some minutes). Usage is now ${after_usage:.2f}, charges ${after_charges:.2f}.")
