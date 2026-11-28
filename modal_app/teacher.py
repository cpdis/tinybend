"""Teacher drawings on Modal: draw every frame of a set, check each drawing, redraw the failures.

Prepare a set on the Mac, then run it:

    node look/quarters.js render/out/phase1 look/out/quarters-in
    node look/water.js look/out/quarters-in
    modal volume put tinybend look/out/quarters-in /renders/phase1-quarters
    modal run --detach -m modal_app.teacher --set-name phase1-quarters

The drawing and checking code is the same Node code that Phase 1 ran on the Mac (look/draw.js
and look/check.js), so a drawing passes or fails here exactly as it does there.
"""

import modal

from .common import MAX_REDRAWS, TEACHER_VARIANT as VARIANT, failures, image, node, volume

app = modal.App("tinybend-teacher")


@app.function(image=image, volumes={"/vol": volume}, secrets=[modal.Secret.from_name("gemini")], timeout=4 * 60 * 60)
def teach(set_name: str) -> dict[str, str]:
    """Draws every missing frame, then redraws failures. A rerun skips frames that already passed."""
    from pathlib import Path

    renders, pairs = f"/vol/renders/{set_name}", f"/vol/pairs/{set_name}"
    rejected = Path(pairs, "rejected")
    failed: dict[str, str] = {}
    for attempt in range(MAX_REDRAWS + 1):
        node("look/draw.js", renders, pairs, "--variant", VARIANT)
        failed = failures(renders, pairs)
        if not failed or attempt == MAX_REDRAWS:
            break
        # Nothing on the Volume is deleted: a rejected drawing moves aside with its reason, and
        # draw.js then sees the frame as missing and draws it again.
        rejected.mkdir(parents=True, exist_ok=True)
        for frame, reason in failed.items():
            for file in Path(pairs).glob(f"{frame}.{VARIANT}.*"):
                file.rename(rejected / f"{file.stem}.try{attempt}{file.suffix}")
            (rejected / f"{frame}.{VARIANT}.try{attempt}.reason.txt").write_text(reason + "\n")
        volume.commit()
    volume.commit()
    return failed


@app.local_entrypoint()
def main(set_name: str):
    failed = teach.remote(set_name)
    print(f"{len(failed)} drawings still fail:" if failed else "every drawing passed")
    for frame, reason in sorted(failed.items()):
        print(f"  {frame}: {reason}")
