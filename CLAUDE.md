# CLAUDE.md — working in this repository

This repo is the **Agentic UI Specification (AUIS)**: an abstract, implementation-independent
spec for pluggable, identity-bound UIs, plus a runnable zero-dependency reference SDK.
It contains **no implementation code** — implementations (langmart.ai, lm-assist) live in
their own repositories and *conform to* this one.

## 🔴 This repo is PUBLIC

Everything committed here is visible to the world. Never commit:

- internal hostnames, IP addresses, ports of private infrastructure
- API keys, tokens, session values, cookies — including "test" ones
- personal email addresses or account identifiers
- operational details of any private deployment

Before every commit, audit the diff for the above. Implementations may be *named*
(langmart.ai, lm-assist) as conforming systems; their internals may not be described.

## Map

| File | Role | Editing rule |
|---|---|---|
| `SPEC.md` | **Normative** (AUIS, RFC 2119) | MUST/SHOULD/MAY language only; every change is a spec change — keep numbered sections stable, add rather than renumber |
| `GUIDE.md` | Non-normative UI design guide | Practice, not requirements; must stay consistent with SPEC and with the example (§5 annotates it region by region) |
| `ARCHITECTURE.md` | How the roles compose into a system | Diagrams and prose; non-normative |
| `README.md` | Front door | Links the above; keep short |
| `sdk/lmui.js` | Reference CLI (init/login/register/dev/start/stop/status/scopes/release/list) | Node 18+, **zero dependencies**, runnable straight from a clone — never add a package.json step |
| `sdk/example/` | The canonical example UI (`index.html` + `assets/lmui.js`) | GUIDE §5 documents it region by region — change one, update the other |
| `sdk/README.md` | SDK usage | Mirrors the CLI's actual behavior |

## How the pieces are used

```bash
# a UI author's whole workflow, from a clone of this repo:
mkdir my-app && cd my-app
node /path/to/agentic-ui-spec/sdk/lmui.js init my-app     # scaffold config + example page
export LMUI_GATEWAY=https://ui.example.com                 # their gateway origin
node /path/to/agentic-ui-spec/sdk/lmui.js login            # paste session cookie, stored 0600
node /path/to/agentic-ui-spec/sdk/lmui.js register         # create the owner-bound registry entry
node /path/to/agentic-ui-spec/sdk/lmui.js dev              # serve foreground (edit-and-reload)
node /path/to/agentic-ui-spec/sdk/lmui.js start|stop|status  # or managed background (pidfile+log in ~/.lmui/)
```

The files never leave the author's machine — a hub relays each request to the local dev
server (SPEC §7). `PORT=<n>` overrides the port for dev/start/status alike.

## Invariants the spec is built on — do not weaken casually

1. **Login proves identity; it must not BE power** (SPEC 3.3) — OIDC tokens are never
   API credentials.
2. **public ⊕ trusted** (SPEC 3.2) — a secret-less client can never be
   credential-elevated.
3. **Owner-bound access** (SPEC 5.4) — a UI is visible to the identity that registered
   it, and no one else. This is what makes user-authored code safe to serve.
4. **The page never holds a backend credential** (SPEC §8) — view tokens are short-lived,
   aud-bound, and carry the grant; credentials stay server-side.
5. **Grants are explicit** — declared at registration or requested at runtime; an owner's
   request to their own UI grants immediately (requester = granter, nothing to approve).

If a change would violate one of these, the change is wrong or the spec needs a new
versioned section arguing why — never a silent edit.

## Making changes

- **Spec changes**: edit `SPEC.md` in RFC 2119 language; reflect consequences in
  `GUIDE.md`/`ARCHITECTURE.md` if user-visible. The spec is extracted from a working
  system — prefer codifying proven behavior over speculative requirements.
- **SDK changes**: keep `lmui.js` dependency-free and self-documenting (`node lmui.js`
  with no args prints the command list — keep it truthful). The example must keep a
  1:1 button↔handler pairing; a button without a handler throws on page load and kills
  every later script line.
- **Example changes**: update GUIDE §5's annotation table in the same commit.
- **Sanity check before pushing**: `node sdk/lmui.js` (usage prints, exit 1),
  `node --check sdk/lmui.js`, and the public-repo audit above.

## Style

- Markdown prose over bullet-dumps in the spec; tables where structure earns them.
- SDK code: small, commented for *why*, ES5-compatible in page scripts
  (`sdk/example/assets/lmui.js` runs in arbitrary browsers), modern Node in the CLI.
- Dark, self-contained styling in example pages — the serving CSP allows no external
  origins, so pages must carry their own CSS inline and stay under the 1 MB relay cap
  per file.
