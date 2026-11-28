# An agent-native Tiny Perth

A design for making the map something an agent can read, drive and extend, without adding any way for a stranger to spend Colin's money. It applies Every's guide, [Agent-native Architectures](https://every.to/guides/agent-native), to this repo as it stands on 18 November 2026.

Phases 1 to 4 are a proposal. Nothing in them is built, and `PLAN.md` doesn't change until one is picked. Phase 0 is done in code, with dashboard steps left for Colin.

## The short version

- **One rule decides everything: a request from a stranger must cost nothing.** The public side gets static files, URL state and a JavaScript API that runs in the visitor's browser. No model call, GPU job, write or stored content can be reached from the internet.
- **The agent that builds things is Colin's own.** It is Claude Code in this repo, on his Mac or in a project thread, using his keys under the spend gates `CLAUDE.md` already sets. A visitor who wants the map to do something new brings their own agent and pays for it themselves.
- **The "Tell the map" box is out.** A public text box that calls a model is the bill risk in its purest form. What replaces it is a scene that travels inside a link, which costs nothing to serve.
- **Harden what is live first.** Reading the repo for this design turned up ways today's site could be misused or pushed over its limits. None involves a model. The code fixes are in the same PR as this document, and the rest are dashboard steps. They are Phase 0.
- **The biggest win is in the repo, not the site.** Adding runners round two lakes took 214 lines across five files (commit `fa0057e`). With scene files it would be one JSON file and no code.

## What "agent-native" means here

The guide has five principles. Each has a one-line test.

| Principle | The guide's test | Tiny Perth today |
| --- | --- | --- |
| **Parity.** An agent can do whatever a person can do in the UI. | Pick any UI action. Can the agent do it? | Partly. The view is in the URL hash. Time, season and weather are query parameters. Layer switches, theme, search and the games are clicks only. |
| **Granularity.** Tools are small primitives, and features are outcomes an agent reaches by combining them. | To change behaviour, do you edit a prompt or refactor code? | Refactor code. Each behaviour is its own module: `people.js`, `flocks.js`, `race.js`. |
| **Composability.** A new feature is a new prompt. | Can you describe a feature and get it without new code? | No. |
| **Emergent capability.** The agent can do things nobody planned for. | Ask for something in the domain that was never built. Does it work? | Only by writing code. |
| **Improvement over time.** It gets better through saved context, without shipping code. | Is there a context file the agent reads and updates? | Yes, and it is the strongest part: `CLAUDE.md`, `PLAN.md`, `writeup/journal.md`, `runs/ledger.tsv` and project memory. |

The guide assumes one app with one agent inside it. Tiny Perth is two things with three kinds of agent, and the design treats them separately.

| | The public site | The workshop |
| --- | --- | --- |
| What it is | `site/` on Vercel, tiles on R2 | The repo: `render/`, `look/`, `modal_app/`, `life/`, `scripts/` |
| Whose agent | A visitor's (a browser agent, or a chat model reading the page) | Colin's (Claude Code) |
| Who pays for the agent | The visitor | Colin, under the gates in `CLAUDE.md` |
| What it may do | Read and drive its own copy of the page | Author scenes, bake, redraw, publish with a yes |
| What it costs Colin per request | Nothing | Whatever the gate approved |

There is no third column for "Colin's agent, serving the public". That is the design.

## What exists today

Grounding, so each proposal below names the file it changes.

**The viewer** (`site/index.html`, 649 lines) is one static page. OpenSeadragon loads tiles from `https://tiles.tinyperth.cpd.dev/v2`. It exposes `window.tinyperth = { viewer, layout }` and fires `tinyperth:ready`. The view is kept in the hash as `#x,y,zoom` in map pixels. `?tiles=<url>` points it at any other tile folder.

**The life layers** (`site/life/`, 17 modules) draw on canvases over the viewer. `life.js` exposes `window.tinyperthLife` with a comment that says "for poking at from the console". It reads `?life=all`, `?at=HH:MM`, `?season=` and `?wx=`. The nine layer switches live in a `layers` object that only the panel changes.

**The bake** (`life/bake.js` and four helpers) turns `life/sources.json` into camera pixels: `life.json` (154 KB), `roads.json` (1.5 MB), `trains.json` (1.1 MB) and `people.json`. It needs the depth shots, which are on Colin's Mac, plus OpenStreetMap, GTFS and DEM downloads the cloud machine can't reach. So every life change goes cloud, then Mac, then back. One sign of that friction: `people.js` and `bake-people.js` are merged, but `sources.json` has no `people` key and `site/life/people.json` isn't in the repo, so the runners aren't on the live map yet.

**Two functions** (`site/api/planes.js`, `site/api/weather.js`) proxy adsb.lol and aviationweather.gov, cached at the edge for 5 seconds and 10 minutes. They are the only server code that a visitor can reach.

**The pipeline** is scripts run by hand or by an agent: `render/shoot.js` (Mac, real GPU, Google key locked to localhost), `render/even.js`, `modal_app/map_run.py` (GPU, about $2.10 an area, with a budget argument and a check of Modal's two limits), `look/pyramid.js`, and `scripts/r2 publish` (uses `--immutable`). Modal has no web endpoints. No key is in the site bundle.

## Rules for every surface

These are the test any new surface must pass. They are stricter than the guide, which doesn't cover cost or abuse.

1. **Zero marginal cost.** Anything a stranger can trigger is a static file from a cache, or code that runs on their machine.
2. **No public model.** No model call, image generation or GPU job is reachable from the internet, with or without a rate limit. Rate limits lower a bill. They don't cap it.
3. **No public writes.** Nothing a stranger sends is stored. No database, no upload, no accounts.
4. **Paid tools run locally.** They use keys from the ignored `.env`, on Colin's machine or in his own agent session. They are never deployed.
5. **Every paid account has a hard cap that fails closed.** An alert is not a cap.
6. **Gates live in the tool.** A paid tool refuses to run without an estimate and an approval, and writes the ledger row itself. The prompt rule in `CLAUDE.md` stays, as the second layer.

## Phase 0: harden what is live

Done in this PR where the fix is code, and listed as dashboard steps where it is an account setting. No spend.

Colin is on Vercel's Hobby plan. Hobby has no overage billing: when a monthly limit is reached the site pauses until the month rolls over. So on the Vercel side the risk is the map going dark, not a bill. R2 is the only public surface that can bill, and only at $0.36 per million uncached reads.

### What the live site does today

Measured on 18 November 2026 from a browser on Colin's Mac, by reading response headers.

| Check | Result |
| --- | --- |
| `/api/planes` twice | Served from the edge cache both times |
| `/api/planes?x=<random>` | `x-vercel-cache: MISS` every time. The function runs and asks adsb.lol. Same for `/api/weather`. |
| `roads.json`, `trains.json`, `life.json` | Compressed with Brotli to 582 KB, 201 KB and 61 KB, from 1.5 MB, 1.1 MB and 154 KB. Cached at the edge. Browsers are told to revalidate each visit. |
| `og.png` | 1.56 MB, not compressed (PNG already is). Only link previews fetch it. |
| A tile, twice | `cf-cache-status: HIT`, with a one-year immutable cache header |
| A tile with `?x=<random>` | `MISS`. Each new query string is a fresh read from R2. |
| `tiles.json` | `DYNAMIC`. Cloudflare doesn't cache `.json` by default, so every visit reads it from R2. |
| A tile that doesn't exist | `404`, cached for 4 hours per address |
| `POST` or `PUT` to the tile host | `401`. The public address can't write. |

A first visit moves about 845 KB of life data through Vercel, plus the page. Hobby includes about 100 GB of transfer a month, which is roughly 118,000 first visits.

### Fixed in the code

| # | Finding | Fix |
| --- | --- | --- |
| 1 | **The API cache can be bypassed with a query string.** Each bypass ran the function and sent a request to a free feed under the site's name. | Both functions now refuse any query string before the feed is asked, and keep the last answer in memory (2 s for planes, 10 minutes for weather), so the feed is asked at most that often however many requests arrive. Plane positions are no staler than before. |
| 2 | **`?tiles=` accepted any URL.** A link on tinyperth.com could show someone else's pictures as the map. | Only our tile host, this site, and `localhost` are accepted. Anything else loads the normal map. `?tiles=https://tiles.tinyperth.cpd.dev/v1` still shows the first map. |
| 3 | **OpenSeadragon loaded from a CDN with no integrity check.** | The script tag carries a SHA-512 hash, so the browser refuses the file if it ever changes. |
| 4 | **`scripts/r2` passed any rclone command through,** including `delete`, `purge` and `sync`. | Commands that can delete or overwrite are refused, and `copy` always runs with `--immutable`. |

Speed, with nothing visual changed: the page now opens its connections to the tile host and the script CDN while the HTML is still parsing, and starts fetching `tiles.json` at once, so the first tiles arrive sooner. `og.png` and the icon may be kept by browsers for a day. `tests/test_site.mjs` covers the guards.

Since 2026-11-21 the viewer's script and the font are served from the site itself (`site/vendor`, `site/fonts`) and the layout of the default tile version is written into the page, so the page no longer asks the script CDN, Google Fonts or `tiles.json` for anything. `tiles.json` is still fetched when a `?tiles=` address names another version.

### Dashboard steps for Colin

These are account settings, so they are Colin's to make. Each takes a few minutes.

**Cloudflare, zone `cpd.dev`**

1. **Block junk requests to the tile host.** Security, WAF, Custom rules, new rule, action Block, with this expression:
   `(http.host eq "tiles.tinyperth.cpd.dev" and (http.request.uri.query ne "" or not http.request.method in {"GET" "HEAD" "OPTIONS"}))`
   The viewer never sends a query string to the tile host, so nothing real is blocked. This closes the cache bypass.
2. **Cache `tiles.json`.** Caching, Cache Rules, new rule: when hostname equals `tiles.tinyperth.cpd.dev`, set "Eligible for cache" and leave the edge time on "use the origin's header". The file then loads from Cloudflare's nearest site, not from R2, which is also a little faster on every visit. Since 2026-11-21 the page only fetches this file for a `?tiles=` address, so this step matters less.
3. **Rate limit the tile host.** Security, WAF, Rate limiting rules: same hostname, 1,000 requests per 10 seconds per IP, block for 10 seconds. A fast pan across the map loads a few hundred tiles, so real visitors stay well under it. This bounds requests for tiles that don't exist, which is the one read that can still reach R2.
4. **Lock the published versions.** R2, bucket `tinyperth-tiles`, Settings, Bucket lock rules: one rule for prefix `v1/` and one for `v2/`, each retained indefinitely. The bucket then refuses to delete or overwrite those objects whatever tool asks. The rule itself can be removed later if a version is ever retired on purpose.

**Vercel, project `tinyperth`**

5. **Rate limit the API.** Firewall, new rule: when the path starts with `/api/`, rate limit to 60 requests a minute per IP. The page asks for planes six times a minute.

**Google Cloud, project `tinyperth-maps`**

6. **Cap the Map Tiles API.** The $25 budget alert sends an email but doesn't stop spend. APIs and Services, Map Tiles API, Quotas: set a daily request cap near what one render day needs.

### Left for later, with reasons

| Item | Why it waits |
| --- | --- |
| Give the baked JSON content-hashed names and a one-year cache, or move it to R2 | It needs a change in `site/life/life.js`, which another thread is editing. A long cache without hashed names would let a visitor run new code against old data after a deploy. |
| Stop polling `/api/planes` when the tab is hidden or the planes layer is off | Also in `site/life/`. It would cut function runs with no visible change. |
| Shrink `og.png` | Lossless recompression saves 6%. Anything more means JPEG or fewer colours, which changes the picture, so it is Colin's call. |
| A Content-Security-Policy header | The page uses inline scripts, so a useful policy needs them moved to files first. |

Account caps that are already right: Modal's two limits, raised per phase, and Gemini's prepaid credit with auto-reload off.

## Phase 1: a public surface agents can read and drive

> **Built.** `site/agent.js`, `site/llms.txt`, `site/agent/map.json`, and `lat` and `lon` in `site/places.json`. Tests are in `tests/test_agent.mjs`. What differs from the proposal below:
>
> - `ll` and `place` set the opening view only when the link has no `#x,y,zoom`. The page still writes the hash as the map moves, and `tinyperth.url()` returns the full link.
> - `layers` also takes `none` and `all` as a first word, so `none,trains` is trains alone.
> - `theme` in a link applies to that visit and isn't saved over the visitor's own choice.
> - There is a `getState()` and a `play()`. `whatsHere()` returns places, sports grounds, ferry routes and beaches. Stations aren't in the baked data by name, so they are left out.
> - The Share button now copies `tinyperth.url()`, so a shared link carries the layers, hour and season.
> - `pick(x, y)` and `follow(on)` (2026-11-23, with the tap cards in `site/life/tap.js`): `pick` opens the card for the train, ferry, plane or yacht drawn nearest map pixels x, y in the current view and returns what it says as data; `follow` keeps that thing in the middle of the view. They load the card code on first use, as a tap does.
> - `board(station, { tv })`, `?board=` and `?tv=` (2026-11-23, with the station boards in `site/life/board.js`): `board("claremont")` opens a station's departures board and returns its next timetabled trains each way as data; `{ tv: true }` fills the screen with it, and `null` closes it. `getState()` and `url()` carry the open board. The board's code loads on first use, as a tap on a station's name does.
> - `navigator.modelContext` (WebMCP) is not registered. It can be added behind a feature check once browsers ship it.
> - The AI-bot bypass for `/llms.txt` and `/agent/*` is a Vercel dashboard setting and is Colin's call (decision 1 below).

About a day and a half. No spend. Everything is static or runs in the visitor's browser.

### The URL carries the whole state

The URL is the public side's version of the guide's "files as the universal interface". It can be read, shared and written by any agent, including one that can only produce a link.

Today the URL holds the view, time, season and weather. The proposal is that every control in the UI has a URL form:

| UI action | URL today | URL proposed |
| --- | --- | --- |
| Pan and zoom | `#x,y,zoom` in map pixels | Keep, and add `?ll=-31.951,115.889&span=1500` (latitude, longitude, metres across) |
| Go to a place | none | `?place=optus-stadium`, from `places.json` |
| Layer switches | none, except `?life=all` | `?layers=sport,trains,-cars` |
| Time of day | `?at=21:30` | Keep |
| Season | `?season=footy` | Keep |
| Weather | `?wx=RA` | Keep |
| Theme | saved in the browser only | `?theme=dark` |
| Games | none | `?play=quokkas`, `air-race` or `daily` |
| Event day preview | none | `?event=australia-day`, `nye` or `channel-swim` (added with event days) |

Latitude and longitude matter most. Agents know where Optus Stadium is on Earth. They don't know it is at map pixel 8535, -1904. The browser already has the camera maths (`site/life/camera.js`), so the page converts.

### `window.tinyperth` becomes a real API

Today there are two console objects with no contract. The proposal is one documented object, in a new `site/agent.js` of about 200 lines. Every call goes through the same code path as the matching UI control, so the panel and the URL always show what an agent did. The guide calls this "no silent actions".

```js
await tinyperth.ready
tinyperth.help()                       // what this API can do, as data
tinyperth.getView()                    // { lat, lon, x, y, zoom, spanMetres, bounds }
tinyperth.flyTo({ place: "Cottesloe" })           // or { lat, lon, span } or { x, y, zoom }
tinyperth.find("herdsman")             // matching places, with lat, lon, kind
tinyperth.whatsHere()                  // places, ovals, ferry routes and stations in view
tinyperth.layers.list()                // [{ id, label, on }]
tinyperth.layers.set("trains", true)
tinyperth.setTime("21:30")             // null follows the clock
tinyperth.setSeason("footy")
tinyperth.setWeather("RA")             // null follows the live report
tinyperth.setTheme("dark")
tinyperth.project(lat, lon)            // to map pixels, and unproject back
tinyperth.url()                        // a link to exactly this state
```

Three choices in that list come from the guide:

- **`help()` is dynamic capability discovery.** An agent asks the page what it can do. Layer and place lists come from the same objects the UI reads, so a new layer shows up with no API change.
- **`whatsHere()` gives context.** An agent looking at a screenshot of pixel art can't read street names. This returns what the baked data knows is in view.
- **There is no `screenshot()`.** A browser agent already has one. A page-made screenshot would need the tiles served with CORS headers, which is extra surface for little gain.

If browsers settle on a standard way for a page to offer tools to an agent (the WebMCP proposal, `navigator.modelContext`), `agent.js` can register these same functions with it behind a feature check. Check the spec's state when building. It adds no server and no cost.

### `llms.txt` and static data

- `site/llms.txt`: what the map is, the URL grammar, the API, the coordinate system (camera tilted 45°, looking north 15° east, 0.293 m per pixel), the data files and the credits. Written by hand, about 60 lines.
- `places.json` gains `lat` and `lon` beside `x` and `y`. `look/site-places.js` already has them when it writes the file.
- `site/agent/map.json`: the camera constants and tile layout, so an agent with no browser can still work out which tile shows a given street.

**One conflict to settle.** The Vercel firewall blocks AI bots. That stops chat models' fetchers from reading `llms.txt`, though browser agents get through as normal browsers. The recommended setting is to keep the block and add a bypass for `/llms.txt` and `/agent/*` only. Those are small, cached, static files.

## Phase 2: scenes as files

> **Built, with nothing switched on.** The engine (`site/life/scenes.js`), the bake (`life/bake-scenes.js`), the checker (`life/check-scenes.js`), four sprites as data (`life/sprites/`) and the agent guide (`life/context.md`) are in. `life/scenes/` is empty, so `site/life/scenes.json` holds no scenes and the site draws exactly what it drew before. `tests/life-diff/run.mjs` proves that: it compares every drawing call, the finished pixels and a screenshot across 132 views, before and after. What differs from the proposal below:
>
> - `people.js` did not move to scenes. Its data file (`site/life/people.json`) isn't in the repo, so there was nothing on the site to prove a like-for-like move against. It stays as code.
> - The height grid isn't built. The bake sets places on the flat coastal plain, or at water level, and takes a `height` for a place on a hill. That needs no Mac and is right to a few pixels near sea level.
> - The motions are `still`, `loop`, `shuttle` and `wander`. `flock` is left out.
> - The checker can't tell water from land without the depth pass. The preview is the check for that.
> - `life/capture.mjs` is unchanged. The diff harness's before and after screenshots do that job for a scene PR.

Two to three days, plus a day for the height grid. No spend. This is where the guide's "granularity" pays off, for Colin's own requests.

### The problem

Each behaviour on the map is its own code. "Runners round Herdsman Lake, cyclists at the Narrows and coffee boards" was a new bake module, a new browser module, edits to `bake.js` and `life.js`, and a new test: 214 lines. The next request of that shape costs the same again.

### The proposal

A scene is a file that says what, where, when and how many. A generic engine draws it.

```json
{
  "id": "herdsman-runners",
  "layer": "people",
  "when": { "hours": [5.5, 9], "not_weather": ["RA", "TS"] },
  "actors": [
    {
      "sprite": "runner",
      "count": 15,
      "place": { "loop": "paths/herdsman-lake.geojson" },
      "motion": { "kind": "loop", "speed": [2.8, 3.6] }
    }
  ],
  "credit": "Path from OpenStreetMap (ODbL)"
}
```

The primitives, kept few on purpose:

| Primitive | Values |
| --- | --- |
| `sprite` | A name from the sprite catalogue |
| `place` | `point`, `points`, `path`, `loop`, or a baked `zone` (such as open water) |
| `motion` | `still`, `loop`, `shuttle`, `wander`, `flock` |
| `when` | Hours, days, months, weather, and the season switch |
| `count`, `spread`, `pack` | How many, and how bunched |
| `layer` | Which panel switch owns it |

Files:

- `life/scenes/*.json` and `life/scenes/paths/*.geojson`. Coordinates are latitude and longitude, never pixels.
- `life/bake-scenes.js` projects them to camera pixels and writes `site/life/scenes.json`.
- `site/life/scenes.js` is the engine, about 250 lines.
- `life/sprites/` holds the sprite catalogue as data. Sprites today are polygons and small grids inside the modules (`sprites.js`, `sport.js`). As files they are text an agent can write, with no image model and no cost.
- `life/context.md` follows the guide's `context.md` pattern. It holds the rules an agent needs to stay on-style: the sprite scale table (`GRAIN` in `life.js`), the palette, the one-pixel dark outline, what counts as real against made-up, and the rule that every data source gets a line in `credits.html`.

**The existing layers stay as code.** Traffic, trains and the footy match are tuned and fast. The guide calls this "graduating to code": primitives first, optimised code for the hot paths. Only `people.js` moves to scenes at first, as the proof, since it is the newest and simplest. Ferries, quokkas and the boards can follow.

### Checks are the completion signal

The guide wants an explicit "done", not a guess. For a scene, done means three things an agent can run:

1. `node life/check-scenes.js`: the schema is valid, every point is inside the map, counts are under the caps, sprites exist, boats are on water and runners on land, sprites fit the size and palette limits, and a credit is present.
2. `uv run python tests/test_life.py`, as today.
3. `node life/capture.mjs` records a still or loop of each changed scene, and it goes in the PR. A Vercel preview is the review surface.

### Make the bake run anywhere

Scene files only help if an agent can bake them without the Mac. The bake needs one thing the cloud doesn't have, which is ground height. The fix is to bake the heights once, on the Mac, into a coarse grid for the whole map (about 11 MB at 20 m spacing), and keep it where any machine can read it. Then a scene PR is complete from a cloud thread.

Limit: hiding sprites behind buildings needs the full depth shots, which survive only for the inner 731. Scenes on open ground, water and paths don't need it. Scenes under stands or between towers stay a Mac bake.

### Create, read, update, delete

The guide asks that an agent can do all four to every kind of thing.

| Thing | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| Scene, path, sprite | New file | Read file | Edit file | Remove file; the bake drops it |
| Place | `look/site-places.js` | `places.json` | Same script | Same script |
| Layer | One line in `layers` | `layers.list()` | Edit | Remove |
| Published tile version | `scripts/r2 publish`, with a yes | Public | **Never** | **Never** |

The last row is a deliberate gap. It is the project's data rule, enforced by the bucket lock from Phase 0.

## Phase 3: scenes in a link

About a day. No spend. Optional, and the one phase with a judgement call.

This is what stands in for "Tell the map". A visitor's own agent composes a scene from the Phase 2 primitives and puts it in the link, after the `#`:

```
https://www.tinyperth.com/?ll=-31.9545,115.8605&span=800#scene=<compressed JSON>
```

The part of a URL after `#` is never sent to a server. So the scene is not stored, logged or processed by anything of Colin's. The page decodes it in the browser and hands it to the same engine.

Limits, enforced by the page:

- At most 4 KB of scene, 200 actors and 2,000 path points, so a link can't freeze a phone.
- Sprites come from the catalogue only. No images and no URLs.
- **No free text.** A scene can't put words on the map. This is the control that matters: without it, anyone could share a tinyperth.com link showing whatever they typed.
- A visible "Visitor's scene" badge with a button to clear it.

What it costs: nothing. What it risks: someone arranges catalogue sprites into something crude and shares the link. The badge and the lack of text keep that small. If that risk isn't worth it, skip this phase. Phases 1, 2 and 4 don't depend on it.

There is no way to see which scenes people make, since nothing reaches a server. That is the price of rule 3. The guide's "watch what users ask for" loop therefore runs on Colin's own requests only, in Phase 4.

## Phase 4: the workshop as tools

About two days for the tools, and one to two for tile patches. The tools cost nothing. A patch costs about $2.10 for each area redrawn.

### A command line, before a server

Claude Code already has the guide's primitives: a shell and files. What it lacks is this project's vocabulary and its guardrails. So the proposal is one small command, `scripts/tp`, that wraps the scripts that exist and prints JSON. A local MCP server is the same functions behind a different front, and can come later if Colin wants them in the desktop app. It would speak over standard input and output only, with no network port, so it adds no public surface.

| Tier | Commands | Gate |
| --- | --- | --- |
| **Look** | `tp where <place or lat,lon>` gives map pixels, shot, area and tile at each zoom. `tp crop <place> --from render\|even\|drawn\|live` gives an image. `tp status` lists versions on R2, areas on the Volume, the ledger total and the room under Modal's limits. | None |
| **Make locally** | `tp bake`, `tp capture`, `tp check`, `tp pyramid` | None |
| **Spend** | `tp draw --areas ... --budget N` wraps `modal run --detach modal_app/map_run.py` | Prints the estimate. Over $10 it stops unless given an approval. Appends the ledger row itself. |
| **Publish** | `tp publish <folder> <version>` wraps `scripts/r2 publish` | Always needs a yes. Refuses a version name that exists. |
| **Never** | Delete from the Volume or R2. Overwrite a version. | Not offered. There is no command. |

This is the guide's approval table (stakes against reversibility) with this project's rules filled in. The difference from today is that the gate is in the command, so a new thread that hasn't read `CLAUDE.md` closely still can't skip it.

### The test: fix a bad tile

The guide's "ultimate test" is an outcome nobody built a feature for. Here it is "the water at Point Walter looks wrong". With the tools above an agent can:

1. `tp where "Point Walter"` to find the area and tiles.
2. `tp crop` the render, the evened render and the drawing, and look at them side by side.
3. Decide whether the render or the drawing is at fault.
4. `tp draw` that one area under a new name (about $2.10, under the $10 gate, logged).
5. `tp check` it, then cut patch tiles.
6. Open a PR with before and after crops, and ask for a yes to publish.

Step 6 needs one new piece. Published versions never change, so a fix can't replace a tile in `v2/`. The proposal is a patch list in the site: a small `site/tiles.json` that names the base version and any patch folders (`v2-p1/`) with the tiles each one covers. The viewer's `getTileUrl` checks the list first. Publishing a patch is then an upload to a new folder plus a one-line PR, and undoing it is reverting the PR.

### Verify before deleting

This week's loss of depth images is the case for one more command. `tp verify-backup <folder>` compares a local folder against its copy on the Modal Volume by count and checksum, and prints a plain yes or no. Cleanup of the Mac stays a step that needs Colin's yes, and the tool refuses to list a folder as safe to delete without a pass.

### Getting better over time

Most of this exists. Two small additions:

- `life/context.md` (from Phase 2) is updated by the agent when a style call is made, such as "runners read better at 1.5 map pixels per sprite pixel".
- `docs/gaps.md`: when a request can't be met with scenes and tools, the agent adds a line saying what was missing. That file is the roadmap the guide describes: recurring gaps become new primitives.

## Threat and cost model

Every surface, who can reach it, and the worst it can do.

| Surface | Reachable by | Worst case | Controls | What remains |
| --- | --- | --- | --- | --- |
| Static site on Vercel | Anyone | No bill on Hobby. Looped downloads could use up the month's transfer and pause the site. | Bot protection; later, hashed files with a long cache or a move to R2 | A paused site until the month rolls over |
| `/api/planes`, `/api/weather` | Anyone | Function runs counted against Hobby's limit | Query strings refused; answers kept in memory; edge cache; rate limit | Planes and weather go quiet under attack; the map still works |
| Online counter (`presence/`, Cloudflare) | Anyone | None on the Workers Free plan, which can't bill. Fake sockets inflate the number. | Origin check; 4 sockets per IP; room cap 5,000; hibernation; pings answered by Cloudflare | The counter shows a wrong number or hides until the free limits reset. The map is a separate host and is untouched. |
| Tiles on R2 | Anyone | Billed reads on cache misses, about $0.36 a million | Block query strings; cache everything; no transfer fee | Small and slow to grow |
| `?tiles=` | Anyone with a link | Other pictures shown under the site's name | Host allowlist | None |
| URL state and `window.tinyperth` (Phase 1) | Anyone, in their own browser | None for Colin. It changes only their own view. | Inputs clamped to the map | None |
| `llms.txt`, `agent/*.json` (Phase 1) | Anyone | A few KB of transfer | Static and cached | None |
| Scene in a link (Phase 3) | Anyone with a link | A crude arrangement of sprites, shared | No text; catalogue only; size caps; badge | Reputation only. Skip the phase to remove it. |
| Scene files (Phase 2) | People who can push to the repo | A bad scene on the live map | Checks, a preview, and Colin merges | Reverting a PR |
| `scripts/tp` look and make tiers | Colin's agent | Local disk and CPU | None needed | None |
| `tp draw` | Colin's agent, with keys | Modal spend | The command's gate; `--budget`; Modal's two limits; the ledger | At most the room left under Modal's limits |
| `tp publish` | Colin's agent, with keys | A wrong version goes public | Always a yes; bucket lock; new names only | Storage for an unused folder |
| Teacher calls | Colin's agent, with keys | Gemini spend | Prepaid credit, no auto-reload | The credit balance |
| Render | Colin's Mac only | Google Map Tiles charges | Key locked to localhost; daily quota cap | The daily quota |
| Pull requests from forks | Anyone on GitHub | A preview build | Vercel's Git fork protection asks for approval before building; keep it on | None |

Two things are absent from that table on purpose: a hosted model, and a public endpoint that writes stored data. (The online counter, added 2026-11-19 with Colin's choice, keeps nothing: it counts open sockets in memory on a plan that can't bill.) If either is ever wanted, the bar is sign-in limited to Colin, a prepaid balance that can't refill itself, a rate limit, and a switch that turns it off. Until all four exist it doesn't ship.

## What this design leaves out

| Left out | Why |
| --- | --- |
| A public "Tell the map" box backed by a model | Open-ended cost, and visitor text on the site |
| A hosted MCP server | A public endpoint with nothing to offer that static files and the browser API don't |
| Saving visitors' scenes | Needs a database, moderation and storage |
| Drawing tiles on request | A GPU behind a public URL |
| An agent that edits its own prompts | The guide marks it as unproven. `CLAUDE.md` changes go through a PR. |
| Usage tracking of the API | Custom analytics events can be inflated by a script, and can be billed |

## Phases at a glance

Effort is in working days for an agent with Colin reviewing.

| Phase | What ships | Effort | Spend | Needs from Colin |
| --- | --- | --- | --- | --- |
| 0 | Hardening of the live site and accounts | Code done | $0 | Six dashboard steps on Cloudflare, Vercel and Google Cloud |
| 1 | URL grammar, `window.tinyperth` API, `llms.txt` | 1.5 days | $0 | The AI-bot bypass decision |
| 2 | Scene files, engine, checks, `context.md`, height grid | 3 to 4 days | $0 | One bake on the Mac for the height grid |
| 3 | Scenes in a link | 1 day | $0 | Whether to do it at all |
| 4 | `scripts/tp`, gates in the tools, tile patches | 3 to 4 days | About $2.10 per redrawn area | A yes per publish |

Phases 0, 1 and 2 are independent of each other after Phase 0's file moves. The suggested order is 0, then 2, then 1, then 4, because Phase 2 pays back on the very next "add some life to the map" request.

## Decisions for Colin

1. **AI bots.** Keep the block and let `/llms.txt` and `/agent/*` through (recommended), or drop the read surface for chat models and serve browser agents only.
2. **Scenes in a link.** Build Phase 3 with no free text (recommended), or leave it out.
3. **Tools.** A command line first (recommended), or a local MCP server from the start.
4. **Height grid.** Publish it to R2 beside the tiles (recommended, since it is public data and free to serve), or keep it in the repo.
5. **Baked JSON on R2.** Move `roads.json`, `trains.json` and `life.json` off Vercel (recommended). It is a write to the public bucket, so it needs a yes.
