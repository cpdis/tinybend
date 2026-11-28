"""First run on Modal: proves the account, the Volume and a rented GPU all work.

    modal run modal_app/hello.py
"""

import modal

app = modal.App("tinyperth-hello")

# The shared disk for renders, pairs, LoRAs and tiles. See PLAN.md, "Modal setup".
volume = modal.Volume.from_name("tinyperth", create_if_missing=True)


@app.function(volumes={"/vol": volume})
def write_note() -> str:
    """Runs on a small CPU machine: writes a file to the Volume and reads it back."""
    import platform
    from pathlib import Path

    note = Path("/vol/hello.txt")
    note.write_text(f"written from Modal on Python {platform.python_version()}\n")
    volume.commit()
    return note.read_text().strip()


@app.function(gpu="H100")
def gpu_name() -> str:
    """Runs on one rented H100 for a few seconds and reports what the machine sees."""
    import subprocess

    query = ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"]
    return subprocess.run(query, capture_output=True, text=True, check=True).stdout.strip()


@app.local_entrypoint()
def main():
    print("volume:", write_note.remote())
    print("gpu:", gpu_name.remote())
