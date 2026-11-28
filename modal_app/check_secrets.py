"""Checks the Hugging Face secret from inside Modal, without ever printing the token.

    modal run -m modal_app.check_secrets
"""

import modal

app = modal.App("tinyperth-check-secrets")

# One small file from each model the Phase 2 race needs. A gated model answers 401 or 403 until
# its terms are accepted on its Hugging Face page.
MODEL_FILES = {
    "Qwen/Qwen-Image-Edit-2511": "model_index.json",
    "black-forest-labs/FLUX.2-klein-4B": "model_index.json",
    "black-forest-labs/FLUX.2-klein-base-4B": "model_index.json",
}


@app.function(secrets=[modal.Secret.from_name("huggingface")])
def check() -> dict[str, str]:
    import os
    import urllib.error
    import urllib.request

    token = os.environ.get("HF_TOKEN")
    if not token:
        return {"HF_TOKEN": "missing: the secret has no key with this name"}

    def status(url: str) -> str:
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}, method="HEAD")
        try:
            with urllib.request.urlopen(request) as response:
                return str(response.status)
        except urllib.error.HTTPError as error:
            return str(error.code)

    results = {"token accepted by Hugging Face": status("https://huggingface.co/api/whoami-v2")}
    for repo, file in MODEL_FILES.items():
        results[repo] = status(f"https://huggingface.co/{repo}/resolve/main/{file}")
    return results


@app.local_entrypoint()
def main():
    for name, result in check.remote().items():
        print(f"{name}: {result}")
