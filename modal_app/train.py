"""Trains one LoRA on the teacher pairs with ai-toolkit, on a rented GPU.

    modal volume put tinybend look/out/train/v1 /train/v1
    modal run --detach -m modal_app.train --name klein-v1-s0 --steps 2000

Outputs go to /loras/<name> on the Volume: checkpoints, and a drawing of each held-out sample
frame at every checkpoint. A rerun with the same name carries on from its last checkpoint.
"""

import modal

from .common import volume

app = modal.App("tinybend-train")

AI_TOOLKIT_COMMIT = "4a7f285"  # Pinned, so a rerun months later trains with the same code.
CAPTION = "redraw the image as <isometric bend pixel art>"  # Keep in step with look/trainset.js.

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0", "ffmpeg")
    .run_commands(
        "git clone https://github.com/ostris/ai-toolkit /root/ai-toolkit",
        f"cd /root/ai-toolkit && git checkout {AI_TOOLKIT_COMMIT}",
        "pip install --no-cache-dir torch==2.13.0 torchvision==0.28.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu130",
        "cd /root/ai-toolkit && pip install --no-cache-dir -r requirements.txt",
    )
    # Model files download once to the Volume, not into every new machine.
    .env({"HF_HOME": "/vol/weights/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1", "DISABLE_TELEMETRY": "YES"})
)

# What changes between the models in the race. The arch names are ai-toolkit's.
MODELS = {
    "klein": {"name_or_path": "black-forest-labs/FLUX.2-klein-base-4B", "arch": "flux2_klein_4b"},
}


def config(name: str, model: str, train_set: str, steps: int, seed: int, sample_every: int) -> dict:
    """The ai-toolkit job, as data. PLAN.md, Phase 2 step 5 has the reasons for each setting."""
    from pathlib import Path

    data = f"/vol/train/{train_set}"
    samples = sorted(Path(data, "samples").glob("*.png"))
    return {
        "job": "extension",
        "config": {
            "name": name,
            "process": [
                {
                    "type": "diffusion_trainer",
                    "training_folder": "/vol/loras",
                    "device": "cuda:0",
                    "network": {"type": "lora", "linear": 32, "linear_alpha": 32},
                    "save": {"dtype": "float16", "save_every": sample_every, "max_step_saves_to_keep": 20},
                    "datasets": [
                        {
                            "folder_path": f"{data}/target",
                            "control_path": [f"{data}/control"],
                            "caption_ext": "txt",
                            "caption_dropout_rate": 0.0,
                            "resolution": [512, 1024],
                        }
                    ],
                    "train": {
                        "batch_size": 1,
                        "steps": steps,
                        "gradient_accumulation": 1,
                        "timestep_type": "weighted",
                        "train_unet": True,
                        "train_text_encoder": False,
                        "gradient_checkpointing": True,
                        "noise_scheduler": "flowmatch",
                        "optimizer": "adamw8bit",
                        "lr": 1e-4,
                        "dtype": "bf16",
                        "cache_text_embeddings": True,
                    },
                    "model": {**MODELS[model], "quantize": False},
                    "sample": {
                        "sampler": "flowmatch",
                        "sample_every": sample_every,
                        "width": 1024,
                        "height": 1024,
                        "samples": [{"prompt": CAPTION, "ctrl_img_1": str(path)} for path in samples],
                        "neg": "",
                        "seed": seed,
                        "walk_seed": False,
                        "guidance_scale": 2.5,
                        "sample_steps": 25,
                    },
                }
            ],
            "meta": {"name": "[name]", "version": "1.0"},
        },
    }


@app.function(image=image, gpu="H100", volumes={"/vol": volume}, secrets=[modal.Secret.from_name("huggingface")], timeout=6 * 60 * 60)
def train(name: str, model: str, train_set: str, steps: int, seed: int, sample_every: int) -> str:
    import subprocess
    import time
    from pathlib import Path

    import yaml

    job = config(name, model, train_set, steps, seed, sample_every)
    path = Path(f"/tmp/{name}.yaml")
    path.write_text(yaml.safe_dump(job))
    started = time.time()
    # The trainer prints its own progress. A failure here stops the job with its error.
    subprocess.run(["python", "run.py", str(path)], cwd="/root/ai-toolkit", check=True)
    volume.commit()
    minutes = (time.time() - started) / 60
    return f"{name}: {steps} steps in {minutes:.1f} minutes ({minutes * 60 / steps:.2f} s a step, model load included)"


@app.local_entrypoint()
def main(name: str, model: str = "klein", train_set: str = "v1", steps: int = 2000, seed: int = 0, sample_every: int = 250):
    print(train.remote(name, model, train_set, steps, seed, sample_every))
