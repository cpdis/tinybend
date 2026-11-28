# pstack in Tiny Bend

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is a set of agent skills for rigorous engineering work: playbooks for features, bug fixes, hillclimbs and long runs, a review panel, and a list of principles. pstack is written for Cursor, and its Claude Code build maps the Cursor names. This repo uses it in Claude Code only, with Claude models only. This page covers installing it and how the repo adapts it.

## Install

The repo already declares the plugin in `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "cursor-plugins": {
      "source": { "source": "github", "repo": "cursor/plugins", "sparsePaths": [".claude-plugin", "harness/pstack"] }
    }
  },
  "enabledPlugins": { "pstack@cursor-plugins": true }
}
```

Open the repo in Claude Code and trust the folder. Claude Code offers to add the `cursor-plugins` marketplace and install pstack. The sparse paths keep the clone to pstack's Claude Code build. If the offer doesn't appear, run:

```bash
claude plugin marketplace add cursor/plugins --scope project --sparse .claude-plugin harness/pstack
claude plugin install pstack@cursor-plugins --scope project
```

Third-party marketplaces don't auto-update. To update by hand, run `claude plugin update pstack@cursor-plugins`. To turn auto-update on, run `/plugin`, open **Marketplaces**, pick `cursor-plugins` and choose **Enable auto-update**.

Cloud sessions on claude.ai/code read the same `.claude/settings.json`.

## Pick models

Run `/pstack:setup-pstack` once per machine. It writes `~/.claude/rules/pstack-models.md` in your home folder, not in this repo.

pstack's defaults put code work on Grok and judgment on Opus. With Claude only, give these answers. Pick the `large` budget. Code roles run on the session model (`inherit-parent`). Judgment and prose run on Opus, and the hardest tasks on Fable. Arena and architect run one Fable and one Opus attempt. Interrogate runs Fable, Opus and Sonnet, because more reviewers find more of the bugs that only one model spots. Arena's judge must come from a different family to the session, so its pool is Fable then Sonnet. The rule should come out like this:

```text
# budget: large (xhigh)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: opus xhigh
hardest tasks: fable xhigh
how explorer: inherit-parent
how explainer: opus xhigh
why investigators: inherit-parent
why synthesizer: opus xhigh
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: opus xhigh
arena runners: fable xhigh, opus xhigh
arena cross-judge pool: fable xhigh, sonnet xhigh
swarm workers: inherit-parent
architect runners: fable xhigh, opus xhigh
interrogate reviewers: fable xhigh, opus xhigh, sonnet xhigh
```

Each panel entry is one subagent, so three interrogate reviewers cost about three reviews. Shorten a list if that's more than a change needs.

Setup then offers to make a verification skill. Say no for now. Nothing can run yet. `tinybend-mode` says when to make one.

## Add Gemini as an outside reviewer

Claude models share blind spots. `scripts/agy-review` sends the branch's diff to Gemini through Google's Antigravity CLI (`agy`) for a review from a different lab. `tinybend-mode` runs it alongside `/interrogate` on the hardest changes.

It uses the Gemini API key that the teacher uses, not an Antigravity sign-in. Google's [Antigravity FAQ](https://antigravity.google/docs/faq) says an Antigravity login must not be used from third-party agents such as Claude Code, and that this can get the account suspended. It recommends an API key. The key is separate from the Maps 3D Tiles key.

Set it up once per machine:

1. Install `agy` with Google's installer from the [Antigravity docs](https://antigravity.google/docs/install/). Check with `agy --version`.
2. Put `GEMINI_API_KEY=...` in the repo's ignored `.env`. It's the same key the `gemini` Modal secret holds.
3. Run `agy models` and pick the strongest Gemini model. Set it with `AGY_MODEL=<slug>`, or leave it unset to use `agy`'s default.

Do not add `"modelProvider"` to `~/.gemini/antigravity-cli/settings.json`. The script passes `--settings '{"modelProvider":"gemini"}'` on its own run, so only that run uses the key. Plain `agy`, typed by you, keeps your Google sign-in. A global `"modelProvider": "gemini"` makes plain `agy` stop at startup when your shell has no `GEMINI_API_KEY`.

The key is billed through AI Studio, not your Antigravity plan quota. If it is on prepaid billing and the credit runs out, a review fails with `402: Your prepayment credits are depleted`. Top up in [AI Studio](https://ai.studio/projects). Do not switch the script to the Google sign-in.

Run it from the repo:

```bash
scripts/agy-review                                 # working tree against origin/main
scripts/agy-review origin/main tent weights and pinning
```

It reviews committed and uncommitted changes to tracked files, and it lists untracked files without sending them. The prompt can be at most 120,000 bytes, so review a narrower range when a diff is bigger.

It prints Gemini's findings and appends a row to `runs/ledger.tsv`, including for a run that fails. A review costs cents. It runs `agy` in headless mode, where tool actions that need approval are refused, and it asks Gemini not to edit or run anything. Treat its findings like any panel member's. Keep a finding only once a run proves it.

## How the repo adapts pstack

pstack's author recommends making your own mode on top of `poteto-mode`, normally with `/automate-me`, which mines your chat history. This repo has no history yet, so `tinybend-mode` was written from `PLAN.md` instead. Rerun `/automate-me` after a few weeks of work to fold in how you actually work.

| pstack piece | What Tiny Bend adds |
| --- | --- |
| `poteto-mode` routing | A table that sends each kind of Tiny Bend work to a playbook. Teacher prompts and LoRA versions go to **Hillclimb**. Whole-map generation goes to **Autonomous run**. Landmark and water fixes go to **Bug fix**. The Phase 1 look goes to **Prototype**. |
| Always-pause list | Spend gates. Ask before any paid run over $10, before Google Cloud account changes, before public uploads, and before deletes. Landmark approvals and test places stay with you. |
| `prove-it-works` | Image claims need contact sheets. Numbers need the set size and what limits them. LoRAs are judged only on held-out test places. |
| `build-the-lever` | A validator ships with `places/bend.json`, and every paid run gets a row in `runs/ledger.tsv`. |
| `make-operations-idempotent` | Generation checkpoints every block and skips finished blocks on a rerun. |
| Multi-phase plan | Works from the phases in `PLAN.md` rather than writing a second plan. |
| `technical-writing`, `unslop`, `show-me-your-work` | The write-up. A journal entry per finished plan step, small images saved beside it, a `Write-up` line in every PR, and `writeup/how.md` drafted only from that evidence. |
| Always-applied rules | `CLAUDE.md`. |

Left out on purpose:

- **Cursor-only features.** Benny automations, Bugbot and Cursor cloud agents. Skills that reach for them skip that step with a one-line note.
- **A verification skill.** There's nothing to drive yet. Make one with `/create-verification-skill` when the renderer page or the website first runs.
- **Formal verification.** The joint sampler's invariants are covered by property tests in its Feature row. A model checker doesn't earn its place for one numeric loop.

## Example prompts

```text
/tinybend-mode phase 1. render the four test frames and draw each in six directions. put them on one contact sheet so I can pick.
/tinybend-mode write places/bend.json from the plan's landmark list, with a validator.
/tinybend-mode hillclimb the teacher prompt. get first-try acceptance above 70% on the v1 frame set, at least 8 attempts.
/tinybend-mode build the joint sampler. architect it first, then interrogate the diff.
/tinybend-mode i'm going to bed. generate the downtown-test area with bend-v1. stop if it would go over $25.
/tinybend-mode draft writeup/how.md from the journal so far. technical-writing, then unslop.
/pstack:how does the sampler pin finished blocks?
```
