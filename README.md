# Agentic UI Specification (AUIS)

**A vendor-neutral specification for serving agent-generatable web UIs that are
authenticated against a SaaS identity and given narrow, per-viewer access to backend
APIs — without ever handing the browser a durable credential.**

> **The use case in one sentence:** *an agent generates and manages a UI on a host you
> control, and it instantly becomes a standard OIDC/OAuth-secured, scope-limited web +
> API service on the public internet — nothing is uploaded to the platform.*

"On a host you control" means: the page's files live on whichever machine runs the relay
client (the host agent — lm-assist in the current implementation). That machine IS the
hosting; the platform relays requests to it per-visit and stores nothing.

Unpacked, that sentence is five claims, each backed by a part of the spec:

| Claim | Meaning | Spec |
|---|---|---|
| **agent generates and manages** | the UI is code an LLM/agent wrote and can keep editing — treated as untrusted by construction | §5, §8 |
| **standard OIDC/OAuth** | viewers sign in with ordinary authorization-code + PKCE against the platform IdP — no invented auth | §3 |
| **secure, scoped** | the page acts only within an explicit grant (declared or requested at runtime), only as its owner, via a short-lived token — never a real credential | §4, §5.4, §6 |
| **internet relay** | the files live on the relay-client host; a hub relays each request over that host agent's one authenticated WebSocket — the platform stores nothing | §7 |
| **web + API service** | the result is both a served page *and* a governed data plane to backend APIs, addressed as service + path | §6 |

Modern applications increasingly want to *generate* a UI on demand (often with an LLM/
agent) and serve it to a user. The moment a UI is generated rather than hand-reviewed, it
is untrusted code — and serving untrusted code with ambient access to a user's backend is
a security problem, not a feature. AUIS defines the roles and contracts that make it safe:
one identity layer, scoped registries, short-lived capability tokens, and a data plane
where a page can act only within its declared grant and only as the viewer.

📄 **[Read the specification → SPEC.md](SPEC.md)** (AUIS v0.1, RFC 2119 language)

🎨 **[UI Design Guide → GUIDE.md](GUIDE.md)** — how to build a UI on this model: page
anatomy (identity badge, live access panel, token state), auth from the page's
perspective, the scope request lifecycle, and an annotated tour of the example.

🚀 **[Bootstrap Guide → BOOTSTRAP.md](BOOTSTRAP.md)** — zero to served: what the platform
operator sets up once, the author's five-minute path, per-hop troubleshooting, and the
list of steps that deliberately don't exist.

🧰 **[Reference SDK → sdk/](sdk/README.md)** — not an optional extra: the CLI
(`init`/`login`/`register`/`dev`/`start`/`stop`/`status`), the page runtime
(`lmui.call`, request/release, re-mint), and the canonical example UI. Zero
dependencies, runnable straight from a clone — this is the working half of the spec.

## Try it — the demo

The [`sdk/`](sdk/) is runnable straight from a clone (Node 18+, zero dependencies):

```bash
mkdir my-app && cd my-app
node <clone>/sdk/lmui.js init my-app        # scaffold: config + example page + page SDK
export LMUI_GATEWAY=https://ui.example.com  # your gateway origin
node <clone>/sdk/lmui.js login              # paste your session cookie (stored 0600)
node <clone>/sdk/lmui.js register           # owner-bound registry entry
node <clone>/sdk/lmui.js start              # serve in the background (stop/status too)
```

Open `https://ui-my-app.<domain>/` — the page is served from your machine through the
hub, with an identity badge, a live ①declared/②runtime-granted access panel, and
buttons that walk the whole grant lifecycle: call a declared path, get refused on an
undeclared one, request access (granted instantly — you own the UI), use it, give it
back. [GUIDE.md §5](GUIDE.md) annotates every region of the page.

## Many authors, one wildcard (multi-tenancy)

Every user gets this independently — there is **no per-user infrastructure step**:

- The platform pre-allocates **one** wildcard once — in the reference implementation,
  `*.langmart.ai`, which the platform already held. The fixed `ui-` prefix carves the
  app namespace out of it: `ui-<uiId>.langmart.ai` resolves and has valid TLS for *any*
  uiId, with zero DNS/cert/proxy work per app.
- **Registering a uiId IS the allocation.** `POST /registry/uis` (the Serving Gateway's
  API) claims the name first-come (reserved names denylisted) and binds it to the
  caller's identity; the gateway derives the uiId from the Host header at request time.
- Isolation is three independent walls: **owner-only serving** (another account gets a
  no-access page, the UI never renders), **subject-routed relay** (SPEC §7.2 — a UI
  relays only to hosts owned by *its* owner; nobody's traffic can reach your machine),
  and a **scoped data plane** (each viewer's tokens carry their own identity and grants).

Two users on the same platform are therefore fully parallel: own uiId under the shared
wildcard, own machine (their **lm-assist** node) as the hosting, own identity end to end.

## What it covers

- **Authentication** — OIDC + PKCE, in **two exposure classes**: internet-facing
  (confidential relying party) and local/LAN (public, secret-less client). Identity is
  global; authority is scoped. An OIDC token can prove who you are but is structurally
  incapable of *being* a backend API credential.
- **Registry** — each scope catalogs its UIs with an owner, an access mode, and a
  capability **grant**. The scope→services binding is a structural wall enforced at
  registration.
- **Credentials & backend/data access** — three credentials with one direction of trust:
  the browser holds only a short-lived, grant-bearing **view token**; the per-user backend
  credential stays server-side; data is authorized *as the viewer*, and the grant is a
  ceiling over the backend's own authorization, never a bypass.
- **Hub routing** — how an internet-facing relay carries requests to backends that dial
  out to it, fail-closed, subject-routed, forwarding the viewer's identity.
- **Authoring contract** — the minimal, safe surface a UI (or a UI generator) may target.
- **Reference SDK** — the contract made runnable: a credential-free local server the hub
  relays to (the author's machine IS the hosting), a page runtime that speaks the data
  plane and grant lifecycle, and the example UI the design guide annotates.

## Design stance

- **Roles, not technologies.** Any stack that meets the MUSTs conforms. Conformance is
  claimed per role (Identity Provider, Serving Gateway, Registry, Data Source, Hub).
- **Honest degradation over silent gaps.** Where a backend cannot yet authorize per-viewer,
  the spec requires the implementation to treat those UIs as owner-scoped and record the
  gap in a conformance ledger — never to present unenforced per-viewer access as if
  enforced.

## Implementations

AUIS is extracted from a working system. See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the
reference deployment, with diagrams.

- **[langmart.ai](https://langmart.ai)** — implements the **Identity Provider** (SSO/OAuth),
  the **Hub** (internet-facing relay and routing) and its web tier, and the **Serving
  Gateway + Registry**; its platform API is a Data Source.
- **[lm-assist](https://github.com/langmartai/lm-assist)** — a **web-app implementation**
  that is routed to the public internet *through* the langmart.ai hub. It implements
  **Local Authentication** (LAN public-client login), and its node is a Data Source.
  lm-assist follows this specification; it is not the specification.

If you implement AUIS, open a PR adding your project here.

## Status

v0.1 draft — open to issues and proposals. Versioned by the `AUIS vX.Y` line at the top
of `SPEC.md`.

## License

Specification text licensed under [Apache License 2.0](LICENSE) — implement freely, with a
patent grant to implementers.
