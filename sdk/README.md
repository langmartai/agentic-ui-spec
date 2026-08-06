# lmui — reference SDK & CLI

The reference implementation of the AUIS authoring contract (SPEC.md §8). **No install, no
package manager, no dependencies** — clone this repo and run it with Node 18+:

```sh
node sdk/lmui.js init my-app
cd my-app-dir
LMUI_GATEWAY=https://ui.example.com node /path/to/sdk/lmui.js login
node /path/to/sdk/lmui.js register
node /path/to/sdk/lmui.js dev
```

## Commands

| | |
|---|---|
| `init <uiId>` | scaffold `lmui.config.json`, `index.html`, `assets/lmui.js` |
| `login` | store a gateway session (written `0600`) |
| `register` | create/update the registry entry — always owner-only |
| `dev` | serve this folder for the hub to relay |
| `scopes` | what the UI declares, what it was granted, what it may ask for |
| `release [service path]` | give back granted access — all, or one rule |
| `list` | your registered UIs (you only ever see your own) |

Environment: `LMUI_GATEWAY` (required), `LMUI_WORKER_ID`, `LMUI_COOKIE`, `PORT`.

## Where your code lives

On your machine. The hub relays each request to `lmui dev` and **keeps no copy**, so what is
on disk is what is served on the next load. Consequences worth knowing up front:

- **Your host is the availability.** Host off ⇒ the UI is unavailable. That is the deal: you
  own the app and its uptime.
- **No hot-module reload.** The relay carries HTTP request/response over the worker's
  WebSocket — it is not a tunnel, so a dev server's own HMR socket cannot traverse it. A
  plain browser reload picks up changes.
- **1 MB per file.** The relay caps a single response. `lmui dev` returns **413 with an
  explanation** rather than letting the hub truncate silently — split large bundles.

## `lmui.config.json` is the declared half of your access

```json
{
  "uiId": "my-app",
  "name": "My App",
  "scope": "langmart",
  "grant": [{ "service": "platform", "pathPrefix": "/api/models", "verbs": ["GET"] }],
  "dev": { "port": 5173 }
}
```

Access comes from exactly two places: what you **declare** here, and what you **request at
runtime** (`lmui.requestAccess`) and can **release** (`lmui.releaseAccess`). Nothing else.

## Your UI is yours alone

A UI is bound to the identity that registered it and is served only to that identity —
another user cannot open it, or even see it listed (SPEC §5.4). If someone else wants it,
they register their own copy under their own identity, against their own data.

## Browser runtime

`assets/lmui.js` (copied by `init`) is the whole client contract:

```js
lmui.call(service, path, opts)   // fetch with the view token; re-mints on 401/403
lmui.requestAccess(rules, why)   // ask for more; granted or returns a consent URL
lmui.releaseAccess(service, path)// give it back
lmui.scopes()                    // what exists and what this UI holds
lmui.token, lmui.uiId
```

It never sees a backend credential — only a short-lived, grant-bearing view token.
