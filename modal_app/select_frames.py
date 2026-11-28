"""Picks the general training frames: groups every candidate quarter by how it looks, then
takes the same number from each group, so rare looks get as many examples as common ones.

    node places/candidates.js render/frames/perth.json places/quarter-candidates.json
    modal run -m modal_app.select_frames

Writes places/general-frames.json on the Mac, and a sheet per group on the Volume in /sets/v1.
"""

import json
from pathlib import Path

import modal

from .common import volume

app = modal.App("tinyperth-select-frames")

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "torch==2.9.1", "transformers==4.57.1", "pillow==12.0.0", "scikit-learn==1.7.2", "numpy==2.3.4"
)

GROUPS = 30  # Look groups. With 5 frames each this gives the plan's 150 general frames.
PER_GROUP = 5
SHOT = 2048
SEED = 0  # Fixed, so a rerun picks the same frames.


@app.function(image=image, gpu="T4", volumes={"/vol": volume}, timeout=60 * 60)
def select(candidates: list[dict]) -> dict:
    import numpy as np
    import torch
    from PIL import Image
    from sklearn.cluster import KMeans
    from transformers import AutoImageProcessor, AutoModel

    # DINOv2 turns an image into a list of numbers that are close for images that look alike.
    # It was trained without labels, so it groups by appearance, not by named things.
    processor = AutoImageProcessor.from_pretrained("facebook/dinov2-small")
    model = AutoModel.from_pretrained("facebook/dinov2-small").cuda().eval()

    by_shot: dict[str, list[dict]] = {}
    for c in candidates:
        by_shot.setdefault(c["shot"], []).append(c)

    vectors, order, thumbs = [], [], {}
    for n, (shot, frames) in enumerate(sorted(by_shot.items())):
        col, row = (int(v[1:]) for v in shot.split("_"))
        picture = Image.open(f"/vol/renders/perth/{shot}.png").convert("RGB")
        crops = []
        for f in frames:
            left, top = f["x"] - col * SHOT, f["y"] - row * SHOT
            crop = picture.crop((left, top, left + f["size"], top + f["size"]))
            crops.append(crop)
            thumbs[f["id"]] = crop.resize((128, 128))
        with torch.no_grad():
            inputs = processor(images=crops, return_tensors="pt").to("cuda")
            vectors.append(model(**inputs).pooler_output.cpu().numpy())
        order.extend(frames)
        if n % 100 == 0:
            print(f"{n} of {len(by_shot)} shots embedded")

    vectors = np.concatenate(vectors)
    groups = KMeans(n_clusters=GROUPS, random_state=SEED, n_init=10).fit_predict(vectors)

    rng = np.random.default_rng(SEED)
    chosen, sizes = [], []
    out = Path("/vol/sets/v1")
    out.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGB", (PER_GROUP * 128 + 8 * 128 + 24, GROUPS * 128), "#14181c")
    for g in range(GROUPS):
        members = np.flatnonzero(groups == g)
        sizes.append(int(len(members)))
        picked = rng.choice(members, size=min(PER_GROUP, len(members)), replace=False)
        chosen.extend({**order[i], "group": g} for i in picked)
        # The sheet shows the 5 picked frames, a gap, then 8 more from the group for comparison.
        others = rng.choice(members, size=min(8, len(members)), replace=False)
        for k, i in enumerate(picked):
            sheet.paste(thumbs[order[i]["id"]], (k * 128, g * 128))
        for k, i in enumerate(others):
            sheet.paste(thumbs[order[i]["id"]], (PER_GROUP * 128 + 24 + k * 128, g * 128))
    sheet.save(out / "general-groups.webp", quality=80)
    (out / "general-frames.json").write_text(json.dumps(chosen))
    volume.commit()
    return {"frames": chosen, "group_sizes": sizes, "embedded": len(order)}


@app.local_entrypoint()
def main():
    candidates = json.loads(Path("places/quarter-candidates.json").read_text())
    result = select.remote(candidates)
    frames = [{k: f[k] for k in ("id", "x", "y", "size", "group")} for f in result["frames"]]
    Path("places/general-frames.json").write_text(json.dumps(frames) + "\n")
    print(f"{result['embedded']} quarters embedded, {len(frames)} frames picked")
    print("group sizes:", sorted(result["group_sizes"], reverse=True))
