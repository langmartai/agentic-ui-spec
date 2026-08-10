# Bootstrap Guide

From nothing to a UI served from your own machine. Two roles bootstrap differently —
most readers are **authors** and start at §2.

## 1. Platform operator (once, for everyone)

What the platform must already have before any author can start:

1. **Wildcard origin** — DNS `*.<domain>` + a TLS cert covering it, routed to the
   Serving Gateway. This is the ONLY DNS/cert work, ever: every future app origin
   (`ui-<uiKey>.<domain>`, where the uiKey is `<ownerSlug>-<uiId>`) is carved from it and
   fits in one DNS label by construction (SPEC §2.7–§2.8, §5.3).
2. **Identity provider** — OIDC with PKCE; the gateway registered as a relying party
   (SPEC §3). Guests must not satisfy SSO.
3. **Serving Gateway + registry** — owner-bound registry, view-token minting, the
   `/access/*` grant API, the data plane (SPEC §4–§6).
4. **Hub** — authenticated relay intake, subject-routed, fail-closed (SPEC §7).

Reference implementation for all four: langmart.ai.

## 2. Author (per person, ~5 minutes)

Prerequisites: a platform account, and a **host agent** on your machine connected to the
hub (reference implementation: an lm-assist node registered under *your* account).

```bash
# 0. one-time host wiring: tell your agent which local port serves UIs
#    (lm-assist: set "uiWebPort" in ~/.lm-assist/hub.json, restart the Core —
#     it then advertises the /ui-* route; survives every later restart)

# 1. scaffold
mkdir my-app && cd my-app
node <clone>/sdk/lmui.js init my-app

# 2. sign in (paste your gateway session cookie once, stored 0600)
export LMUI_GATEWAY=https://ui.<domain>
node <clone>/sdk/lmui.js login

# 3. claim the name in YOUR namespace — this IS the subdomain allocation (no DNS step)
#    workerId = your agent's id (lm-assist prints it; or set LMUI_WORKER_ID)
#    prints the origin the gateway allocated: https://ui-<ownerSlug>-my-app.<domain>/
node <clone>/sdk/lmui.js register

# 4. serve, managed (pidfile + log + state in ~/.lmui/)
PORT=<uiWebPort> node <clone>/sdk/lmui.js start
node <clone>/sdk/lmui.js status
```

Open the origin `register` printed — sign in with the same account, and the page is
served from your disk through the hub. Edit + reload is the whole dev loop. Someone else
registering `my-app` too is not your problem: their origin carries their owner slug, not
yours.

## 3. Verifying each hop (when something is wrong)

Work down the chain; each failure names its layer:

| Symptom | Layer | Meaning / fix |
|---|---|---|
| DNS error / cert warning | wildcard | operator problem — §1.1 |
| `register` refuses the uiId as too long | naming | a uiId is capped at 51 characters so `ui-<ownerSlug>-<uiId>` stays inside one 63-char DNS label (SPEC §2.8) |
| redirected to sign-in repeatedly | identity | you're not signed in at the platform root site (identity lives THERE, not per-app) |
| "This account can't open …" page | ownership | signed in as the wrong account (often a guest) — use its switch-account button |
| `503 … host is not reachable` | relay/host | your agent is offline, its `/ui-*` route isn't wired (§2 step 0), or `lmui status` says not serving |
| page loads, data buttons 403 | grants | path not in ① declared or ② granted — see the access panel; request it at runtime |
| asset missing / 413 | your files | >1 MB per file relay cap, or file not on disk — `lmui` refuses loudly rather than truncating |

## 4. What you never do

No uploads, no builds on the platform, no per-app DNS/cert requests, no credentials in
your pages or your dev server, no login UI of your own. If a step seems to require one
of these, something is miswired — the model's whole point is that these steps don't
exist.
