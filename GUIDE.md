# UI Design Guide

*Non-normative companion to [SPEC.md](SPEC.md). The spec says what an implementation MUST
do; this guide says how to build a UI that people can actually trust and use. The bundled
[example](sdk/example/) implements everything below.*

---

## 1. What a pluggable UI is, from the page's point of view

Your page is plain static HTML/JS/CSS served on its **own origin**
(`ui-<uiId>.<domain>`). It arrives in the browser with two things injected by the
serving gateway:

```js
window.__VIEW_TOKEN__   // short-lived signed token: who is viewing, which UI, what it may reach
window.__UI_ID__        // this UI's id
```

Everything else your page knows, it must ask for — same-origin only:

| Endpoint | What it answers |
|---|---|
| `GET /auth/me` | who is signed in (name/email/id) — session cookie, not the token |
| `POST /viewtoken/remint` | a fresh view token carrying the *current* grant |
| `GET /access/scopes` | scope catalog + this UI's declared/granted access |
| `GET /access/grants/<uiId>` | what the user has granted this UI at runtime |
| `POST /access/request` | ask for more access (rules + reason) |
| `POST /access/revoke` | give access back |
| `/data/<uiId>/<service>/<path>` | the data plane — every backend call goes here, bearer = view token |

The page never sees an API key, a session secret, or another UI's anything. That is not a
restriction to work around; it is the reason the model is safe enough to let anyone
author UIs.

## 2. Page anatomy — the three things every UI should show

A UI that touches user data should answer three questions *at a glance*, without the user
pressing anything:

### 2.1 Who am I signed in as? (identity badge)

Render the signed-in identity persistently — a header badge, not a hidden menu. Fetch it
from `/auth/me`; fall back to the token's `sub` if that fails:

```js
fetch('/auth/me', { credentials: 'same-origin' })
  .then(r => r.json())
  .then(d => { badge.textContent = d.claims?.name || d.claims?.email || d.userId; });
```

Why it matters: sessions outlive logins. A user who signed in as a guest yesterday and as
themselves today may still be carrying yesterday's session. If the badge always shows the
identity, a wrong-account situation is *visible* instead of surfacing later as a
mysterious 403.

### 2.2 What can this page reach? (live access panel)

Show the two halves of the access model, side by side and always visible:

- **① Declared** — the grant hardcoded at registration (`lmui.config.json`). Works from
  the first page load; the user accepted it by installing the UI.
- **② Granted at runtime** — access the page asked for while running. Starts empty,
  grows on request, shrinks on release.

```js
const d = await lmui.scopes();
panel.declared = d.ui.hardcodedGrant;   // ①
panel.granted  = d.ui.approvedGrant;    // ②
```

Refresh the panel after **every** request/release so the user watches access appear and
disappear. Anything in neither list is always refused — say so on the panel.

### 2.3 What does my token say right now? (token state)

The live view token is the *actual* authority on every data call — and it can lag the
server, because it is minted per page load. Show its expiry (a countdown is ideal) and,
on demand, its decoded contents:

```js
const claims = JSON.parse(atob(lmui.token.split('.')[1]));
// claims.sub = viewer, claims.aud = this uiId, claims.grant = what THIS token can do
```

If the decoded grant differs from the server's view, tell the user it is stale and that
any data call (or an explicit re-mint) will refresh it.

## 3. Auth, from the page's perspective

The full protocol lives in SPEC §3; here is what actually happens around your page:

1. **First visit, no session** → the gateway redirects to its parent origin, which
   vouches the user's identity via OIDC (authorization code + PKCE) against the
   platform's identity provider, then hands the app origin a one-time code. The app
   origin mints its **own** host-only session cookie. Your page loads with the token
   injected. You write no auth code for any of this.
2. **Session exists** → page loads immediately.
3. **Wrong account** (commonest: a guest session) → the gateway serves a *no-access page*
   instead of your UI: it names the signed-in identity, explains owner-only access, and
   offers **switch account** (ends the session family, restarts login, returns to your
   UI). Your page never sees these viewers.
4. **Token expiry mid-use** → call `POST /viewtoken/remint` (the SDK's `lmui.call`
   retries once on 401/403 with a fresh token automatically).

Design rules that follow:

- **Never store the token** (localStorage, IndexedDB, cookies). It is short-lived by
  design; hold it in a variable and re-mint.
- **Never build your own login UI.** If your page is executing, the viewer is already
  authenticated and is the UI's owner. A "sign in" button inside a pluggable UI is a
  red flag.
- **Guests are a platform concern, not yours.** By the time your page runs, guest and
  wrong-account viewers have been filtered out by the gateway.

## 4. Scope access — the request lifecycle

Access is either **declared** (①) or **requested at runtime** (②). The lifecycle:

```
declared in config ──────────────► usable immediately, forever
runtime:  request ─► granted ─► use ─► release
                └─► consent needed (third-party UIs only)
```

- **Declare the minimum.** The scaffolded config declares one read path. Everything else
  should be requested at the moment the user takes the action that needs it — with a
  human-readable `reason` they will recognize.
- **Your own UI grants on request.** Under owner-bound access the person requesting *is*
  the person granting, so there is nothing to approve: `requestAccess` returns
  `{granted: true}` and the SDK re-mints for you. The `consentUrl` branch exists for
  implementations that also serve non-owner UIs.
- **Release what you're done with.** `releaseAccess` returns the grant; the next token
  no longer carries it. A UI that accumulates grants it no longer uses is technically
  fine and socially wrong.
- **Handle refusal as information.** A 403 on a data call means "not in ① or ②" —
  show which, using the access panel, rather than a bare error.

```js
// the whole cycle, as the example implements it
const d = await lmui.requestAccess(
  [{ service: 'platform', pathPrefix: '/api/user/quota/status', verbs: ['GET'] }],
  'Show your quota on this page');           // reason the user will recognize
if (d.granted) await lmui.call('platform', '/api/user/quota/status');
...
await lmui.releaseAccess('platform', '/api/user/quota/status');
```

## 5. The example, annotated

[`sdk/example/`](sdk/example/) is two files; everything above maps onto them.

**`index.html`** — layout:

| Region | Demonstrates |
|---|---|
| Header badge (`#who`) | §2.1 — identity from `/auth/me`, always visible |
| Header chips | the uiId and "served from my machine" (worker-hosted) |
| Live access panel (`#hardcoded`, `#granted`, `#tokexp`) | §2.2/§2.3 — ① vs ②, token expiry, refreshed after every change |
| "Call my declared grant" | ① — works with no request, because the config declared it |
| "Ask for more access" | ② request → instant grant (own UI) → immediate use |
| "Give it back" | ② release → panel shrinks → the same call 403s again |
| "Show current scope" | §2.3 — decodes the live token: viewer, aud, carried grant |
| Output console (`#out`) | raw HTTP status + body for every action — honesty beats polish |

**`assets/lmui.js`** — the page-side SDK (~90 lines, no dependencies):

- `call(service, path, opts)` — data-plane fetch with the token; on 401/403 re-mints
  once and retries *only if the token actually changed* (prevents retry loops).
- `remint()` — swap the in-memory token for a fresh one.
- `requestAccess(rules, reason)` / `releaseAccess(service, pathPrefix)` — the §4 cycle.
- `scopes()` / `approvedGrants()` — feed the access panel.
- `uiId`, `token` (getter) — the injected globals, wrapped.

Copy these two files, change the calls, keep the anatomy.

## 6. Visual and practical conventions

Not requirements — conventions the example uses that have earned their place:

- **Dark, self-contained styling.** All CSS inline or same-origin; the CSP blocks
  external origins anyway (`connect-src 'self'`), so design for zero third-party assets.
- **Buttons grouped by access model**, each group with a one-line hint saying *why* its
  calls will succeed or fail. The demo's "always denied" button exists precisely to show
  a refusal — an honest UI demonstrates its limits.
- **Console-style output** (`HTTP <status>` + pretty-printed JSON) during development.
  Replace with real rendering for production UIs, but keep failures loud.
- **Assets ≤ 1 MB each** — the hub relay caps one response; the dev server refuses
  oversized files loudly (413) rather than truncating.
- **Reload is the dev loop.** Files are served live from your machine through the hub;
  edit and reload. Hot-module reload does not survive the relay (it needs its own
  WebSocket); plain reload does.
