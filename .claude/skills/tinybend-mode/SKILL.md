---
name: tinybend-mode
description: Tiny Bend's working mode. poteto-mode from pstack, with routing, spend gates, proof standards, originality rules and the write-up journal for building the isometric pixel-art map of Bend and Mt. Bachelor, in summer and winter, and its how-it-was-made write-up. Use for /tinybend-mode, or any non-trivial task in this repo.
disable-model-invocation: true
---

# Tiny Bend mode

This mode is pstack's `poteto-mode` with project overrides. It does not replace it.

The project ships two things. One is the map: Bend and a Mt. Bachelor patch on one camera and grid, with a relief chart between them, drawn in summer and in winter (a second LoRA that repaints the summer map), with a Summer, Winter and Live toggle. The other is a write-up of how the map was made, with the same scope as the tiny.london write-up: the method, the numbers, the costs, and what went wrong. Every task serves one or both.

## 1. Load poteto-mode first

Read pstack's `poteto-mode` in full. It is at `~/.claude/plugins/cache/cursor-plugins/pstack/<version>/skills/poteto-mode/SKILL.md`. If you can't find it, run `find ~/.claude/plugins -path '*skills/poteto-mode/SKILL.md'`. If pstack is not installed, say so in one line and point the user at `docs/pstack.md`. Then carry on with this file and `CLAUDE.md`.

pstack is written for Cursor. Read its `docs/harness/claude-code.md` once per session and map every Cursor name with it. Skip Cursor-only steps with the one-line note that file describes.

Follow poteto-mode in everything below that this file does not override. Where they differ, this file wins. `CLAUDE.md` wins over both.

## 2. Ground every task in the plan

`PLAN.md` is the plan of record. Read the phase the task belongs to before you start. Restate the user's goal in terms of that phase, such as "Phase 2, step 4: teacher pairs for set v1".

If the task contradicts the plan, say which line it contradicts and ask whether to update `PLAN.md`. Do not quietly diverge. When a task changes a number or a decision in the plan, update `PLAN.md` in the same PR.

If the task finishes a plan step, it also adds an entry to `writeup/journal.md` (section 6).

## 3. Route tinybend work to a playbook

Pick the row that matches, then open that playbook in poteto-mode and copy its steps into the todo list as poteto-mode says. The domain notes add to the playbook's steps. They don't replace any.

| Work | Playbook | Domain notes |
| --- | --- | --- |
| Phase 1 look directions (summer), winter step 1 | Prototype | Render every direction for all four test frames (downtown and the river, ponderosa forest, lava or rimrock, Bachelor) on one contact sheet with a switcher. Winter variants repaint the chosen summer drawings. The pick is Colin's taste call. Ask it once, with the sheet. |
| Renderer in `render/` | Feature | The camera is data in `cities/bend.json` (tilt 45°, yaw 15°, 0.293 m per pixel, origin downtown at 1,085 m), mirrored in `render/camera.js`. Each shot's ground and depth range come from the DEM (`render/grid.js`, `render/dem.js`). Every shot writes colour, depth and a camera sidecar from the same frame. Proof is two adjacent shots that line up to the pixel, depth edges on the colour edges, zero clamped depth on Bachelor shots, and one known height in metres (Pilot Butte's summit). |
| `places/bend.json` | Feature | `kind` is a closed set: `landmark`, `hard`, `test`. Ship a validator script with the file (build-the-lever). The validator fails if a `test` place falls inside any training frame. |
| Teacher prompts and checks | Hillclimb | Metric: share of teacher drawings that pass the automatic checks on a frozen frame set. The test places are never in that set. Log attempts in a gitignored `decision.tsv`. |
| LoRA versions (summer and winter) | Hillclimb | Judge each version on the five test places and two landmarks, side by side with the previous version and the render (summer) or the summer drawing (winter). Winter also passes the outline check against summer. A number alone never accepts a LoRA. |
| Joint sampler | Feature, then architect and interrogate | Hardest-tasks model. Property tests for the tent weights (they sum to 1 everywhere), the shifted grid (no window edge repeats on consecutive steps) and pinning (pinned pixels never change). |
| Whole-map generation | Autonomous run | Every block checkpoints to the Modal Volume. A rerun skips finished blocks (make-operations-idempotent). Start it with `modal run --detach`. |
| Landmark, water or snow repair | Bug fix | The repro is the map crop next to the render. The fix is proven by the same crop after the repair, with no seam. |
| Tiles and website | Feature | Verify in a real browser at phone and desktop widths. Use the verification skill once it exists (section 7). |
| A whole phase, or several PRs | Multi-phase plan | Start from the phase in `PLAN.md`. Don't write a second plan that competes with it. |
| "Run Phase N" over many sessions | Orchestrate | Spend gates in section 4 still stop the run. |
| Write-up drafts and edits | technical-writing, then unslop | Explanation mode. Build it only from the journal, the ledger and saved images (section 6). |

## 4. Spend and safety gates

These extend poteto-mode's **Always pause** list. Each one needs a yes from the user for that specific run. A yes on one run does not cover the next.

- Any paid run whose estimate is over **$10 USD**: a Modal GPU job, a Gemini batch, or anything else billed per use. State the estimate and how you got it (calls × price, or GPU-hours × rate) before you ask.
- Creating or changing a Google Cloud project, a billing link, an API key, or a quota.
- Writing to the public R2 bucket, or deploying the website to production.
- Deleting anything from the Modal Volume or R2. Versions are never overwritten. A fix ships as a new version or a patch folder.
- Approving or rejecting a landmark pair, for each season. That is Colin's call, recorded in `places/bend.json`.
- Creating or changing a Modal Volume or secret, an R2 bucket or token, a Vercel project, or a domain.
- Moving a test place into a training set.

Proceed without asking on local work, CPU Modal jobs, and paid runs estimated at $10 or less. Report each paid run's actual cost when it finishes.

Record every paid run as one row in `runs/ledger.tsv`: date, job, command, estimate, actual, outcome. Create the file on the first paid run. This is how the plan's budget (about $225 to $300 for both seasons) is tracked, so keep it current. Each drawing phase also needs room under both Modal limits (the usage cap and the card spend limit), with a $5 to $10 margin: check both before asking.

## 5. Proof standards

These make poteto-mode's **prove-it-works** concrete for an image pipeline.

- An image claim is proven with images. Save a contact sheet (render, output and, when it applies, the previous version) to the Volume. Put a downscaled copy, or a link to it, in the PR.
- A number is proven with **explain-the-number**. Say what set it ran on, how many frames, and what limits it. An acceptance rate on 12 frames is a guess, not a result.
- Held-out means held out. Results on training frames don't count as evidence for a LoRA.
- A Modal job is done when its outputs exist on the Volume and you have looked at a sample. A green exit code is not enough.
- A website change is done when a screenshot shows it working in a real browser.
- A write-up claim is proven by its source: a journal entry, a ledger row, or a saved image. A claim with no source comes out.

## 6. The write-up

The write-up is written from evidence gathered while the map is built. Reconstructing it at the end loses the failures, which are the most useful part. So the evidence is captured as you go.

**The journal.** `writeup/journal.md` gets one entry per finished plan step, in the PR that finishes it. An entry has the date, the plan step, what was tried, what failed and why, the numbers (set sizes, acceptance rates, GPU-hours), the cost from `runs/ledger.tsv`, and the images that show it. Keep entries factual and short. They are notes for the write-up, not the write-up.

**Write for a first-timer.** Colin learnt this pipeline on Tiny Perth; the post is for readers new to 3D rendering, model training, LoRAs, Modal and GPUs, and should show how each step works and how many moving parts there are. So every entry also has an "In plain words" part. It says what the step does and why it is needed, and it defines each new term the first time it appears (such as LoRA, H100, Volume or inpainting).

**Capture visuals during the work.** Before and during each step, list what can only be captured then, and capture it. A step isn't finished until its entry has its visuals:

- **Setup:** screenshots of consoles and dashboards (Modal, Google Cloud, AI Studio), and terminal output of the first working run. Cover account numbers, keys, email addresses and unrelated project names before you save them.
- **Diagrams:** a concrete diagram with real numbers for each new moving part. Extend `writeup/images/phase1-explained/pipeline.svg` as phases finish, and change its boxes from planned to done with real numbers.
- **Results:** before and after images, contact sheets, and rejected outputs with the reason.
- **Training:** a loss curve, samples at each saved step on the same frames, GPU type, time and cost.
- **Failures:** the error message or the bad image, and what fixed it.

If a useful visual needs the user, such as a screen behind their sign-in, ask for it while that screen is in front of them.

**Images.** Save the images an entry needs to `writeup/images/<step>/`, as WebP no wider than 1,600 px and under 500 KB each. Good candidates are render and drawing pairs, rejected drawings with their failure reason, LoRA samples by version, seams before and after, and test-place comparisons. Full-size originals stay on the Modal Volume.

**The PR rule.** Every PR body has a `Write-up` line. It names the journal entry the PR adds, or says `none` with a reason, such as "tooling only". This puts the rule in structure, per **encode-lessons-in-structure**.

**The write-up itself.** `writeup/how.md` becomes the website's "how it was made" page in Phase 4. Draft it once Phase 2 has results, and revise it as each phase lands. Cover the method, why each choice was made, the numbers and costs, what failed, and the credits. Write it in our own words with our own images. The tiny.london write-up is a model for scope and candour. Don't copy its text, structure or figures. Credit it, isometric.nyc and the other write-ups in `PLAN.md` by name.

## 7. Look and originality

The target look is tiny.london's, adapted to Bend's own buildings and landscape: ponderosa canopy, juniper and sagebrush, black basalt and red cinder, the Deschutes, ski runs, and in winter a fresh storm's snow. The style has to stretch to cover them. The hard-places table in `PLAN.md` lists the types that need it.

- Study tiny.london closely to pin the look down: palette, light direction, line weight, pixel size, dithering, and how it draws roofs, trees, water and roads. Write what you find into the teacher prompt as instructions on how to draw. Sampling its colours for the palette is fine.
- Keep a few tiny.london screenshots locally to compare our drawings against by eye. Don't commit them.
- `look/style-reference.jpeg` (Bend's, once Phase 1 is picked; Perth's was not copied) is the Phase 1 drawing Colin picked as the picture of the target look. People compare drawings against it. Never send it, or any example image, in a teacher call: the teacher copies its content.
- Our map is made of our own pixels. Never send tiny.london images to the teacher, put them in a training set, or rehost them, including in the write-up. That would put their artwork into our map.
- Never use the tiny.london LoRA. It is under the Qwen Research Licence, which is non-commercial, and it was trained on London.
- Code under a permissive licence, such as isometric-nyc (MIT), may be adapted. Keep its licence notice in the adapted files and credit it in the README.
- Write-ups from other maps are fine as research. Cite them in `PLAN.md` references and in the write-up's credits. Never copy their wording.

## 8. Verification skill

Nothing runs yet, so there is no verification skill. When the first thing a user can drive exists (the renderer page, or the website), run pstack's `create-verification-skill`. Write the result to `.claude/skills/verify-tinybend/`. Then delete this section and point to that skill instead.

## 9. Models

Subagents run on Claude models only. pstack's default Grok roles run on the session model (`inherit-parent`). Hardest tasks run on `fable`. Arena and architect panels pair `fable` with `opus`. Interrogate runs `fable`, `opus` and `sonnet`. `docs/pstack.md` has the `/setup-pstack` answers.

**Gemini as an outside reviewer.** On hardest-tasks work (the joint sampler, the camera and ground maths) and on any change that controls a paid run over $10, also run `scripts/agy-review <base> <focus>` when you run interrogate. Treat its output like one more reviewer's: each finding is a claim to prove by a run, never a fix to apply on trust. If `agy` or the key is missing, the script exits 2. Say so in one line and carry on with the Claude panel. In cloud sessions use `GEMINI_API_KEY` only. On Colin's Mac, `AGY_SIGNIN=1` uses agy's own Google sign-in (Colin, 2026-11-28).

Pick each subagent's model by the job, per poteto-mode. The joint sampler, the camera maths and the per-shot ground are hardest-tasks work. Data plumbing, Modal wrappers and tile scripts are routine work.
