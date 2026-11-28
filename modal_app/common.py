"""What every Tiny Bend job on Modal shares: the Volume, the Node image and the drawing checks."""

import modal

volume = modal.Volume.from_name("tinybend", create_if_missing=False)

# Node for look/*.js, with sharp where those scripts look for it (../render/node_modules).
image = (
    modal.Image.from_registry("node:22-slim", add_python="3.12")
    .run_commands("mkdir -p /app/render && cd /app/render && npm install sharp@0.35.5")
    .add_local_dir("look", "/app/look", ignore=["out"])
)

TEACHER_VARIANT = "k"  # Colin's choice on 2026-11-11. Keep in step with TEACHER_VARIANT in look/prompts.js.
MAX_REDRAWS = 3  # PLAN.md, Phase 2 step 4: redraw each rejected frame up to 3 times.


def node(*args: str) -> str:
    """Run one of the look/ scripts and return what it printed. A failed script stops the job."""
    import subprocess

    done = subprocess.run(["node", *args], cwd="/app", capture_output=True, text=True)
    print(done.stdout, done.stderr, sep="")
    done.check_returncode()
    return done.stdout


def failures(renders: str, pairs: str) -> dict[str, str]:
    """Check every drawing in the set. Returns each failed frame with its reason."""
    failed = {}
    for row in node("look/check.js", "check", renders, pairs).splitlines()[1:]:
        path, *_, verdict = row.split("\t")
        if verdict != "ok":
            failed[path.rsplit("/", 1)[-1].split(".")[0]] = verdict
    return failed
