# Tiny Bend: agent rules

Tiny Bend is an isometric pixel-art map of Bend, Oregon, and a separate Mt. Bachelor patch on the same camera and grid, drawn in summer and in winter with a toggle. Renders of Google's 3D tiles are redrawn by an image model trained on Bend; winter is a second LoRA that repaints the finished summer map. The pipeline was copied from cpdis/tinyperth; `docs/porting.md` lists what is still Perth's. `PLAN.md` is the plan of record: phases, costs, where each step runs, and the prompt rules.

The project ships two things: the map, and a write-up of how it was made (`writeup/how.md`), modelled on the scope of the tiny.london write-up.

## How to work here

- Use pstack. For any non-trivial task, start with `/tinybend-mode` (`.claude/skills/tinybend-mode/SKILL.md`). It loads pstack's `poteto-mode` and adds this project's routing, spend gates and proof standards. Setup is in `docs/pstack.md`.
- pstack's skills are written with Cursor tool names. Map them with the plugin's `docs/harness/claude-code.md`, and skip Cursor-only steps (Bugbot, Cursor Automations, cloud agents) with a one-line note, as that adapter says.
- pstack commands take a `pstack:` prefix, such as `/pstack:poteto-mode`. This repo's own skills don't.
- Read the `PLAN.md` phase a task belongs to before you start. If the work changes the plan, update `PLAN.md` in the same PR.

## Hard rules

- **Spend.** Ask before any paid run estimated over $10 USD, and state the estimate. Log every paid run in `runs/ledger.tsv`.
- **Accounts.** Ask before creating or changing Google Cloud projects, billing, API keys or quotas. Same for Modal Volumes and secrets, R2 buckets and tokens, and Vercel projects.
- **City config.** `cities/bend.json` holds the camera, the two areas, the DEM and the account names. `render/camera.js` must match it (`tests/test_city.mjs`). Place things by `groundProjector()` from `render/dem.js`, never by one ground height.
- **Data.** Never delete from the Modal Volume or R2, and never overwrite a published tile version. Fixes ship as new versions or patch folders. Shots go to the Volume whole (colour, depth and sidecar, `scripts/put-shots.py`), and depth and sidecars are backed up before any cleanup on the Mac.
- **Long runs.** Runs over 10 minutes go to Colin's Mac through Remote Control. If it can't be reached in 2 minutes, run in the cloud and say so.
- **Python.** Through uv (`uv run --with ...`), never a bare pip.
- **Publishing.** Ask before writing to the public R2 bucket or deploying the website.
- **Gemini reviewer.** In cloud sessions, `scripts/agy-review` uses `GEMINI_API_KEY` only. On Colin's Mac, agy may use his own Google sign-in (Colin, 2026-11-28).
- **Secrets.** Keys live in the ignored `.env`, in Modal secrets and in 1Password. Never print, log or commit them. The Google key stays referrer-restricted to localhost and never reaches the browser bundle.
- **Test places.** Shevlin Park, an eastside subdivision, the rimrock along the Deschutes north of downtown, one golf course and the cinder cone beside West Village are never trained on, in either season (`places/bend.json`, kind `test`).
- **Landmarks.** Colin approves landmark pairs before they go into training, for each season.
- **Teacher prompts.** Describe how to draw, never what to draw. No place names, including for landmarks. One generated sentence per frame on where water is and isn't, and for winter one on where ground stays clear of snow.
- **Write-up journal.** A PR that finishes a plan step adds an entry to `writeup/journal.md`. Every PR body has a `Write-up` line naming that entry, or `none` with a reason.
- **Document for first-timers.** Colin learnt this pipeline on Tiny Perth, but the write-up is for readers who haven't done 3D rendering, model training, LoRAs, Modal or GPU work. Each journal entry explains the step in plain words, defines new terms, and shows it with visuals made at the time: setup screenshots, pipeline diagrams, before and after images, contact sheets, training curves and costs. Capture them as you go, because many can't be recreated later. Cover account numbers, keys and email addresses in screenshots.
- **Look and originality.** The target look is tiny.london's, adapted to Bend. Describe it in the teacher prompt and match it by eye. Never put tiny.london's images into teacher calls, training sets or our site, and never use its LoRA. Permissively licensed code, such as isometric-nyc (MIT), may be adapted with its licence notice kept. The write-up is in our own words and images.
- **Credits.** Never credit Tiny València as UI inspiration in public copy.
- **Public cost.** No public surface that can cost money: no model calls from the browser, no unauthenticated writes.
