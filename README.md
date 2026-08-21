# Cloudflare Maintenance Page

A **Cloudflare Worker** that replaces your site's default error page with a
custom one whenever your origin is unreachable — timeout, tunnel down,
container crashed, power outage, anything that makes Cloudflare see a
502/521/522/523/530. Normal traffic passes straight through untouched; the
worker only speaks up when your origin can't.

It ships as **13 self-contained theme files** — from a plain "back soon"
card to a full Matrix-style scene with an endless-runner mini-game — so
visitors have something better to look at than a generic error screen while
you fix things. All plain HTML/CSS/JS, no framework, no build step to
preview; dark/light and `prefers-reduced-motion` aware; English only.

## Structure

```
.
├── live/
│   └── matrix-runner.html    the theme currently deployed to production
├── designs/                   12 alternate themes — pick one to deploy instead
├── build-worker.js            wraps a theme into worker.js
└── test/
    └── game-sim.js            headless fairness/physics test for the mini-game
```

`live/` holds whichever theme is actually built and deployed right now.
`designs/` is a gallery of everything else explored along the way — swap
`live/matrix-runner.html` for any of them any time (see **Deploying**
below), or use them as a starting point for your own.

| Theme | Look |
|---|---|
| **matrix-runner** (`live/`) | Code rain, a 10-part branching outage story, and a playable dodge-the-agents runner with a shooter enemy |
| minimal | A clean status card — pulsing badge, animated progress bar, no game |
| animated-scene | Starfield, a glowing server-to-cloud SVG scene, live retry countdown |
| endless-runner | The original neon dodge-the-firewalls runner, story-free |
| space-runner | Starfield scene + the neon runner, side by side |
| orbit-scene | A pulsing planet, an orbiting satellite, a live terminal log |
| orbit-runner | The orbit scene with the runner embedded in the same card |
| submarine | Underwater — light rays, rising bubbles, a submarine pinging sonar, a live depth counter |
| retro-terminal | CRT scanlines, screen flicker, an ASCII logo, a BIOS-style boot log |
| paper-plane | Pastel sky, paper clouds, a flying paper airplane, a taped note card |
| signal-tower | Night mountains, a moon, fireflies, a radio tower broadcasting signal rings |
| repair-robot | A blinking, waving robot fixing things with a wrench, sparks and all |
| matrix-rain | Code rain and a glitching title with a typed console log, no game |

## How it works

```
visitor → Cloudflare edge → Worker → fetch(origin)
                                          │
                              origin OK ──┴── origin down / 502 / 521 / 522 / 523 / 530
                                 │                          │
                          response passes                serves the
                          through untouched               embedded page (503)
```

The worker is a single `fetch` handler: it forwards the request to your
origin, and only swaps in the maintenance page when the response status is
one you've flagged as a failure (or the fetch throws entirely — origin
completely unreachable). Everything else — caching, redirects, your real
app — behaves exactly as if the worker weren't there.

The served page is always a **503** with `Retry-After` and `Cache-Control:
no-store`, so search engines don't index it and browsers don't cache it.

## Requirements

- A domain already proxied through Cloudflare (the free plan is enough —
  Workers Routes and Workers Scripts are both on the free tier)
- [Node.js](https://nodejs.org/) to run the build/test scripts (no
  dependencies, no `npm install` — plain Node, any recent version)
- `curl` (or just use the Cloudflare dashboard instead of the API — see
  below)

## Deploying

### 1. Pick or customize a theme

Open any file in `live/` or `designs/` directly in a browser — every theme
is a single self-contained HTML file, no server or build step needed to
preview it. Edit the text, colors, or the outage-story lines directly;
it's plain HTML/CSS/JS with no framework.

### 2. Build the worker

```bash
node build-worker.js                        # builds live/matrix-runner.html (the deployed default)
node build-worker.js designs/minimal.html   # or build any theme from the gallery instead
```

This produces `worker.js` — a self-contained ES module with your chosen
page embedded as a string constant. Nothing external, no imports.

### 3. Create a scoped API token

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom
Token**. Avoid the Global API Key — it grants far more than this needs.
Permissions:

| Scope | Permission |
|---|---|
| Account | Workers Scripts — **Edit** |
| Zone (the domain(s) you're deploying to) | Workers Routes — **Edit** |

### 4. Upload the worker

```bash
export CF_API_TOKEN="your-scoped-token"
export CF_ACCOUNT_ID="your-account-id"       # Cloudflare dashboard → right sidebar of any domain
export SCRIPT_NAME="maintenance-page"

curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-08-01"};type=application/json' \
  -F "worker.js=@worker.js;filename=worker.js;type=application/javascript+module"
```

### 5. Bind it to the hostnames you want protected

One request per hostname pattern:

```bash
export ZONE_ID="your-zone-id"                # Cloudflare dashboard → right sidebar of the domain

curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"pattern\":\"example.com/*\",\"script\":\"$SCRIPT_NAME\"}"
```

Repeat per hostname (`www.example.com/*`, `app.example.com/*`, ...). Only
bind hostnames that actually serve real content from an origin — a
hostname that's pure edge-side redirect (a Redirect Rule with no backend)
never reaches your origin, so the worker has nothing to catch there.

Prefer the dashboard? **Workers & Pages → your worker → Triggers → Add
Route** does the same thing with no `curl` involved.

`example.com` here is a placeholder — the deploy commands never need your
real domain hard-coded anywhere in this repo; you only type it into the
`curl` calls (or the dashboard) at deploy time.

### 6. Leave the `workers.dev` preview URL disabled

Every Worker also gets a free `<script-name>.<your-subdomain>.workers.dev`
URL. It's **disabled by default** unless you explicitly enable it — leave
it that way. Enabling it makes the worker reachable directly at a public
URL that bypasses any Cloudflare Access policy or custom-domain
restrictions you have on your real hostnames.

## Testing

### Preview a theme locally

No server needed — just open the HTML file in a browser:

```bash
start live/matrix-runner.html   # Windows
open live/matrix-runner.html    # macOS
```

Iterate on visuals, copy, or game balance entirely offline before touching
Cloudflare at all.

### Simulate an outage on the live site

The fastest way to see the real, deployed page: briefly take your origin
offline (stop the container/service Cloudflare proxies to — e.g. a
Cloudflare Tunnel daemon, or just take the backend down for a few seconds)
and visit any bound hostname. The maintenance page should appear within
15–20 seconds — that's roughly how long it takes Cloudflare's edge
connections to notice the origin is gone. Bring the origin back and the
page's own health check (see below) will offer a way back in within 30
seconds, without a manual refresh.

### Test the mini-game's fairness headlessly

`live/matrix-runner.html` ships an endless-runner where agents (and, past
a small score threshold, a slowed-down shooter agent) come at the player.
Game-balance bugs are easy to ship by accident — a speed that's tied to
frame rate instead of elapsed time runs 2× too fast on a 120 Hz phone; two
spawn conditions that are individually reasonable can combine into an
undodgeable death.

```bash
node test/game-sim.js
```

This extracts the actual game-logic code out of the theme file (not a
reimplementation — it can't drift from what ships), stubs out the
DOM/canvas, and runs ~25 simulated minutes against a bot that jumps based
on time-to-contact (how a person actually times a jump, not "obstacle is N
pixels away"). It reports how many agents/bullets appeared, how many
deaths happened, and the closest a bullet-dodge and the next obstacle ever
got — a very small "closest gap" number means two threats are stacking
into an unfair death. Run this after touching spawn timing, speeds, or
hitboxes, before deploying.

## The "reality check" mechanism

Once the maintenance page is showing, it polls its own URL with a `HEAD`
request every 30 seconds. As long as that keeps failing, `matrix-runner`
advances its outage story to the next act (ten short chapters, from
"reweaving the system" to "negotiating with the machines") instead of
reloading the page — so the code-rain background and an in-progress game
are never interrupted. The moment the poll succeeds, a "back online"
button appears; clicking it reloads the real page.

## Which failure codes trigger the page

By default: `502`, `521`, `522`, `523`, `530` — Cloudflare's "origin
unreachable" family — plus any thrown `fetch` (a fully dead origin, no
response at all). Edit the `TRIGGER_STATUSES` array at the top of
`build-worker.js` to add or remove codes, then rebuild.

## License

[MIT](LICENSE) — use it, theme it, ship it.
