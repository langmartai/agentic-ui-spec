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
on disk is what is served on the next load.

## Who holds the WebSocket (topology)

`lmui dev` does **not** connect to the hub. It is a plain local HTTP server bound to
loopback, holding no credential of any kind. The hub connection belongs to the **host
agent** — the long-running process on your machine that already maintains one
authenticated outbound WebSocket to the hub (in the reference implementation, the
lm-assist Core). The agent declares a service route mapping the relayed path prefix
`/ui-<uiId>/` to lmui's local port:

```
browser ── serving gateway ── hub ══ WebSocket ══ host agent ──► http://127.0.0.1:<port>
   (internet side)                    (ONE per host,              (lmui dev/start —
                                       held by the agent)          no hub knowledge)
```

This split is deliberate, not an implementation accident:

- **One authenticated connection per host.** The agent already proved its identity to the
  hub; a second WebSocket per UI would mean a second credential per UI to provision,
  rotate, and leak.
- **The dev server stays credential-free.** Anyone can run, copy, or modify `lmui.js`
  without touching anything secret — consistent with the spec's rule that the page (and
  now its server) never holds a backend credential.
- **`register` names the host, not a socket.** The registry entry's `workerId` says which
  agent's WebSocket serves this UI; the hub routes by that, per SPEC §7.2.

Concretely, with lm-assist as the host agent: set the UI port once in its hub config
(`uiWebPort` in `~/.lm-assist/hub.json`) and restart the Core; it then advertises the
`/ui-*` route and relays every matching request to that port. Any other conforming agent
can fill the same role — the contract is only "authenticated outbound WebSocket + local
HTTP forward" (SPEC §7).

Consequences worth knowing up front:

- **Your host is the availability.** Host off ⇒ the UI is unavailable. That is the deal: you
  own the app and its uptime.
- **No hot-module reload.** The relay carries HTTP request/response over the worker's
  WebSocket — it is not a tunnel, so a dev server's own HMR socket cannot traverse it. A
  plain browser reload picks up changes.
- **1 MB per file.** The relay caps a single response. `lmui dev` returns **413 with an
  explanation** rather than letting the hub truncate silently — split large bundles.
- **Background serving.** `dev` is the foreground edit-and-reload loop; for a demo that
  should outlive the terminal use `start` / `stop` / `status` — a detached process with
  a pidfile and log under `~/.lmui/`. `status` probes the HTTP port, not just the pid,
  and a stale pidfile is reported rather than trusted.

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
