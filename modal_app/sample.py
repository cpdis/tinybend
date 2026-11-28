"""Draws one continuous area of the map with a trained LoRA and the joint sampler.

    modal run -m modal_app.sample --name cbd --lora klein-v1-s0 --x -3200 --y -1000 --size 6400
    modal run -m modal_app.sample --name east --lora klein-v1-s0 --x 39 --y -1041 --size 3328 --pin cbd

x, y and size are in map pixels. The area's picture goes to /areas/<name>.png on the Volume,
next to the render it was drawn from and a small file with its position. With --pin, the part
that overlaps a finished area is kept exactly, and the rest is drawn to continue it. To pin to
several areas, give their names with commas between, in the order they were drawn.
--renders names another folder of shots under /renders on the Volume. The default is perth.
"""

import modal

from .common import volume
from .joint import CELL, SOFT, STRIDE, WINDOW
from .plan import SHOT, shots_under
from .train import CAPTION, MODELS, image as train_image

app = modal.App("tinyperth-sample")

image = train_image.add_local_file("modal_app/joint.py", "/root/ai-toolkit/tinyperth_joint.py")

def content_mask(x: int, y: int, size: int, renders: str):
    """White where the area has a render: under every shot of the folder that exists."""
    from pathlib import Path

    from PIL import Image

    content = Image.new("L", (size, size), 0)
    for col, row in shots_under(x, y, size):
        if Path(f"/vol/renders/{renders}/c{col}_r{row}.png").exists():
            content.paste(255, (col * SHOT - x, row * SHOT - y, col * SHOT - x + SHOT, row * SHOT - y + SHOT))
    return content


def render_area(x: int, y: int, size: int, renders: str):
    """The area's render, joined from the shots it crosses, and a mask of where it has one.

    At the map's edge an area reaches past the last shot. That part stays black and unmarked.
    renders names the folder of shots on the Volume, under /renders.
    """
    from pathlib import Path

    from PIL import Image

    area = Image.new("RGB", (size, size))
    for col, row in shots_under(x, y, size):
        shot = Path(f"/vol/renders/{renders}/c{col}_r{row}.png")
        if shot.exists():
            area.paste(Image.open(shot).convert("RGB"), (col * SHOT - x, row * SHOT - y))
    return area, content_mask(x, y, size, renders)


def fill_outside(picture, content):
    """The picture with every pixel outside the content mask filled from the nearest content.

    The model's image encoder is not local: black beside a drawing makes the drawing's edge
    encode too light. At the map's edge the render is black past the last shot, so a pin that
    runs along that edge was held about 15 levels too light, and the new drawing continued that
    wrong tone (v2_c6_r7, join step 12.5). Filling the black with the content's own colours,
    smeared outward, takes the black away. Pixels inside the content are not changed.
    The fill goes into the render, so the model also draws a continuation past the edge in
    place of black: black there still made a north-edge corner (v2_c-6_r-9) step 12.0.
    """
    import numpy as np
    from PIL import Image, ImageFilter

    known = np.asarray(content.convert("L")) > 127
    if known.all() or not known.any():
        return picture
    rgb = np.asarray(picture.convert("RGB"), dtype=np.float32)
    # Pull: halve again and again. Each pixel holds the sum of its known children's colours
    # and how many there were, so its mean colour is the one division away.
    colour, weight = rgb * known[..., None], known.astype(np.float32)
    pyramid = [(colour, weight)]
    while weight.shape != (1, 1):
        h, w = weight.shape
        colour = np.pad(colour, ((0, h % 2), (0, w % 2), (0, 0)))
        weight = np.pad(weight, ((0, h % 2), (0, w % 2)))
        colour = colour.reshape(colour.shape[0] // 2, 2, colour.shape[1] // 2, 2, 3).sum(axis=(1, 3))
        weight = weight.reshape(weight.shape[0] // 2, 2, weight.shape[1] // 2, 2).sum(axis=(1, 3))
        pyramid.append((colour, weight))
    # Push: from the coarsest level down, a pixel with no known children takes its parent's colour.
    filled = pyramid[-1][0] / pyramid[-1][1][..., None]
    for colour, weight in reversed(pyramid[:-1]):
        up = filled.repeat(2, axis=0).repeat(2, axis=1)[: weight.shape[0], : weight.shape[1]]
        filled = np.where(weight[..., None] > 0, colour / np.maximum(weight, 1e-6)[..., None], up)
    # The coarse levels leave blocks. Soften them; the known pixels go back exactly.
    smooth = np.asarray(Image.fromarray(filled.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(16)))
    return Image.fromarray(np.where(known[..., None], rgb.astype(np.uint8), smooth))


def join_check(drawn, pinned, fade) -> float:
    """How far the new drawing's brightness is from its pinned neighbours', in levels of 255.

    Deep inside a pin the sampler is told to keep the neighbour's picture, so before the
    neighbour's pixels are pasted back the two should already agree. A light band along a join
    once measured 20 here. The picture is compared in 64 px blocks that lie wholly inside the
    kept part of the pin, and the answer is the block at the 95th percentile: one bad strip
    shows, and a few odd blocks do not.
    """
    import numpy as np

    block = 64
    side = drawn.size[0] // block
    means = lambda picture: np.asarray(picture.convert("L"), dtype=np.float32)[: side * block, : side * block].reshape(side, block, side, block).mean(axis=(1, 3))
    kept = means(fade) >= 254
    if not kept.any():
        return 0.0
    return round(float(np.percentile(np.abs(means(drawn) - means(pinned))[kept], 95)), 1)


@app.function(image=image, gpu="H100", memory=32768, max_containers=10, volumes={"/vol": volume}, secrets=[modal.Secret.from_name("huggingface")], timeout=3 * 60 * 60)
def draw(name: str, lora: str, model: str, x: int, y: int, size: int, steps: int, seed: int, pin: str, renders: str = "perth") -> str:
    import json
    import subprocess
    import time
    from pathlib import Path

    import yaml

    volume.reload()  # See the areas other machines finished while this one was starting.
    out = Path("/vol/areas")
    out.mkdir(parents=True, exist_ok=True)
    render_path = out / f"{name}.render.png"
    render, content = render_area(x, y, size, renders)
    # Past the map's edge the render is black. The model then draws black there, and black
    # beside a drawing spoils how the drawing next to it is encoded and decoded. A filled render
    # gives the model a plausible continuation instead. Only the part with a render is kept.
    render = fill_outside(render, content)
    render.save(render_path)
    content_path = f"/tmp/{name}.content.png"
    content.save(content_path)

    # The overlap with each finished neighbour, pasted where it falls in this area.
    pinned_path = mask_path = None
    if pin:
        from PIL import Image, ImageChops

        # The pinned picture starts as the render, not as black. The model's image encoder is
        # not local: black next to a drawing made the drawing's edge encode about 20 levels too
        # bright, which showed as a light band along every join.
        pinned, mask = Image.open(render_path).copy(), Image.new("L", (size, size), 0)
        for neighbour in pin.split(","):
            at = json.loads((out / f"{neighbour}.json").read_text())
            box = (max(x, at["x"]), max(y, at["y"]), min(x + size, at["x"] + at["size"]), min(y + size, at["y"] + at["size"]))
            if box[0] >= box[2] or box[1] >= box[3]:
                raise RuntimeError(f"{neighbour} does not overlap this area")
            inside = (box[0] - at["x"], box[1] - at["y"], box[2] - at["x"], box[3] - at["y"])
            piece = Image.open(out / f"{neighbour}.png").convert("RGB").crop(inside)
            # A pinned neighbour copied part of its picture from its own neighbours. Only the
            # pixels it drew itself are pasted, so where two neighbours meet at a corner each
            # keeps its own blended edge. Name the neighbours in the order they were drawn.
            own = out / f"{neighbour}.own.png"
            # A neighbour at the edge of an earlier, smaller map had no render under part of
            # itself, and drew nothing there. Only the part it had a render for is pinned.
            had = content_mask(at["x"], at["y"], at["size"], at.get("renders", "perth")).crop(inside)
            pinned.paste(piece, (box[0] - x, box[1] - y), ImageChops.multiply(Image.open(own).convert("L").crop(inside), had) if own.exists() else had)
            mask.paste(had, (box[0] - x, box[1] - y), had)
        pinned_path, mask_path = f"/tmp/{name}.pinned.png", f"/tmp/{name}.mask.png"
        pinned.save(pinned_path)
        mask.save(mask_path)

    # ai-toolkit has no command that only samples. So this is a training job of zero steps that
    # starts from the finished LoRA, and its one sample is the area.
    job = {
        "job": "extension",
        "config": {
            "name": f"area-{name}",
            "process": [
                {
                    "type": "diffusion_trainer",
                    "training_folder": "/tmp/area-run",
                    "device": "cuda:0",
                    "network": {"type": "lora", "linear": 32, "linear_alpha": 32, "pretrained_lora_path": f"/vol/loras/{lora}/{lora}.safetensors"},
                    "save": {"dtype": "float16", "save_every": 100000},
                    "datasets": [{"folder_path": "/vol/train/v1/target", "control_path": ["/vol/train/v1/control"], "caption_ext": "txt", "resolution": [512]}],
                    "train": {"batch_size": 1, "steps": 0, "train_unet": True, "train_text_encoder": False, "noise_scheduler": "flowmatch", "optimizer": "adamw8bit", "lr": 1e-4, "dtype": "bf16", "cache_text_embeddings": True, "force_first_sample": True},
                    "model": {**MODELS[model], "quantize": False},
                    "sample": {
                        "sampler": "flowmatch",
                        "sample_every": 100000,
                        "width": size,
                        "height": size,
                        "samples": [{"prompt": CAPTION, "ctrl_img_1": str(render_path)}],
                        "neg": "",
                        "seed": seed,
                        "walk_seed": False,
                        "guidance_scale": 2.5,
                        "sample_steps": steps,
                    },
                }
            ],
            "meta": {"name": "[name]", "version": "1.0"},
        },
    }
    config = Path(f"/tmp/area-{name}.yaml")
    config.write_text(yaml.safe_dump(job))
    picture = out / f"{name}.png"
    if picture.exists():
        # An area is never drawn over. The sampler also reuses a finished picture when it finds
        # one, which once made three "reruns" return the first run's picture unchanged.
        raise RuntimeError(f"{name} is already drawn: choose a new name")
    # Draw on the machine's own disk, and copy to the Volume only when the picture is whole.
    scratch = Path(f"/tmp/{name}.png")
    run = (
        "import tinyperth_joint, sys\n"
        "from toolkit.job import get_job\n"
        f"tinyperth_joint.install({str(scratch)!r}, {pinned_path!r}, {mask_path!r}, {content_path!r})\n"
        f"job = get_job({str(config)!r}, None)\n"
        "job.run()\n"
        "job.cleanup()\n"
    )
    started = time.time()
    subprocess.run(["python", "-c", run], cwd="/root/ai-toolkit", check=True)
    if not scratch.exists():
        raise RuntimeError("the run ended without drawing the area")
    join_step = None
    if pin:
        # The sampler lets go of the outer 128 px of a pin so the join can settle, so those
        # pixels are the new drawing's. Deeper in, the neighbour's own pixels go back exactly,
        # with a short fade between the two. The map is assembled with later areas over
        # earlier ones, so this area's version of the overlap is the one the map shows.
        from PIL import Image, ImageChops, ImageFilter

        # Shrink the mask by the released cells plus one, worked out at one pixel per cell.
        # At full size this filter took over ten minutes of GPU time doing nothing useful.
        cells = Image.open(mask_path).resize((size // CELL, size // CELL), Image.NEAREST)
        fade = cells.filter(ImageFilter.MinFilter(2 * (SOFT + 1) + 1)).resize((size, size), Image.NEAREST).filter(ImageFilter.GaussianBlur(8))
        drawn = Image.open(scratch).convert("RGB")
        drawn.save(out / f"{name}.unpinned.png")
        join_step = join_check(drawn, Image.open(pinned_path), fade)
        drawn.paste(Image.open(pinned_path), (0, 0), fade)
        drawn.save(picture)
        # Which pixels this area drew itself: everything the fade did not give back.
        ImageChops.invert(fade).save(out / f"{name}.own.png")
    else:
        picture.write_bytes(scratch.read_bytes())
    (out / f"{name}.json").write_text(json.dumps({"x": x, "y": y, "size": size, "lora": lora, "pinned_to": pin, "renders": renders, "join_step": join_step}))
    volume.commit()
    return f"{name}: {size} px drawn in {(time.time() - started) / 60:.1f} minutes, join step {join_step}"


@app.local_entrypoint()
def main(name: str, lora: str, x: int, y: int, size: int, model: str = "klein", steps: int = 25, seed: int = 0, pin: str = "", renders: str = "perth"):
    # The shifted grid only moves every window edge when the area is whole strides past one window.
    cells = size // CELL
    if size % CELL or (cells - WINDOW) % STRIDE:
        raise SystemExit(f"size must be {WINDOW * CELL} plus a multiple of {STRIDE * CELL} px")
    print(draw.remote(name, lora, model, x, y, size, steps, seed, pin, renders))
