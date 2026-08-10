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
| `register` | create/update the registry entry — always owner-only; prints the origin the gateway allocated |
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
`/ui-<uiId>/` — the bare id, because by then the hub has already routed to *your* host — to
lmui's local port:

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
- **Two identifiers, one per side of the relay.** The public origin is owner-qualified
  (`ui-<ownerSlug>-<uiId>.<domain>`) because that is where every owner's UIs share a
  namespace; everything on your machine — the service route, the apps directory, the state
  files — uses the bare uiId, since subject-routing already got the request to you.

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
- **Host-agent restarts are survivable.** The agent's `/ui-*` route comes from persisted
  config (in lm-assist: `uiWebPort` in `hub.json`), so an agent restart re-advertises it
  and relaying resumes — your `lmui start` process runs detached and is untouched. The
  agent does not supervise lmui; keeping it alive (and restarting it after a host
  reboot) is yours, or a manager's, job — which is what the contract below exists for.

## The management contract (`~/.lmui/dev-<uiId>.json`)

`start` records machine-readable serving state, one file per UI; `stop` removes it.
**lmui is the only writer; managers only read.**

```json
{ "uiId": "my-app", "service": "ui-my-app", "pid": 12345, "port": 5173,
  "dir": "/home/me/my-app", "sdkPath": "/home/me/agentic-ui-spec/sdk",
  "log": "/home/me/.lmui/dev-my-app.log", "startedAt": "…" }
```

Any supervisor — the host agent itself, or an external tool in its own repo — can:

- **list** the UIs served from this machine: glob `~/.lmui/dev-*.json`, check the pid is
  alive (`kill -0`), probe `http://127.0.0.1:<port>/<service>/index.html`
- **stop** one: SIGTERM the recorded pid (verify the process is actually lmui first —
  never trust a stale pidfile)
- **(re)start** one: run `node <sdkPath>/lmui.js start` with `dir` as the working
  directory — everything needed is in the file

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

`uiId` is the bare name, up to 51 characters, and it only has to be unique among *your*
UIs — the gateway prefixes it with your owner slug when it addresses the app (SPEC §2.7).
Never write the slug here; you do not choose it, and it may be re-derived.

## Your UI is yours alone

A UI is bound to the identity that registered it and is served only to that identity —
another user cannot open it, or even see it listed (SPEC §5.4). The name is yours too, in
the sense that matters: `dashboard` is unique inside your namespace, so registering it
neither takes it from anyone nor can be taken from you. If someone else wants your app,
they register their own copy under their own identity, against their own data — under the
same name if they like, on their own origin.

## Browser runtime

`assets/lmui.js` (copied by `init`) is the whole client contract:

```js
lmui.call(service, path, opts)   // fetch with the view token; re-mints on 401/403
lmui.requestAccess(rules, why)   // ask for more; granted or returns a consent URL
lmui.releaseAccess(service, path)// give it back
lmui.scopes()                    // what exists and what this UI holds
lmui.token, lmui.uiId, lmui.uiKey
```

`uiId` is the bare name to show a viewer; `uiKey` is `<ownerSlug>-<uiId>`, the token's
`aud`. Gateway calls take either, so the helper passes the bare id.

It never sees a backend credential — only a short-lived, grant-bearing view token.

## Sibling apps — one host port, many UIs

The hub routes ALL of a host's `/ui-*` traffic to one port, so a second UI on the same
machine could never be reached on a port of its own. The dev server therefore serves
**sibling apps** as well as its own: a request for `/ui-<other>/…` is answered from
`<appsRoot>/<other>/` when that directory contains an `lmui.config.json`. The apps root
defaults to `~/.lmui/apps` (override with `LMUI_APPS_DIR`); the cwd app always wins for
its own service prefix. Practically: keep every UI for a host under the apps root, run
ONE `lmui start` there on the host's UI port, and each registered sibling is served —
`pages` is reserved (the host agent's own management API lives at `/ui-pages`).
