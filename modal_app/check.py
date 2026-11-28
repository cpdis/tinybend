"""Checks the teacher drawings a set already has, without drawing. Needs no Gemini key.

    modal run -m modal_app.check --set-name phase1-quarters
"""

import modal

from .common import failures, image, volume

app = modal.App("tinybend-check")


@app.function(image=image, volumes={"/vol": volume}, timeout=600)
def check(set_name: str) -> dict[str, str]:
    volume.reload()
    return failures(f"/vol/renders/{set_name}", f"/vol/pairs/{set_name}")


@app.local_entrypoint()
def main(set_name: str):
    failed = check.remote(set_name)
    print(f"{len(failed)} drawings fail:" if failed else "every drawing passed")
    for frame, reason in sorted(failed.items()):
        print(f"  {frame}: {reason}")
